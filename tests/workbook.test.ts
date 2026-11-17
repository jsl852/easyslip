import { describe, expect, it } from "vitest";
import { buildStatements } from "../src/lib/accounting/statements";
import type { LedgerAccount } from "../src/lib/accounting/types";
import { buildWorkbook } from "../src/lib/server/excel";
import ExcelJS from "exceljs";

const accounts: LedgerAccount[] = [
  { id: "cash", code: "1100", name: "Current account", type: "asset", normalBalance: "debit", plGroup: null },
  { id: "capital", code: "3000", name: "Capital", type: "equity", normalBalance: "credit", plGroup: null },
  { id: "sales", code: "4000", name: "Sales", type: "revenue", normalBalance: "credit", plGroup: "revenue" },
  { id: "meals", code: "6000", name: "Meals", type: "expense", normalBalance: "debit", plGroup: "expense" }
];

describe("excel pack", () => {
  it("writes journal values and trial-balance formulas that cache the same roll-up", async () => {
    const statements = buildStatements({
      accounts,
      openings: [
        { accountId: "cash", asOf: "2024-01-01", debitBalanceCents: 100000 },
        { accountId: "capital", asOf: "2024-01-01", debitBalanceCents: -100000 }
      ],
      lines: [
        { accountId: "cash", date: "2024-02-01", debitCents: 5000, creditCents: 0 },
        { accountId: "sales", date: "2024-02-01", debitCents: 0, creditCents: 5000 },
        { accountId: "meals", date: "2024-02-02", debitCents: 800, creditCents: 0 },
        { accountId: "cash", date: "2024-02-02", debitCents: 0, creditCents: 800 }
      ],
      periodFrom: "2024-01-01",
      periodTo: "2024-12-31"
    });
    const file = await buildWorkbook({
      companyName: "Harbour Lane",
      currency: "HKD",
      periodFrom: "2024-01-01",
      periodTo: "2024-12-31",
      generatedAt: new Date("2024-12-31T00:00:00Z"),
      statements,
      journal: [
        {
          date: "2024-02-01",
          docType: "SJ",
          description: "Sale",
          accountCode: "1100",
          accountName: "Current account",
          debitCents: 5000,
          creditCents: 0,
          category: "",
          transactionId: "sale"
        },
        {
          date: "2024-02-01",
          docType: "SJ",
          description: "Sale",
          accountCode: "4000",
          accountName: "Sales",
          debitCents: 0,
          creditCents: 5000,
          category: "Sales",
          transactionId: "sale"
        },
        {
          date: "2024-02-02",
          docType: "EJ",
          description: "Lunch",
          accountCode: "6000",
          accountName: "Meals",
          debitCents: 800,
          creditCents: 0,
          category: "Meals",
          transactionId: "meal"
        },
        {
          date: "2024-02-02",
          docType: "EJ",
          description: "Lunch",
          accountCode: "1100",
          accountName: "Current account",
          debitCents: 0,
          creditCents: 800,
          category: "",
          transactionId: "meal"
        }
      ]
    });

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(file as never);
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(
      expect.arrayContaining(["Cover", "JL", "SJ", "PJ", "EJ", "TB", "PL", "BS"])
    );
    const jl = workbook.getWorksheet("JL");
    expect(jl?.getCell("A2").value).toBe("2024-02-01");
    expect(jl?.getCell("D2").value).toBe("1100");
    expect(jl?.getCell("F2").value).toBe(50);

    const tb = workbook.getWorksheet("TB");
    const cash = tb?.getRow(2);
    expect(cash?.getCell(1).value).toBe("1100");
    expect(cash?.getCell(6).value).toBe(1000);
    const periodDebit = cash?.getCell(9).value as { formula: string; result: number };
    expect(periodDebit.formula).toContain("SUMIF");
    expect(periodDebit.result).toBe(50);
    const natural = cash?.getCell(12).value as { formula: string; result: number };
    expect(natural.formula).toContain("IF");
    expect(natural.result).toBe(1042);

    const pl = workbook.getWorksheet("PL");
    const net = pl?.getCell("A1").value;
    expect(String(net)).toContain("Profit and loss");
    const defined = workbook.definedNames.getRanges("NetIncome");
    expect(defined?.ranges?.length ?? defined).toBeTruthy();
  });
});
