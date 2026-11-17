import { and, asc, eq, lt } from "drizzle-orm";
import { classifyDocument } from "$lib/accounting/expense-group";
import { planReceiptSplit } from "$lib/accounting/receipt-layout";
import type { TxnType } from "$lib/accounting/types";
import { getDb } from "./db/client";
import { categories, receipts } from "./db/schema";
import { markReceiptsUnseparated, saveReceiptCrops } from "./documents";
import { settleExtractedReceipt } from "./grouping";
import { BooksError } from "./errors";
import { loadStoredBytes, objectStorage } from "./object-store";
import { cropReceiptBoxes, prepareReceiptImage } from "./receipt-crop";
import { extractDocument, locateReceipts } from "./xai";

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

const inflight = new Map<string, Promise<void>>();

export function enqueueExtraction(companyId: string): void {
  if (inflight.has(companyId)) return;
  const job = runQueue(companyId)
    .catch((error) => {
      console.error("EasySlip extraction queue failed", error instanceof Error ? error.message : error);
    })
    .finally(() => {
      inflight.delete(companyId);
    });
  inflight.set(companyId, job);
}

async function runQueue(companyId: string): Promise<void> {
  const db = getDb();
  const stale = new Date(Date.now() - 15 * 60 * 1000);
  await db
    .update(receipts)
    .set({ status: "queued", updatedAt: new Date() })
    .where(and(eq(receipts.companyId, companyId), eq(receipts.status, "processing"), lt(receipts.updatedAt, stale)));

  for (let index = 0; index < 40; index += 1) {
    const [next] = await db
      .select({ id: receipts.id })
      .from(receipts)
      .where(and(eq(receipts.companyId, companyId), eq(receipts.status, "queued")))
      .orderBy(asc(receipts.createdAt))
      .limit(1);
    if (!next) return;
    const claimed = await db
      .update(receipts)
      .set({ status: "processing", updatedAt: new Date(), error: null })
      .where(and(eq(receipts.id, next.id), eq(receipts.status, "queued")))
      .returning();
    const receipt = claimed[0];
    if (!receipt) continue;
    try {
      await processReceipt(receipt);
    } catch (error) {
      const message = error instanceof BooksError ? error.message : "Extraction failed before a journal entry could be posted.";
      await db
        .update(receipts)
        .set({ status: "failed", error: message, updatedAt: new Date(), processedAt: new Date() })
        .where(eq(receipts.id, receipt.id));
    }
  }
}

async function processReceipt(receipt: typeof receipts.$inferSelect): Promise<void> {
  const db = getDb();
  const categoryRows = await db
    .select({ name: categories.name })
    .from(categories)
    .where(and(eq(categories.companyId, receipt.companyId), eq(categories.active, true)));
  const bytes = await loadStoredBytes(
    { fileData: receipt.fileData, storageKey: receipt.storageKey },
    receipt.storageKey ? objectStorage() : null
  );
  let detectionWarning: string | null = null;
  if (!receipt.parentReceiptId && IMAGE_TYPES.has(receipt.mimeType)) {
    const separated = await separateReceipts(db, receipt, bytes);
    if (separated === "done") return;
    detectionWarning = separated;
  }
  const extract = await extractDocument({
    fileName: receipt.fileName,
    mimeType: receipt.mimeType,
    bytes,
    txnType: receipt.txnType as TxnType,
    categories: categoryRows.map((row) => row.name)
  });
  if (detectionWarning) extract.warnings = [...extract.warnings, detectionWarning].slice(0, 8);
  const documentKind = classifyDocument(`${extract.merchant} ${extract.description}`);
  await db.transaction(async (tx) => {
    await tx
      .update(receipts)
      .set({
        status: "extracted",
        documentKind,
        extractionSource: extract.source,
        rawExtract: extract,
        error: null,
        updatedAt: new Date(),
        processedAt: new Date()
      })
      .where(eq(receipts.id, receipt.id));
    await settleExtractedReceipt(tx, {
      companyId: receipt.companyId,
      receiptId: receipt.id,
      userId: receipt.uploadedBy
    });
  });
}

async function separateReceipts(
  db: ReturnType<typeof getDb>,
  document: typeof receipts.$inferSelect,
  bytes: Buffer
): Promise<"done" | string | null> {
  let prepared;
  try {
    prepared = await prepareReceiptImage(bytes);
  } catch {
    return "EasySlip could not check this photo for more than one receipt, so it was read as a single document.";
  }

  const located = await locateReceipts({ bytes: prepared.preview });
  if (located.status === "skip") return null;
  if (located.status === "warning") return located.warning;

  const plan = planReceiptSplit(located.value);
  if (plan.action === "single") return null;
  if (plan.action === "unseparated") {
    await markReceiptsUnseparated(db, document.id, plan.count, plan.reason);
    return "done";
  }

  try {
    const crops = await cropReceiptBoxes(prepared.full, plan.boxes, prepared.width, prepared.height);
    await saveReceiptCrops(db, {
      parentId: document.id,
      companyId: document.companyId,
      userId: document.uploadedBy,
      batchId: document.batchId,
      txnType: document.txnType,
      settlementAccountId: document.settlementAccountId,
      boxes: plan.boxes,
      crops
    });
    return "done";
  } catch (error) {
    const detail = error instanceof Error ? error.message.slice(0, 160) : "The crops could not be saved.";
    await markReceiptsUnseparated(
      db,
      document.id,
      plan.boxes.length,
      `${plan.boxes.length} receipts found, but EasySlip could not separate the photo (${detail}). Nothing was dropped. Open the photo, or upload each slip on its own.`
    );
    return "done";
  }
}
