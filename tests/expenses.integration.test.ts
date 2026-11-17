import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createCompanyForUser, getExpense, listExpenses, mergeExpenses, splitReceiptFromExpense } from "../src/lib/server/books";
import { closeDb, getDb } from "../src/lib/server/db/client";
import { companies, expenseRelations, expenses, journalLines, memberships, receipts, users } from "../src/lib/server/db/schema";
import { settleExtractedReceipt } from "../src/lib/server/grouping";
import type { ExtractResult } from "../src/lib/accounting/types";

const databaseUrl = process.env.DATABASE_URL;

const cardExtract: ExtractResult = {
  source: "xai",
  txnDate: "2026-10-13",
  merchant: "OWENS",
  description: "Food and beverages, Visa sale at Owens, Shop G02 G/F Maritime Square Tsing Yi",
  amount: "363.00",
  currency: "HKD",
  suggestedCategory: "Meals and entertainment",
  confidence: 0.93,
  warnings: []
};

const billExtract: ExtractResult = {
  source: "xai",
  txnDate: "2026-10-13",
  merchant: "Owens (青衣)",
  description: "Restaurant meal for 2 (pasta, oysters, egg tart, cake) plus 10% service charge; paid by Kpay",
  amount: "363.00",
  currency: "HKD",
  suggestedCategory: "Meals and entertainment",
  confidence: 0.91,
  warnings: []
};

