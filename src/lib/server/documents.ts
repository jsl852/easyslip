import { and, desc, eq, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { receiptSplitCount, splitReceiptFileName, type ReceiptBox } from "$lib/accounting/receipt-layout";
import type { TxnType } from "$lib/accounting/types";
import { type Database, type QueryClient } from "./db/client";
import { documents, transactions } from "./db/schema";
import { BooksError } from "./errors";
import { cleanFileName, MAX_BATCH, MAX_FILE_BYTES, sniffMime } from "./files";
import {
  deleteStoredKeys,
  documentStorageKey,
  hasStoredBytes,
  loadStoredBytes,
  objectStorage,
  placeFile,
  type ObjectStorage
} from "./object-store";

export async function saveBatch(
  db: QueryClient,
  input: { companyId: string; userId: string; txnType: TxnType; settlementAccountId: string; files: File[] },
  storage: ObjectStorage | null = objectStorage()
) {
  if (input.files.length === 0) throw new BooksError("Choose at least one PDF or image.");
  if (input.files.length > MAX_BATCH) throw new BooksError(`Upload up to ${MAX_BATCH} files at a time.`);
  const batchId = crypto.randomUUID();
  const prepared = [];
  for (const file of input.files) {
    if (file.size > MAX_FILE_BYTES) throw new BooksError(`${file.name} is larger than 8 MB.`);
    const bytes = Buffer.from(await file.arrayBuffer());
    const mimeType = sniffMime(bytes);
    if (!mimeType) throw new BooksError(`${file.name} is not a PDF, JPEG, PNG, GIF, or WebP.`);
    prepared.push({
      id: crypto.randomUUID(),
      fileName: cleanFileName(file.name || "document"),
      mimeType,
      bytes
    });
  }

  const uploaded: string[] = [];
  try {
    const rows = [];
    for (const item of prepared) {
      const storageKey = storage ? documentStorageKey(input.companyId, item.id) : null;
      if (storage && storageKey) {
        uploaded.push(storageKey);
        await placeFile(storage, { key: storageKey, body: item.bytes, contentType: item.mimeType });
      }
      rows.push({
        id: item.id,
        companyId: input.companyId,
        uploadedBy: input.userId,
        batchId,
        fileName: item.fileName,
        mimeType: item.mimeType,
        byteSize: item.bytes.length,
        fileData: storageKey ? null : item.bytes,
        storageKey,
        source: "upload",
        status: "queued",
        txnType: input.txnType,
        settlementAccountId: input.settlementAccountId
      });
    }
    await db.insert(documents).values(rows);
    return { batchId, count: rows.length };
  } catch (error) {
    if (storage && uploaded.length > 0) await deleteStoredKeys(storage, uploaded);
    throw error;
  }
}

export async function saveReceiptCrops(
  db: Database,
  input: {
    parentId: string;
    companyId: string;
    userId: string | null;
    batchId: string;
    txnType: string;
    settlementAccountId: string;
    boxes: ReceiptBox[];
    crops: Buffer[];
  },
  storage: ObjectStorage | null = objectStorage()
) {
  if (input.crops.length !== input.boxes.length || input.crops.length < 2) {
    throw new BooksError("Each detected receipt needs its own crop.");
  }
  const existing = await db
    .select({ id: documents.id })
    .from(documents)
    .where(eq(documents.parentDocumentId, input.parentId));
  if (existing.length > 0) {
    await markReceiptSplit(db, input.parentId, existing.length, []);
    return { count: existing.length };
  }

  const now = Date.now();
  const prepared = input.crops.map((bytes, index) => ({
    id: crypto.randomUUID(),
    fileName: splitReceiptFileName(input.boxes[index]?.label ?? "", index + 1, input.crops.length),
    bytes,
    createdAt: new Date(now + (input.crops.length - index) * 1000)
  }));
  const uploaded: string[] = [];
  try {
    const rows: (typeof documents.$inferInsert)[] = [];
    for (const item of prepared) {
      const storageKey = storage ? documentStorageKey(input.companyId, item.id) : null;
      if (storage && storageKey) {
        uploaded.push(storageKey);
        await placeFile(storage, { key: storageKey, body: item.bytes, contentType: "image/jpeg" });
      }
      rows.push({
        id: item.id,
        companyId: input.companyId,
        uploadedBy: input.userId,
        batchId: input.batchId,
        parentDocumentId: input.parentId,
        fileName: item.fileName,
        mimeType: "image/jpeg",
        byteSize: item.bytes.length,
        fileData: storageKey ? null : item.bytes,
        storageKey,
        source: "split",
        status: "queued",
        txnType: input.txnType,
        settlementAccountId: input.settlementAccountId,
        createdAt: item.createdAt,
        updatedAt: item.createdAt
      });
    }
    await db.transaction(async (tx) => {
      await tx.insert(documents).values(rows);
      await markReceiptSplit(
        tx,
        input.parentId,
        rows.length,
        input.boxes.map((box) => box.label)
      );
    });
    return { count: rows.length };
  } catch (error) {
    if (storage && uploaded.length > 0) await deleteStoredKeys(storage, uploaded);
    throw error;
  }
}

async function markReceiptSplit(db: QueryClient, parentId: string, count: number, labels: string[]) {
  await db
    .update(documents)
    .set({
      status: "split",
      error: null,
      extractionSource: null,
      rawExtract: { kind: "receipt-split", count, labels: labels.filter((label) => label.length > 0) },
      updatedAt: new Date(),
      processedAt: new Date()
    })
    .where(eq(documents.id, parentId));
}

export async function markReceiptsUnseparated(db: QueryClient, parentId: string, count: number, reason: string) {
  await db
    .update(documents)
    .set({
      status: "needs_split",
      error: reason,
      extractionSource: null,
      rawExtract: { kind: "receipt-split", count },
      updatedAt: new Date(),
      processedAt: new Date()
    })
    .where(eq(documents.id, parentId));
}

export async function listDocuments(db: QueryClient, companyId: string) {
  const parent = alias(documents, "parent_document");
  const rows = await db
    .select({
      id: documents.id,
      fileName: documents.fileName,
      mimeType: documents.mimeType,
      byteSize: documents.byteSize,
      status: documents.status,
      txnType: documents.txnType,
      extractionSource: documents.extractionSource,
      error: documents.error,
      createdAt: documents.createdAt,
      rawExtract: documents.rawExtract,
      transactionId: transactions.id,
      parentFileName: parent.fileName
    })
    .from(documents)
    .leftJoin(transactions, eq(transactions.documentId, documents.id))
    .leftJoin(parent, eq(parent.id, documents.parentDocumentId))
    .where(eq(documents.companyId, companyId))
    .orderBy(desc(documents.createdAt))
    .limit(80);

  const seen = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    const current = seen.get(row.id);
    if (!current || (!current.transactionId && row.transactionId)) seen.set(row.id, row);
  }
  return [...seen.values()].slice(0, 40).map((row) => ({
    id: row.id,
    fileName: row.fileName,
    mimeType: row.mimeType,
    byteSize: row.byteSize,
    status: row.status,
    txnType: row.txnType,
    extractionSource: row.extractionSource,
    error: row.error,
    createdAt: row.createdAt,
    transactionId: row.transactionId,
    parentFileName: row.parentFileName,
    receiptCount: receiptSplitCount(row.rawExtract)
  }));
}

export async function retryDocument(db: QueryClient, companyId: string, id: string) {
  const [row] = await db
    .update(documents)
    .set({ status: "queued", error: null, updatedAt: new Date() })
    .where(and(eq(documents.id, id), eq(documents.companyId, companyId), inArray(documents.status, ["failed", "needs_split"])))
    .returning({ id: documents.id });
  if (!row) throw new BooksError("Only a failed or unseparated photo can be retried.");
}

export async function readDocumentFile(
  db: QueryClient,
  companyId: string,
  id: string,
  storage?: ObjectStorage | null
) {
  const [row] = await db
    .select({
      fileName: documents.fileName,
      mimeType: documents.mimeType,
      fileData: documents.fileData,
      storageKey: documents.storageKey
    })
    .from(documents)
    .where(and(eq(documents.id, id), eq(documents.companyId, companyId)))
    .limit(1);
  if (!row) return null;
  if (!hasStoredBytes(row.fileData) && !row.storageKey) return null;
  const resolved = storage === undefined ? (row.storageKey ? objectStorage() : null) : storage;
  const fileData = await loadStoredBytes(row, resolved);
  return { fileName: row.fileName, mimeType: row.mimeType, fileData };
}
