import { and, eq, ne } from "drizzle-orm";
import {
  AUTO_MERGE_CONFIDENCE,
  evidenceFromExtract,
  readExtract,
  scoreReceiptPair,
  SUGGEST_CONFIDENCE
} from "$lib/accounting/expense-group";
import type { TxnType } from "$lib/accounting/types";
import {
  linkReceiptToExpense,
  mergeExpenses,
  postExpenseFromReceipt,
  suggestExpensePair,
  syncExpenseWithReceipts
} from "./books";
import { type QueryClient } from "./db/client";
import { receipts } from "./db/schema";

export async function settleExtractedReceipt(
  db: QueryClient,
  input: { companyId: string; receiptId: string; userId: string | null }
) {
  const [receipt] = await db
    .select()
    .from(receipts)
    .where(and(eq(receipts.id, input.receiptId), eq(receipts.companyId, input.companyId)))
    .limit(1);
  if (!receipt) return;
  const extract = readExtract(receipt.rawExtract);
  if (!extract) return;
  if (receipt.expenseId) {
    await syncExpenseWithReceipts(db, {
      companyId: input.companyId,
      userId: input.userId,
      expenseId: receipt.expenseId
    });
    return;
  }

  const siblings = await db
    .select()
    .from(receipts)
    .where(
      and(
        eq(receipts.companyId, input.companyId),
        eq(receipts.batchId, receipt.batchId),
        ne(receipts.id, receipt.id),
        eq(receipts.status, "extracted")
      )
    );
  const ownEvidence = evidenceFromExtract(receipt.id, extract);
  const scored = siblings.flatMap((sibling) => {
    const siblingExtract = readExtract(sibling.rawExtract);
    if (!siblingExtract) return [];
    return [
      {
        sibling,
        score: scoreReceiptPair(ownEvidence, evidenceFromExtract(sibling.id, siblingExtract))
      }
    ];
  });
  const certain = scored.filter((item) => item.score.confidence > AUTO_MERGE_CONFIDENCE);
  const expenseIds = [...new Set(certain.map((item) => item.sibling.expenseId).filter((id): id is string => Boolean(id)))];

  if (certain.length === 0) {
    const expenseId = await postExpenseFromReceipt(db, {
      companyId: input.companyId,
      userId: input.userId,
      receiptId: receipt.id,
      txnType: receipt.txnType as TxnType,
      settlementAccountId: receipt.settlementAccountId,
      extract
    });
    for (const item of scored) {
      if (item.score.confidence < SUGGEST_CONFIDENCE || !item.sibling.expenseId) continue;
      await suggestExpensePair(db, {
        companyId: input.companyId,
        leftId: expenseId,
        rightId: item.sibling.expenseId,
        confidence: item.score.confidence,
        reason: item.score.reason
      });
    }
    return;
  }

  let targetId = expenseIds[0];
  if (!targetId) {
    targetId = await postExpenseFromReceipt(db, {
      companyId: input.companyId,
      userId: input.userId,
      receiptId: receipt.id,
      txnType: receipt.txnType as TxnType,
      settlementAccountId: receipt.settlementAccountId,
      extract
    });
  } else {
    for (const extra of expenseIds.slice(1)) {
      await mergeExpenses(db, {
        companyId: input.companyId,
        userId: input.userId,
        targetId,
        sourceId: extra,
        manual: false
      });
    }
    await linkReceiptToExpense(db, { companyId: input.companyId, receiptId: receipt.id, expenseId: targetId });
  }

  for (const item of certain) {
    if (!item.sibling.expenseId) {
      await linkReceiptToExpense(db, { companyId: input.companyId, receiptId: item.sibling.id, expenseId: targetId });
    }
  }
  await syncExpenseWithReceipts(db, { companyId: input.companyId, userId: input.userId, expenseId: targetId });

  for (const item of scored) {
    if (item.score.confidence > AUTO_MERGE_CONFIDENCE || item.score.confidence < SUGGEST_CONFIDENCE) continue;
    if (!item.sibling.expenseId || item.sibling.expenseId === targetId) continue;
    await suggestExpensePair(db, {
      companyId: input.companyId,
      leftId: targetId,
      rightId: item.sibling.expenseId,
      confidence: item.score.confidence,
      reason: item.score.reason
    });
  }
}
