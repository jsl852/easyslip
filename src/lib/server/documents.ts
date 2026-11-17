import { and, desc, eq, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { receiptSplitCount, splitReceiptFileName, type ReceiptBox } from "$lib/accounting/receipt-layout";
import type { TxnType } from "$lib/accounting/types";
import { foldUploadFeed, type UploadExpenseFields, type UploadFeedRow, type UploadReceiptCard } from "$lib/accounting/upload-feed";
import { type Database, type QueryClient } from "./db/client";
import { expenses, receipts } from "./db/schema";
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
  input: {
    companyId: string;
    userId: string;
    txnType: TxnType;
    settlementAccountId: string;
    files: File[];
    expenseId?: string | null;
  },
  storage: ObjectStorage | null = objectStorage()
) {
  if (input.files.length === 0) throw new BooksError("Choose at least one PDF or image.");
  if (input.files.length > MAX_BATCH) throw new BooksError(`Upload up to ${MAX_BATCH} files at a time.`);
  if (input.expenseId) {
    const [expense] = await db
      .select({ id: expenses.id })
      .from(expenses)
      .where(and(eq(expenses.id, input.expenseId), eq(expenses.companyId, input.companyId)))
      .limit(1);
    if (!expense) throw new BooksError("Expense not found.");
  }
  const batchId = crypto.randomUUID();
  const prepared = [];
  for (const file of input.files) {
    if (file.size > MAX_FILE_BYTES) throw new BooksError(`${file.name} is larger than 8 MB.`);
    const bytes = Buffer.from(await file.arrayBuffer());
    const mimeType = sniffMime(bytes);
    if (!mimeType) throw new BooksError(`${file.name} is not a PDF, JPEG, PNG, GIF, or WebP.`);
    prepared.push({
      id: crypto.randomUUID(),
      fileName: cleanFileName(file.name || "receipt"),
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
        expenseId: input.expenseId ?? null,
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
    await db.insert(receipts).values(rows);
    return { batchId, count: rows.length, expenseId: input.expenseId ?? null };
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
    .select({ id: receipts.id })
    .from(receipts)
    .where(eq(receipts.parentReceiptId, input.parentId));
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
    const rows: (typeof receipts.$inferInsert)[] = [];
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
        parentReceiptId: input.parentId,
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
      await tx.insert(receipts).values(rows);
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
    .update(receipts)
    .set({
      status: "split",
      error: null,
      extractionSource: null,
      rawExtract: { kind: "receipt-split", count, labels: labels.filter((label) => label.length > 0) },
      updatedAt: new Date(),
      processedAt: new Date()
    })
    .where(eq(receipts.id, parentId));
}

export async function markReceiptsUnseparated(db: QueryClient, parentId: string, count: number, reason: string) {
  await db
    .update(receipts)
    .set({
      status: "needs_split",
      error: reason,
      extractionSource: null,
      rawExtract: { kind: "receipt-split", count },
      updatedAt: new Date(),
      processedAt: new Date()
    })
    .where(eq(receipts.id, parentId));
}

export async function listUploadFeed(db: QueryClient, companyId: string) {
  const parent = alias(receipts, "parent_receipt");
  const rows = await db
    .select({
      id: receipts.id,
      fileName: receipts.fileName,
      mimeType: receipts.mimeType,
      status: receipts.status,
      extractionSource: receipts.extractionSource,
      error: receipts.error,
      createdAt: receipts.createdAt,
      rawExtract: receipts.rawExtract,
      expenseId: receipts.expenseId,
      documentKind: receipts.documentKind,
      parentFileName: parent.fileName,
      expenseDescription: expenses.description,
      expenseMerchant: expenses.merchant,
      expenseAmount: expenses.amount,
      expenseDate: expenses.txnDate,
      expenseReview: expenses.reviewStatus,
      expenseSource: expenses.extractionSource,
      groupConfidence: expenses.groupConfidence
    })
    .from(receipts)
    .leftJoin(parent, eq(parent.id, receipts.parentReceiptId))
    .leftJoin(expenses, eq(expenses.id, receipts.expenseId))
    .where(eq(receipts.companyId, companyId))
    .orderBy(desc(receipts.createdAt))
    .limit(80);

  const feed: UploadFeedRow[] = rows.map((row) => {
    const receipt: UploadReceiptCard = {
      id: row.id,
      fileName: row.fileName,
      mimeType: row.mimeType,
      status: row.status,
      extractionSource: row.extractionSource,
      error: row.error,
      createdAt: row.createdAt.toISOString(),
      parentFileName: row.parentFileName,
      receiptCount: receiptSplitCount(row.rawExtract),
      documentKind: row.documentKind,
      expenseId: row.expenseId
    };
    const expense: UploadExpenseFields | null =
      row.expenseId && row.expenseDescription && row.expenseAmount && row.expenseDate && row.expenseReview && row.expenseSource
        ? {
            id: row.expenseId,
            description: row.expenseDescription,
            merchant: row.expenseMerchant ?? "",
            amount: row.expenseAmount,
            txnDate: row.expenseDate,
            reviewStatus: row.expenseReview,
            extractionSource: row.expenseSource,
            groupConfidence: row.groupConfidence
          }
        : null;
    return { receipt, expense };
  });
  return foldUploadFeed(feed);
}

export async function retryDocument(db: QueryClient, companyId: string, id: string) {
  const [row] = await db
    .select({ id: receipts.id, status: receipts.status, expenseId: receipts.expenseId })
    .from(receipts)
    .where(and(eq(receipts.id, id), eq(receipts.companyId, companyId)))
    .limit(1);
  if (!row) throw new BooksError("Receipt not found.");
  let allowed = row.status === "failed" || row.status === "needs_split";
  if (!allowed && row.status === "extracted" && row.expenseId) {
    const [expense] = await db
      .select({ reviewStatus: expenses.reviewStatus })
      .from(expenses)
      .where(and(eq(expenses.id, row.expenseId), eq(expenses.companyId, companyId)))
      .limit(1);
    allowed = expense?.reviewStatus === "needs_review";
  }
  if (!allowed) throw new BooksError("Only a failed, unseparated, or unapproved receipt can be retried.");
  await db
    .update(receipts)
    .set({ status: "queued", error: null, updatedAt: new Date() })
    .where(and(eq(receipts.id, id), eq(receipts.companyId, companyId), inArray(receipts.status, [row.status])));
}

export async function readDocumentFile(
  db: QueryClient,
  companyId: string,
  id: string,
  storage?: ObjectStorage | null
) {
  const [row] = await db
    .select({
      fileName: receipts.fileName,
      mimeType: receipts.mimeType,
      fileData: receipts.fileData,
      storageKey: receipts.storageKey
    })
    .from(receipts)
    .where(and(eq(receipts.id, id), eq(receipts.companyId, companyId)))
    .limit(1);
  if (!row) return null;
  if (!hasStoredBytes(row.fileData) && !row.storageKey) return null;
  const resolved = storage === undefined ? (row.storageKey ? objectStorage() : null) : storage;
  const fileData = await loadStoredBytes(row, resolved);
  return { fileName: row.fileName, mimeType: row.mimeType, fileData };
}
