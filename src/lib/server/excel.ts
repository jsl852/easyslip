import ExcelJS, { type Worksheet } from "exceljs";
import { centsToDecimal } from "$lib/accounting/money";
import type { Statements } from "$lib/accounting/types";

export type WorkbookJournalLine = {
  date: string;
  docType: string;
  description: string;
  accountCode: string;
  accountName: string;
  debitCents: number;
  creditCents: number;
  category: string;
  transactionId: string;
};

export type WorkbookInput = {
  companyName: string;
  currency: string;
  periodFrom: string;
  periodTo: string;
  generatedAt: Date;
  statements: Statements;
  journal: WorkbookJournalLine[];
};

const money = '#,##0.00;(#,##0.00);"–"';
const teal = "FF0F5F5A";
const yellow = "FFFFF4D2";
const ink = "FF1C1915";

function major(cents: number): number {
  return Number(centsToDecimal(cents));
}

function header(sheet: Worksheet, titles: string[]) {
  sheet.addRow(titles);
  const row = sheet.getRow(1);
  row.font = { name: "Calibri", bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
  row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: teal } };
  row.alignment = { vertical: "middle" };
  row.height = 22;
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: titles.length } };
}

function moneyCell(sheet: Worksheet, row: number, column: number, cents: number | null) {
  const cell = sheet.getCell(row, column);
  cell.value = cents === null || cents === 0 ? null : major(cents);
  cell.numFmt = money;
  return cell;
}

function formulaCell(sheet: Worksheet, row: number, column: number, formula: string, result: number) {
  const cell = sheet.getCell(row, column);
  cell.value = { formula, result };
  cell.numFmt = money;
  return cell;
}

