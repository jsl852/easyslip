import { and, asc, eq, lt } from "drizzle-orm";
import { planReceiptSplit } from "$lib/accounting/receipt-layout";
import type { TxnType } from "$lib/accounting/types";
import { postFromExtraction } from "./books";
import { getDb } from "./db/client";
import { categories, documents } from "./db/schema";
import { markReceiptsUnseparated, saveReceiptCrops } from "./documents";
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
    .update(documents)
    .set({ status: "queued", updatedAt: new Date() })
    .where(and(eq(documents.companyId, companyId), eq(documents.status, "processing"), lt(documents.updatedAt, stale)));

  for (let index = 0; index < 40; index += 1) {
    const [next] = await db
      .select({ id: documents.id })
      .from(documents)
      .where(and(eq(documents.companyId, companyId), eq(documents.status, "queued")))
      .orderBy(asc(documents.createdAt))
      .limit(1);
    if (!next) return;
    const claimed = await db
      .update(documents)
      .set({ status: "processing", updatedAt: new Date(), error: null })
      .where(and(eq(documents.id, next.id), eq(documents.status, "queued")))
      .returning();
    const document = claimed[0];
    if (!document) continue;
    try {
      await processDocument(document);
    } catch (error) {
      const message = error instanceof BooksError ? error.message : "Extraction failed before a journal entry could be posted.";
      await db
        .update(documents)
        .set({ status: "failed", error: message, updatedAt: new Date(), processedAt: new Date() })
        .where(eq(documents.id, document.id));
    }
  }
}

async function processDocument(document: typeof documents.$inferSelect): Promise<void> {
  const db = getDb();
  const categoryRows = await db
    .select({ name: categories.name })
    .from(categories)
    .where(and(eq(categories.companyId, document.companyId), eq(categories.active, true)));
  const bytes = await loadStoredBytes(
    { fileData: document.fileData, storageKey: document.storageKey },
    document.storageKey ? objectStorage() : null
  );
  let detectionWarning: string | null = null;
  if (!document.parentDocumentId && IMAGE_TYPES.has(document.mimeType)) {
    const separated = await separateReceipts(db, document, bytes);
    if (separated === "done") return;
    detectionWarning = separated;
  }
  const extract = await extractDocument({
    fileName: document.fileName,
    mimeType: document.mimeType,
    bytes,
    txnType: document.txnType as TxnType,
    categories: categoryRows.map((row) => row.name)
  });
  if (detectionWarning) extract.warnings = [...extract.warnings, detectionWarning].slice(0, 8);
  await db.transaction(async (tx) => {
    await postFromExtraction(tx, {
      companyId: document.companyId,
      userId: document.uploadedBy,
      documentId: document.id,
      txnType: document.txnType as TxnType,
      settlementAccountId: document.settlementAccountId,
      extract
    });
    await tx
      .update(documents)
      .set({
        status: "extracted",
        extractionSource: extract.source,
        rawExtract: extract,
        error: null,
        updatedAt: new Date(),
        processedAt: new Date()
      })
      .where(eq(documents.id, document.id));
  });
}

async function separateReceipts(
  db: ReturnType<typeof getDb>,
  document: typeof documents.$inferSelect,
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
