import { describe, expect, it } from "vitest";
import { starterAccounts, starterCategories, starterRules } from "../src/lib/accounting/chart";
import { stubExtract, sanitizeModelExtract } from "../src/lib/accounting/extract";
import { parseFilenameHint } from "../src/lib/accounting/filename-hint";
import { buildJournalEntry, entryIsBalanced } from "../src/lib/accounting/journal";
import { defaultCategoryId, matchKeyword } from "../src/lib/accounting/keywords";
import { toCents } from "../src/lib/accounting/money";
import { buildStatements } from "../src/lib/accounting/statements";
import type { JournalLeg, LedgerAccount, OpeningInput } from "../src/lib/accounting/types";

const accounts: LedgerAccount[] = [
  { id: "cash", code: "1100", name: "Current account", type: "asset", normalBalance: "debit", plGroup: null },
  { id: "capital", code: "3000", name: "Owner's capital", type: "equity", normalBalance: "credit", plGroup: null },
  { id: "sales", code: "4000", name: "Sales", type: "revenue", normalBalance: "credit", plGroup: "revenue" },
  { id: "meals", code: "6000", name: "Meals", type: "expense", normalBalance: "debit", plGroup: "expense" }
];

describe("journal entries", () => {
  it("debits an expense and credits the settlement account", () => {
    const entry = buildJournalEntry({
      type: "expense",
      amountCents: 8000,
      settlementAccountId: "cash",
      categoryAccountId: "meals",
      categoryId: "cat"
    });
    expect(entry.docTypeCode).toBe("EJ");
    expect(entryIsBalanced(entry.lines)).toBe(true);
    expect(entry.lines[0]).toMatchObject({ accountId: "meals", debitCents: 8000, creditCents: 0 });
    expect(entry.lines[1]).toMatchObject({ accountId: "cash", debitCents: 0, creditCents: 8000 });
  });

  it("debits cash and credits revenue for a sale", () => {
    const entry = buildJournalEntry({
      type: "sales",
      amountCents: 50000,
      settlementAccountId: "cash",
      categoryAccountId: "sales",
      categoryId: "cat"
    });
    expect(entry.docTypeCode).toBe("SJ");
    expect(entryIsBalanced(entry.lines)).toBe(true);
    expect(entry.lines.map((line) => line.debitCents - line.creditCents)).toEqual([50000, -50000]);
  });

  it("rejects a category that posts back to the same settlement account", () => {
    expect(() =>
      buildJournalEntry({
        type: "purchase",
        amountCents: 100,
        settlementAccountId: "cash",
        categoryAccountId: "cash",
        categoryId: "cat"
      })
    ).toThrow(/different/);
  });
});