function safeSheetName(code: string, name: string): string {
  const cleaned = `${code} ${name}`.replace(/[\\/*?:[\]]/g, " ").replace(/\s+/g, " ").trim();
  return cleaned.slice(0, 31) || code.slice(0, 31);
}

export async function buildWorkbook(input: WorkbookInput): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "EasySlip";
  workbook.created = input.generatedAt;
  workbook.modified = input.generatedAt;
  workbook.properties.date1904 = false;

  const cover = workbook.addWorksheet("Cover");
  const lines = [
    "EasySlip",
    input.companyName,
    `Reporting currency: ${input.currency}`,
    `Period: ${input.periodFrom} to ${input.periodTo}`,
    "",
    "Journal lines on JL are the source of truth for this period. Out-of-period documents stay in EasySlip and are left out of this workbook.",
    "SJ, PJ, EJ, and the account sheets list those lines with formulas. Trial balance openings are yellow and editable.",
    "Opening amounts are debit-positive on the helper column: debits positive, credits negative. Edit the debit or credit opening cells, not the formulas.",
    "Balance Sheet and Profit & Loss read the trial balance. Current period earnings on the balance sheet is the P&L net income.",
    "Prior unclosed results picks up profit and loss balances from before this period so the balance sheet still ties when those accounts were not closed to equity.",
    "This workbook is working-paper support for a Hong Kong SME. It is not a profits-tax return and it does not replace a review by an accountant.",
    `Generated ${input.generatedAt.toISOString()}`
  ];
  lines.forEach((line, index) => {
    const cell = cover.getCell(index + 1, 1);
    cell.value = line;
    cell.alignment = { wrapText: true, vertical: "top" };
    if (index === 0) cell.font = { name: "Calibri", bold: true, size: 20, color: { argb: teal } };
    else if (index === 1) cell.font = { name: "Calibri", bold: true, size: 14, color: { argb: ink } };
    else cell.font = { name: "Calibri", size: 12, color: { argb: ink } };
  });
  cover.getColumn(1).width = 120;

  const last = Math.max(2, input.journal.length + 1);
  const jl = workbook.addWorksheet("JL");
  header(jl, ["Date", "DocType", "Description", "AccountCode", "AccountName", "Debit", "Credit", "Category", "TransactionId"]);
  input.journal.forEach((line) => {
    const row = jl.addRow([
      line.date,
      line.docType,
      line.description,
      line.accountCode,
      line.accountName,
      line.debitCents ? major(line.debitCents) : null,
      line.creditCents ? major(line.creditCents) : null,
      line.category,
      line.transactionId
    ]);
    row.getCell(6).numFmt = money;
    row.getCell(7).numFmt = money;
  });
  jl.columns.forEach((column, index) => {
    column.width = [12, 10, 42, 14, 32, 14, 14, 28, 38][index] ?? 16;
  });
  jl.getColumn(4).numFmt = "@";

  const codeRange = `JL!$D$2:$D$${last}`;
  const debitRange = `JL!$F$2:$F$${last}`;
  const creditRange = `JL!$G$2:$G$${last}`;
  const typeRange = `JL!$B$2:$B$${last}`;

  function listingSheet(name: string, title: string, matchFormula: string) {
    const sheet = workbook.addWorksheet(name);
    sheet.getCell(1, 1).value = title;
    sheet.getCell(1, 1).font = { bold: true, size: 14, color: { argb: teal } };
    sheet.getCell(2, 1).value = "Period debits";
    formulaCell(sheet, 2, 2, matchFormula.replaceAll("{amount}", debitRange), 0);
    sheet.getCell(3, 1).value = "Period credits";
    formulaCell(sheet, 3, 2, matchFormula.replaceAll("{amount}", creditRange), 0);
    sheet.getCell(5, 1).value = "Lines (Excel 365 FILTER — the totals above use SUMIF and work in older Excel too)";
    sheet.getCell(5, 1).font = { italic: true, color: { argb: "FF5C564C" } };
    sheet.getColumn(1).width = 88;
    sheet.getColumn(2).width = 18;
    return sheet;
  }

  for (const docType of ["SJ", "PJ", "EJ"] as const) {
    const label = docType === "SJ" ? "Sales journal" : docType === "PJ" ? "Purchase journal" : "Expense journal";
    const sheet = listingSheet(docType, `${label} (${docType})`, `SUMIF(${typeRange},"${docType}",{amount})`);
    const cached = input.journal.filter((line) => line.docType === docType);
    sheet.getCell(2, 2).value = {
      formula: `SUMIF(${typeRange},"${docType}",${debitRange})`,
      result: major(cached.reduce((sum, line) => sum + line.debitCents, 0))
    };
    sheet.getCell(3, 2).value = {
      formula: `SUMIF(${typeRange},"${docType}",${creditRange})`,
      result: major(cached.reduce((sum, line) => sum + line.creditCents, 0))
    };
    sheet.getCell(2, 2).numFmt = money;
    sheet.getCell(3, 2).numFmt = money;
    sheet.getCell(6, 1).value = {
      formula: `IFERROR(FILTER(JL!A$2:I$${last},JL!B$2:B$${last}="${docType}"),"No journal lines in this period")`
    };
  }

  const usedNames = new Set(["Cover", "JL", "SJ", "PJ", "EJ", "TB", "PL", "BS"]);
  const accountSheets = input.statements.trialBalance.filter(
    (row) =>
      row.periodDebitCents !== 0 ||
      row.periodCreditCents !== 0 ||
      row.openingCents !== 0 ||
      row.account.type === "asset" ||
      row.account.type === "liability"
  );
  for (const row of accountSheets) {
    let name = safeSheetName(row.account.code, row.account.name);
    while (usedNames.has(name)) name = `${name.slice(0, 28)} ${usedNames.size}`.slice(0, 31);
    usedNames.add(name);
    const sheet = workbook.addWorksheet(name);
    sheet.getCell(1, 1).value = "Account";
    sheet.getCell(1, 2).value = row.account.code;
    sheet.getCell(1, 2).numFmt = "@";
    sheet.getCell(1, 3).value = row.account.name;
    sheet.getCell(1, 1).font = { bold: true };
    const debitFormula = `SUMIF(${codeRange},B1,${debitRange})`;
    const creditFormula = `SUMIF(${codeRange},B1,${creditRange})`;
    formulaCell(sheet, 2, 2, debitFormula, major(row.periodDebitCents));
    formulaCell(sheet, 3, 2, creditFormula, major(row.periodCreditCents));
    sheet.getCell(2, 1).value = "Period debits";
    sheet.getCell(3, 1).value = "Period credits";
    formulaCell(sheet, 4, 2, "B2-B3", major(row.periodDebitCents - row.periodCreditCents));
    sheet.getCell(4, 1).value = "Net debit / (credit)";
    sheet.getCell(6, 1).value = {
      formula: `IFERROR(FILTER(JL!A$2:I$${last},JL!D$2:D$${last}=B1),"No journal lines in this period")`
    };
    sheet.getColumn(1).width = 28;
    sheet.getColumn(2).width = 18;
    sheet.getColumn(3).width = 36;
    sheet.getRow(1).font = { bold: true, color: { argb: teal } };
  }

  const tb = workbook.addWorksheet("TB");
  header(tb, [
    "Code",
    "Name",
    "Type",
    "Normal",
    "PlGroup",
    "OpeningDebit",
    "OpeningCredit",
    "OpeningNet",
    "PeriodDebit",
    "PeriodCredit",
    "ClosingNet",
    "ClosingNatural",
    "PeriodNatural"
  ]);
  input.statements.trialBalance.forEach((row, index) => {
    const excelRow = index + 2;
    tb.getCell(excelRow, 1).value = row.account.code;
    tb.getCell(excelRow, 1).numFmt = "@";
    tb.getCell(excelRow, 2).value = row.account.name;
    tb.getCell(excelRow, 3).value = row.account.type;
    tb.getCell(excelRow, 4).value = row.account.normalBalance;
    tb.getCell(excelRow, 5).value = row.account.plGroup ?? "";
    const openingDebit = tb.getCell(excelRow, 6);
    openingDebit.value = major(row.openingDebitCents);
    openingDebit.numFmt = money;
    openingDebit.fill = { type: "pattern", pattern: "solid", fgColor: { argb: yellow } };
    openingDebit.protection = { locked: false };
    const openingCredit = tb.getCell(excelRow, 7);
    openingCredit.value = major(row.openingCreditCents);
    openingCredit.numFmt = money;
    openingCredit.fill = { type: "pattern", pattern: "solid", fgColor: { argb: yellow } };
    openingCredit.protection = { locked: false };
    formulaCell(tb, excelRow, 8, `F${excelRow}-G${excelRow}`, major(row.openingCents));
    formulaCell(
      tb,
      excelRow,
      9,
      `SUMIF(${codeRange},A${excelRow},${debitRange})`,
      major(row.periodDebitCents)
    );
    formulaCell(
      tb,
      excelRow,
      10,
      `SUMIF(${codeRange},A${excelRow},${creditRange})`,
      major(row.periodCreditCents)
    );
    formulaCell(tb, excelRow, 11, `H${excelRow}+I${excelRow}-J${excelRow}`, major(row.closingCents));
    formulaCell(
      tb,
      excelRow,
      12,
      `IF(D${excelRow}="debit",K${excelRow},-K${excelRow})`,
      major(row.naturalClosingCents)
    );
    formulaCell(
      tb,
      excelRow,
      13,
      `IF(D${excelRow}="debit",I${excelRow}-J${excelRow},J${excelRow}-I${excelRow})`,
      major(row.periodNaturalCents)
    );
  });
  tb.columns.forEach((column, index) => {
    column.width = [12, 32, 14, 12, 12, 16, 16, 16, 16, 16, 16, 18, 16][index] ?? 14;
  });
  await tb.protect("", {
    selectLockedCells: true,
    selectUnlockedCells: true,
    autoFilter: true
  });

  const pl = workbook.addWorksheet("PL");
  pl.getCell(1, 1).value = `${input.companyName} — Profit and loss`;
  pl.getCell(2, 1).value = `${input.periodFrom} to ${input.periodTo}`;
  pl.getCell(1, 1).font = { bold: true, size: 16, color: { argb: teal } };
  pl.getColumn(1).width = 36;
  pl.getColumn(2).width = 14;
  pl.getColumn(3).width = 18;
  let cursor = 4;
  const section = (title: string, rows: Statements["profitAndLoss"]["revenue"]) => {
    pl.getCell(cursor, 1).value = title;
    pl.getCell(cursor, 1).font = { bold: true };
    cursor += 1;
    const start = cursor;
    if (rows.length === 0) {
      pl.getCell(cursor, 1).value = "None";
      formulaCell(pl, cursor, 3, "0", 0);
      cursor += 1;
    } else {
      for (const row of rows) {
        pl.getCell(cursor, 1).value = row.account.name;
        pl.getCell(cursor, 2).value = row.account.code;
        pl.getCell(cursor, 2).numFmt = "@";
        formulaCell(
          pl,
          cursor,
          3,
          `IFERROR(INDEX(TB!M:M,MATCH(B${cursor},TB!A:A,0)),0)`,
          major(row.periodNaturalCents)
        );
        cursor += 1;
      }
    }
    const end = cursor - 1;
    return { start, end };
  };
  const revenue = section("Revenue", input.statements.profitAndLoss.revenue);
  formulaCell(pl, cursor, 3, `SUM(C${revenue.start}:C${revenue.end})`, major(input.statements.profitAndLoss.totalRevenueCents));
  pl.getCell(cursor, 1).value = "Total revenue";
  pl.getCell(cursor, 1).font = { bold: true };
  const totalRevenueRow = cursor;
  cursor += 2;
  const cogs = section("Cost of sales", input.statements.profitAndLoss.cogs);
  formulaCell(pl, cursor, 3, `SUM(C${cogs.start}:C${cogs.end})`, major(input.statements.profitAndLoss.totalCogsCents));
  pl.getCell(cursor, 1).value = "Total cost of sales";
  pl.getCell(cursor, 1).font = { bold: true };
  const totalCogsRow = cursor;
  cursor += 1;
  formulaCell(pl, cursor, 3, `C${totalRevenueRow}-C${totalCogsRow}`, major(input.statements.profitAndLoss.grossProfitCents));
  pl.getCell(cursor, 1).value = "Gross profit";
  pl.getCell(cursor, 1).font = { bold: true };
  const grossRow = cursor;
  cursor += 2;
  const expenses = section("Expenses", input.statements.profitAndLoss.expenses);
  formulaCell(pl, cursor, 3, `SUM(C${expenses.start}:C${expenses.end})`, major(input.statements.profitAndLoss.totalExpenseCents));
  pl.getCell(cursor, 1).value = "Total expenses";
  pl.getCell(cursor, 1).font = { bold: true };
  const totalExpenseRow = cursor;
  cursor += 2;
  formulaCell(pl, cursor, 3, `C${grossRow}-C${totalExpenseRow}`, major(input.statements.profitAndLoss.netIncomeCents));
  pl.getCell(cursor, 1).value = "Net income";
  pl.getCell(cursor, 1).font = { bold: true, size: 13 };
  pl.getCell(cursor, 3).font = { bold: true, size: 13 };
  const netRow = cursor;
  workbook.definedNames.add(`PL!$C$${netRow}`, "NetIncome");

  const bs = workbook.addWorksheet("BS");
  bs.getCell(1, 1).value = `${input.companyName} — Balance sheet`;
  bs.getCell(2, 1).value = `At ${input.periodTo}`;
  bs.getCell(1, 1).font = { bold: true, size: 16, color: { argb: teal } };
  bs.getColumn(1).width = 36;
  bs.getColumn(2).width = 14;
  bs.getColumn(3).width = 18;
  cursor = 4;
  const bsSection = (title: string, rows: Statements["balanceSheet"]["assets"]) => {
    bs.getCell(cursor, 1).value = title;
    bs.getCell(cursor, 1).font = { bold: true };
    cursor += 1;
    const start = cursor;
    if (rows.length === 0) {
      bs.getCell(cursor, 1).value = "None";
      formulaCell(bs, cursor, 3, "0", 0);
      cursor += 1;
    } else {
      for (const row of rows) {
        bs.getCell(cursor, 1).value = row.account.name;
        bs.getCell(cursor, 2).value = row.account.code;
        bs.getCell(cursor, 2).numFmt = "@";
        formulaCell(
          bs,
          cursor,
          3,
          `IFERROR(INDEX(TB!L:L,MATCH(B${cursor},TB!A:A,0)),0)`,
          major(row.naturalClosingCents)
        );
        cursor += 1;
      }
    }
    const end = cursor - 1;
    return { start, end };
  };
  const assetRows = bsSection("Assets", input.statements.balanceSheet.assets);
  formulaCell(bs, cursor, 3, `SUM(C${assetRows.start}:C${assetRows.end})`, major(input.statements.balanceSheet.totalAssetsCents));
  bs.getCell(cursor, 1).value = "Total assets";
  bs.getCell(cursor, 1).font = { bold: true };
  const totalAssetsRow = cursor;
  cursor += 2;
  const liabilityRows = bsSection("Liabilities", input.statements.balanceSheet.liabilities);
  formulaCell(
    bs,
    cursor,
    3,
    `SUM(C${liabilityRows.start}:C${liabilityRows.end})`,
    major(input.statements.balanceSheet.totalLiabilitiesCents)
  );
  bs.getCell(cursor, 1).value = "Total liabilities";
  bs.getCell(cursor, 1).font = { bold: true };
  const totalLiabilitiesRow = cursor;
  cursor += 2;
  const equityRows = bsSection("Equity", input.statements.balanceSheet.equity);
  formulaCell(
    bs,
    cursor,
    3,
    `-(SUMIF(TB!C:C,"revenue",TB!K:K)+SUMIF(TB!C:C,"expense",TB!K:K))-NetIncome`,
    major(input.statements.balanceSheet.priorUnclosedCents)
  );
  bs.getCell(cursor, 1).value = "Prior unclosed results";
  const priorRow = cursor;
  cursor += 1;
  formulaCell(bs, cursor, 3, "NetIncome", major(input.statements.balanceSheet.currentEarningsCents));
  bs.getCell(cursor, 1).value = "Current period earnings";
  const currentRow = cursor;
  cursor += 1;
  formulaCell(
    bs,
    cursor,
    3,
    `SUM(C${equityRows.start}:C${equityRows.end})+C${priorRow}+C${currentRow}`,
    major(
      input.statements.balanceSheet.totalEquityCents +
        input.statements.balanceSheet.priorUnclosedCents +
        input.statements.balanceSheet.currentEarningsCents
    )
  );
  bs.getCell(cursor, 1).value = "Total equity";
  bs.getCell(cursor, 1).font = { bold: true };
  const totalEquityRow = cursor;
  cursor += 2;
  formulaCell(
    bs,
    cursor,
    3,
    `C${totalLiabilitiesRow}+C${totalEquityRow}`,
    major(input.statements.balanceSheet.totalLiabilitiesAndEquityCents)
  );
  bs.getCell(cursor, 1).value = "Total liabilities and equity";
  bs.getCell(cursor, 1).font = { bold: true };
  const totalLeRow = cursor;
  cursor += 1;
  formulaCell(
    bs,
    cursor,
    3,
    `C${totalAssetsRow}-C${totalLeRow}`,
    major(input.statements.balanceSheet.balanceCheckCents)
  );
  bs.getCell(cursor, 1).value = "Balance check (should be zero)";
  bs.getCell(cursor, 1).font = { bold: true };

  await pl.protect("", { selectLockedCells: true, selectUnlockedCells: true });
  await bs.protect("", { selectLockedCells: true, selectUnlockedCells: true });

  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}
