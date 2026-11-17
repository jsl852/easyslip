import { readFileSync, readdirSync } from "node:fs";
import { getTableColumns, getTableName } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  accounts,
  companies,
  expenseRelations,
  expenses,
  journalLines,
  memberships,
  receipts,
  users
} from "../src/lib/server/db/schema";

const migrationSql = readdirSync("drizzle")
  .filter((name) => name.endsWith(".sql"))
  .sort()
  .map((name) => readFileSync(`drizzle/${name}`, "utf8"))
  .join("\n");

describe("expense schema", () => {
  it("books an expense separately from the receipts attached to it", () => {
    expect(getTableName(expenses)).toBe("expenses");
    expect(getTableName(receipts)).toBe("receipts");
    expect(getTableName(expenseRelations)).toBe("expense_relations");

    const expenseColumns = getTableColumns(expenses);
    expect(expenseColumns.txnDate).toBeTruthy();
    expect(expenseColumns.merchant).toBeTruthy();
    expect(expenseColumns.description).toBeTruthy();
    expect(expenseColumns.categoryId).toBeTruthy();
    expect(expenseColumns.amount).toBeTruthy();
    expect(expenseColumns.currency).toBeTruthy();
    expect(expenseColumns.paymentMethod).toBeTruthy();
    expect(expenseColumns.reviewStatus).toBeTruthy();
    expect(expenseColumns.groupConfidence).toBeTruthy();

    const receiptColumns = getTableColumns(receipts);
    expect(receiptColumns.expenseId).toBeTruthy();
    expect(receiptColumns.fileData).toBeTruthy();
    expect(receiptColumns.storageKey).toBeTruthy();
    expect(receiptColumns.parentReceiptId).toBeTruthy();
    expect(receiptColumns.documentKind).toBeTruthy();
    expect("transactionId" in getTableColumns(journalLines)).toBe(false);
    expect(getTableColumns(journalLines).expenseId).toBeTruthy();
  });

  it("preserves people, companies, and the chart while replacing receipt and journal tables", () => {
    expect(getTableName(users)).toBe("users");
    expect(getTableName(companies)).toBe("companies");
    expect(getTableName(memberships)).toBe("memberships");
    expect(getTableName(accounts)).toBe("accounts");

    const latest = readFileSync(
      `drizzle/${readdirSync("drizzle").filter((name) => name.startsWith("0003_")).sort().at(-1)}`,
      "utf8"
    );
    expect(latest).toMatch(/DROP TABLE IF EXISTS "journal_lines"/);
    expect(latest).toMatch(/DROP TABLE IF EXISTS "transactions"/);
    expect(latest).toMatch(/DROP TABLE IF EXISTS "documents"/);
    expect(latest).toMatch(/CREATE TABLE "expenses"/);
    expect(latest).toMatch(/CREATE TABLE "receipts"/);
    expect(latest).toMatch(/CREATE TABLE "expense_relations"/);
    expect(latest).not.toMatch(/DROP TABLE[^;]*"users"/);
    expect(latest).not.toMatch(/DROP TABLE[^;]*"companies"/);
    expect(latest).not.toMatch(/DROP TABLE[^;]*"memberships"/);
    expect(latest).not.toMatch(/DROP TABLE[^;]*"accounts"/);
    expect(migrationSql).toMatch(/CREATE TABLE "users"/);
  });
});