describe("statements", () => {
  const openings: OpeningInput[] = [
    { accountId: "cash", asOf: "2024-01-01", debitBalanceCents: 1_000_000 },
    { accountId: "capital", asOf: "2024-01-01", debitBalanceCents: -1_000_000 }
  ];

  function leg(accountId: string, date: string, debitCents: number, creditCents: number): JournalLeg {
    return { accountId, date, debitCents, creditCents };
  }

  it("rolls a period into a balanced balance sheet and profit and loss", () => {
    const lines = [
      leg("cash", "2024-02-01", 50000, 0),
      leg("sales", "2024-02-01", 0, 50000),
      leg("meals", "2024-02-02", 8000, 0),
      leg("cash", "2024-02-02", 0, 8000)
    ];
    const statements = buildStatements({
      accounts,
      openings,
      lines,
      periodFrom: "2024-01-01",
      periodTo: "2024-12-31"
    });
    expect(statements.totals.balanced).toBe(true);
    expect(statements.profitAndLoss.netIncomeCents).toBe(42000);
    expect(statements.balanceSheet.totalAssetsCents).toBe(1_042_000);
    expect(statements.balanceSheet.balanceCheckCents).toBe(0);
    expect(statements.balanceSheet.currentEarningsCents).toBe(42000);
  });

  it("keeps an out-of-period receipt in the opening and out of the period activity", () => {
    const lines = [
      leg("meals", "2023-06-01", 10000, 0),
      leg("cash", "2023-06-01", 0, 10000),
      leg("cash", "2024-03-01", 5000, 0),
      leg("sales", "2024-03-01", 0, 5000)
    ];
    const statements = buildStatements({
      accounts,
      openings: [
        { accountId: "cash", asOf: "2023-01-01", debitBalanceCents: 1_000_000 },
        { accountId: "capital", asOf: "2023-01-01", debitBalanceCents: -1_000_000 }
      ],
      lines,
      periodFrom: "2024-01-01",
      periodTo: "2024-12-31"
    });
    const cash = statements.trialBalance.find((row) => row.account.id === "cash");
    const meals = statements.trialBalance.find((row) => row.account.id === "meals");
    expect(cash?.openingCents).toBe(990_000);
    expect(cash?.periodDebitCents).toBe(5000);
    expect(meals?.periodDebitCents).toBe(0);
    expect(meals?.openingCents).toBe(10000);
    expect(statements.profitAndLoss.netIncomeCents).toBe(5000);
    expect(statements.balanceSheet.priorUnclosedCents).toBe(-10000);
    expect(statements.balanceSheet.balanceCheckCents).toBe(0);
  });

  it("shows an unbalanced opening instead of hiding it", () => {
    const statements = buildStatements({
      accounts,
      openings: [{ accountId: "cash", asOf: "2024-01-01", debitBalanceCents: 100 }],
      lines: [],
      periodFrom: "2024-01-01",
      periodTo: "2024-01-31"
    });
    expect(statements.balanceSheet.balanceCheckCents).not.toBe(0);
  });
});

describe("keywords and extraction fallback", () => {
  it("lets the higher-priority phrase win", () => {
    const categoryId = matchKeyword(
      [
        { pattern: "cafe", categoryId: "meals", priority: 5, active: true },
        { pattern: "microsoft", categoryId: "software", priority: 20, active: true },
        { pattern: "old", categoryId: "gone", priority: 50, active: false }
      ],
      "MICROSOFT 365 and a cafe"
    );
    expect(categoryId).toBe("software");
  });

  it("reads a dated amount from a file name only as a marked fallback", () => {
    expect(parseFilenameHint("2024-03-02_cafe-de-coral_86.50.jpg")).toEqual({
      date: "2024-03-02",
      merchant: "cafe de coral",
      amount: "86.50"
    });
    const extract = stubExtract("2024-03-02_cafe-de-coral_86.50.jpg");
    expect(extract.source).toBe("stub");
    expect(extract.amount).toBe("86.50");
    expect(extract.warnings.join(" ")).toMatch(/file name/i);
    expect(extract.warnings.join(" ")).toMatch(/AI fallback/i);
  });

  it("does not invent an amount when the model leaves it blank", () => {
    const extract = sanitizeModelExtract({ merchant: "Blurry shop", amount: null, confidence: 0.9 }, "grok-4-fast");
    expect(extract.amount).toBeNull();
    expect(extract.confidence).toBeLessThanOrEqual(0.2);
  });

  it("maps starter categories onto starter accounts", () => {
    const codes = new Set(starterAccounts.map((account) => account.code));
    for (const category of starterCategories) expect(codes.has(category.accountCode)).toBe(true);
    for (const rule of starterRules) {
      expect(starterCategories.some((category) => category.name === rule.categoryName)).toBe(true);
    }
    expect(defaultCategoryId(
      starterCategories.map((category, index) => ({ id: String(index), name: category.name, kind: category.kind })),
      "purchase"
    )).toBe(String(starterCategories.findIndex((category) => category.name === "Purchases")));
  });
});

describe("money", () => {
  it("rounds half-up cents from decimal strings", () => {
    expect(toCents("10.005")).toBe(1001);
    expect(toCents("10.1")).toBe(1010);
    expect(toCents("-2.50")).toBe(-250);
  });
});
