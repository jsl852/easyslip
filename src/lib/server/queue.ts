import { and, asc, eq, lt } from "drizzle-orm";
import type { TxnType } from "$lib/accounting/types";
import { postFromExtraction } from "./books";
import { getDb } from "./db/client";
import { categories, documents } from "./db/schema";
import { BooksError } from "./errors";
import { loadStoredBytes, objectStorage } from "./object-store";
import { extractDocument } from "./xai";

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
  const extract = await extractDocument({
    fileName: document.fileName,
    mimeType: document.mimeType,
    bytes,
    txnType: document.txnType as TxnType,
    categories: categoryRows.map((row) => row.name)
  });
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
