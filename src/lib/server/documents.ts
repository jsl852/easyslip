import { and, desc, eq } from "drizzle-orm";
import type { TxnType } from "$lib/accounting/types";
import { type QueryClient } from "./db/client";
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

export async function listDocuments(db: QueryClient, companyId: string) {
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
      transactionId: transactions.id
    })
    .from(documents)
    .leftJoin(transactions, eq(transactions.documentId, documents.id))
    .where(eq(documents.companyId, companyId))
    .orderBy(desc(documents.createdAt))
    .limit(80);

  const seen = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    const current = seen.get(row.id);
    if (!current || (!current.transactionId && row.transactionId)) seen.set(row.id, row);
  }
  return [...seen.values()].slice(0, 40);
}

export async function retryDocument(db: QueryClient, companyId: string, id: string) {
  const [row] = await db
    .update(documents)
    .set({ status: "queued", error: null, updatedAt: new Date() })
    .where(and(eq(documents.id, id), eq(documents.companyId, companyId), eq(documents.status, "failed")))
    .returning({ id: documents.id });
  if (!row) throw new BooksError("Only a failed document can be retried.");
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
