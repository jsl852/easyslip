import { and, desc, eq } from "drizzle-orm";
import type { TxnType } from "$lib/accounting/types";
import { type QueryClient } from "./db/client";
import { documents } from "./db/schema";
import { BooksError } from "./errors";
import { asBuffer, cleanFileName, MAX_BATCH, MAX_FILE_BYTES, sniffMime } from "./files";

export async function saveBatch(
  db: QueryClient,
  input: { companyId: string; userId: string; txnType: TxnType; settlementAccountId: string; files: File[] }
) {
  if (input.files.length === 0) throw new BooksError("Choose at least one PDF or image.");
  if (input.files.length > MAX_BATCH) throw new BooksError(`Upload up to ${MAX_BATCH} files at a time.`);
  const batchId = crypto.randomUUID();
  const rows = [];
  for (const file of input.files) {
    if (file.size > MAX_FILE_BYTES) throw new BooksError(`${file.name} is larger than 8 MB.`);
    const bytes = Buffer.from(await file.arrayBuffer());
    const mimeType = sniffMime(bytes);
    if (!mimeType) throw new BooksError(`${file.name} is not a PDF, JPEG, PNG, GIF, or WebP.`);
    rows.push({
      companyId: input.companyId,
      uploadedBy: input.userId,
      batchId,
      fileName: cleanFileName(file.name || "document"),
      mimeType,
      byteSize: bytes.length,
      fileData: bytes,
      source: "upload",
      status: "queued",
      txnType: input.txnType,
      settlementAccountId: input.settlementAccountId
    });
  }
  await db.insert(documents).values(rows);
  return { batchId, count: rows.length };
}

export async function listDocuments(db: QueryClient, companyId: string) {
  return db
    .select({
      id: documents.id,
      fileName: documents.fileName,
      mimeType: documents.mimeType,
      byteSize: documents.byteSize,
      status: documents.status,
      txnType: documents.txnType,
      extractionSource: documents.extractionSource,
      error: documents.error,
      createdAt: documents.createdAt
    })
    .from(documents)
    .where(eq(documents.companyId, companyId))
    .orderBy(desc(documents.createdAt))
    .limit(40);
}

export async function retryDocument(db: QueryClient, companyId: string, id: string) {
  const [row] = await db
    .update(documents)
    .set({ status: "queued", error: null, updatedAt: new Date() })
    .where(and(eq(documents.id, id), eq(documents.companyId, companyId), eq(documents.status, "failed")))
    .returning({ id: documents.id });
  if (!row) throw new BooksError("Only a failed document can be retried.");
}

export async function readDocumentFile(db: QueryClient, companyId: string, id: string) {
  const [row] = await db
    .select({ fileName: documents.fileName, mimeType: documents.mimeType, fileData: documents.fileData })
    .from(documents)
    .where(and(eq(documents.id, id), eq(documents.companyId, companyId)))
    .limit(1);
  if (!row) return null;
  return { fileName: row.fileName, mimeType: row.mimeType, fileData: asBuffer(row.fileData) };
}