describe.skipIf(!databaseUrl)("expense queries", () => {
  afterAll(async () => {
    await closeDb();
  });

  it("posts the Owens bill and Visa slip as one expense and one journal entry", async () => {
    const db = getDb();
    await migrate(db, { migrationsFolder: "drizzle" });
    const email = `expenses-${crypto.randomUUID()}@example.com`;
    const [user] = await db.insert(users).values({ email, name: "Expense test" }).returning();

    try {
      await db.transaction(async (tx) => {
        const company = await createCompanyForUser(tx, { userId: user.id, name: "Owens Co" });
        const chart = await import("../src/lib/server/db/schema");
        const accountRows = await tx.select().from(chart.accounts).where(eq(chart.accounts.companyId, company.id));
        const card = accountRows.find((row) => row.code === "2200");
        if (!card) throw new Error("settlement account missing");
        const batchId = crypto.randomUUID();
        const cardId = crypto.randomUUID();
        const billId = crypto.randomUUID();
        await tx.insert(receipts).values([
          receiptRow({ id: cardId, companyId: company.id, userId: user.id, batchId, accountId: card.id, extract: cardExtract, fileName: "visa-slip.jpg" }),
          receiptRow({ id: billId, companyId: company.id, userId: user.id, batchId, accountId: card.id, extract: billExtract, fileName: "owens-bill.jpg" })
        ]);

        await settleExtractedReceipt(tx, { companyId: company.id, receiptId: cardId, userId: user.id });
        await settleExtractedReceipt(tx, { companyId: company.id, receiptId: billId, userId: user.id });

        const rows = await listExpenses(tx, company.id, "expense");
        expect(rows).toHaveLength(1);
        expect(rows[0].amount).toBe("363.00");
        expect(rows[0].txnDate).toBe("2026-10-13");
        expect(rows[0].categoryName).toBe("Meals and entertainment");
        expect(rows[0].extractionSource).toBe("xai");
        expect(rows[0].receiptCount).toBe(2);
        expect(rows[0].description.toLowerCase()).toContain("pasta");
        expect(rows[0].paymentMethod).toBe("Visa");

        const detail = await getExpense(tx, company.id, rows[0].id);
        expect(detail?.receipts.map((receipt) => receipt.fileName).sort()).toEqual(["owens-bill.jpg", "visa-slip.jpg"]);
        expect(detail?.lines).toHaveLength(2);
        expect(detail?.suggestions).toEqual([]);

        const lines = await tx.select().from(journalLines).where(eq(journalLines.companyId, company.id));
        expect(lines).toHaveLength(2);
        expect(new Set(lines.map((line) => line.expenseId))).toEqual(new Set([rows[0].id]));

        const preserved = await tx.select({ id: companies.id }).from(companies).where(eq(companies.id, company.id));
        const member = await tx.select({ id: memberships.id }).from(memberships).where(eq(memberships.userId, user.id));
        expect(preserved).toHaveLength(1);
        expect(member).toHaveLength(1);
        throw new Error("rollback");
      });
    } catch (error) {
      if (!(error instanceof Error) || error.message !== "rollback") throw error;
    } finally {
      await db.delete(users).where(eq(users.id, user.id));
    }
  });

  it("suggests a weaker pair and can merge it back to one journal entry", async () => {
    const db = getDb();
    await migrate(db, { migrationsFolder: "drizzle" });
    const email = `suggest-${crypto.randomUUID()}@example.com`;
    const [user] = await db.insert(users).values({ email, name: "Suggest test" }).returning();

    try {
      await db.transaction(async (tx) => {
        const company = await createCompanyForUser(tx, { userId: user.id, name: "Suggest Co" });
        const chart = await import("../src/lib/server/db/schema");
        const accountRows = await tx.select().from(chart.accounts).where(eq(chart.accounts.companyId, company.id));
        const cash = accountRows.find((row) => row.code === "1100");
        if (!cash) throw new Error("cash account missing");
        const batchId = crypto.randomUUID();
        const cafeId = crypto.randomUUID();
        const bakeryId = crypto.randomUUID();
        await tx.insert(receipts).values([
          receiptRow({
            id: cafeId,
            companyId: company.id,
            userId: user.id,
            batchId,
            accountId: cash.id,
            fileName: "cafe.jpg",
            extract: { ...cardExtract, merchant: "Cafe", description: "Coffee", amount: "80.00", suggestedCategory: "Meals and entertainment" }
          }),
          receiptRow({
            id: bakeryId,
            companyId: company.id,
            userId: user.id,
            batchId,
            accountId: cash.id,
            fileName: "bakery.jpg",
            extract: { ...cardExtract, merchant: "Bakery", description: "Bread", amount: "80.00", suggestedCategory: "Meals and entertainment" }
          })
        ]);
        await settleExtractedReceipt(tx, { companyId: company.id, receiptId: cafeId, userId: user.id });
        await settleExtractedReceipt(tx, { companyId: company.id, receiptId: bakeryId, userId: user.id });

        const rows = await listExpenses(tx, company.id);
        expect(rows).toHaveLength(2);
        expect(rows.every((row) => row.receiptCount === 1)).toBe(true);
        const relations = await tx.select().from(expenseRelations).where(eq(expenseRelations.companyId, company.id));
        expect(relations).toHaveLength(1);
        expect(relations[0].status).toBe("suggested");
        expect(Number(relations[0].confidence)).toBeLessThanOrEqual(0.9);

        const linesBefore = await tx.select().from(journalLines).where(eq(journalLines.companyId, company.id));
        expect(linesBefore).toHaveLength(4);

        await mergeExpenses(tx, {
          companyId: company.id,
          userId: user.id,
          targetId: rows[0].id,
          sourceId: rows[1].id
        });
        const after = await tx.select().from(expenses).where(eq(expenses.companyId, company.id));
        const linesAfter = await tx.select().from(journalLines).where(eq(journalLines.companyId, company.id));
        const attached = await tx.select().from(receipts).where(eq(receipts.companyId, company.id));
        expect(after).toHaveLength(1);
        expect(linesAfter).toHaveLength(2);
        expect(attached.every((receipt) => receipt.expenseId === after[0].id)).toBe(true);

        const splitId = await splitReceiptFromExpense(tx, {
          companyId: company.id,
          userId: user.id,
          expenseId: after[0].id,
          receiptId: attached[0].id
        });
        const splitExpenses = await tx.select().from(expenses).where(eq(expenses.companyId, company.id));
        const splitLines = await tx.select().from(journalLines).where(eq(journalLines.companyId, company.id));
        const splitReceipts = await tx.select().from(receipts).where(eq(receipts.companyId, company.id));
        expect(splitExpenses).toHaveLength(2);
        expect(splitLines).toHaveLength(4);
        expect(splitReceipts.map((receipt) => receipt.expenseId).sort()).toEqual(splitExpenses.map((expense) => expense.id).sort());
        expect(splitId).not.toBe(after[0].id);
        throw new Error("rollback");
      });
    } catch (error) {
      if (!(error instanceof Error) || error.message !== "rollback") throw error;
    } finally {
      await db.delete(users).where(eq(users.id, user.id));
    }
  });
});

function receiptRow(input: {
  id: string;
  companyId: string;
  userId: string;
  batchId: string;
  accountId: string;
  extract: ExtractResult;
  fileName: string;
}) {
  return {
    id: input.id,
    companyId: input.companyId,
    uploadedBy: input.userId,
    batchId: input.batchId,
    fileName: input.fileName,
    mimeType: "image/jpeg",
    byteSize: 4,
    fileData: Buffer.from("jpeg"),
    storageKey: null,
    source: "split",
    status: "extracted",
    txnType: "expense",
    settlementAccountId: input.accountId,
    extractionSource: input.extract.source,
    rawExtract: input.extract
  };
}
