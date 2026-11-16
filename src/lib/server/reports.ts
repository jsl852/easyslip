import { and, asc, desc, eq, lte } from "drizzle-orm";
import { buildStatements } from "$lib/accounting/statements";
import { toCents } from "$lib/accounting/money";
import type { AccountType, JournalLeg, LedgerAccount, NormalBalance, OpeningInput, PlGroup } from "$lib/accounting/types";
import { buildWorkbook, type WorkbookJournalLine } from "./excel";
import { type QueryClient } from "./db/client";
import { accounts, categories, journalLines, openingBalances, reportJobs } from "./db/schema";
import { BooksError } from "./errors";
import { isIsoDate } from "$lib/accounting/dates";

function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "company";
}

export async function loadLedger(db: QueryClient, companyId: string, periodFrom: string, periodTo: string) {
  if (!isIsoDate(periodFrom) || !isIsoDate(periodTo) || periodFrom > periodTo) {
    throw new BooksError("Choose a from date that is on or before the to date.");
  }
  const accountRows = await db.select().from(accounts).where(eq(accounts.companyId, companyId)).orderBy(asc(accounts.code));
  const openingRows = await db.select().from(openingBalances).where(eq(openingBalances.companyId, companyId));
  const lineRows = await db
    .select({
      accountId: journalLines.accountId,
      date: journalLines.lineDate,
      debit: journalLines.debit,
      credit: journalLines.credit,
      docType: journalLines.docTypeCode,
      description: journalLines.description,
      transactionId: journalLines.transactionId,
      accountCode: accounts.code,
      accountName: accounts.name,
      categoryName: categories.name
    })
    .from(journalLines)
    .innerJoin(accounts, eq(journalLines.accountId, accounts.id))
    .leftJoin(categories, eq(journalLines.categoryId, categories.id))
    .where(and(eq(journalLines.companyId, companyId), lte(journalLines.lineDate, periodTo)))
    .orderBy(asc(journalLines.lineDate), asc(journalLines.transactionId), asc(journalLines.sortOrder));

  const ledger: LedgerAccount[] = accountRows.map((account) => ({
    id: account.id,
    code: account.code,
    name: account.name,
    type: account.type as AccountType,
    normalBalance: account.normalBalance as NormalBalance,
    plGroup: (account.plGroup as PlGroup | null) ?? null
  }));
  const openings: OpeningInput[] = openingRows.map((row) => ({
    accountId: row.accountId,
    asOf: row.asOf,
    debitBalanceCents: toCents(row.debitBalance)
  }));
  const legs: JournalLeg[] = lineRows.map((row) => ({
    accountId: row.accountId,
    date: row.date,
    debitCents: toCents(row.debit),
    creditCents: toCents(row.credit)
  }));
  const statements = buildStatements({ accounts: ledger, openings, lines: legs, periodFrom, periodTo });
  const journal: WorkbookJournalLine[] = lineRows
    .filter((row) => row.date >= periodFrom)
    .map((row) => ({
      date: row.date,
      docType: row.docType,
      description: row.description,
      accountCode: row.accountCode,
      accountName: row.accountName,
      debitCents: toCents(row.debit),
      creditCents: toCents(row.credit),
      category: row.categoryName ?? "",
      transactionId: row.transactionId
    }));
  return { statements, journal };
}

export async function createReport(
  db: QueryClient,
  input: { companyId: string; companyName: string; currency: string; userId: string; periodFrom: string; periodTo: string }
) {
  try {
    const { statements, journal } = await loadLedger(db, input.companyId, input.periodFrom, input.periodTo);
    const generatedAt = new Date();
    const file = await buildWorkbook({
      companyName: input.companyName,
      currency: input.currency,
      periodFrom: input.periodFrom,
      periodTo: input.periodTo,
      generatedAt,
      statements,
      journal
    });
    const fileName = `EasySlip-${slug(input.companyName)}-${input.periodFrom}-to-${input.periodTo}.xlsx`;
    const [job] = await db
      .insert(reportJobs)
      .values({
        companyId: input.companyId,
        requestedBy: input.userId,
        periodFrom: input.periodFrom,
        periodTo: input.periodTo,
        status: "ready",
        fileName,
        fileData: file
      })
      .returning({ id: reportJobs.id, fileName: reportJobs.fileName });
    return job;
  } catch (error) {
    const message = error instanceof BooksError ? error.message : "The workbook could not be built.";
    await db.insert(reportJobs).values({
      companyId: input.companyId,
      requestedBy: input.userId,
      periodFrom: input.periodFrom,
      periodTo: input.periodTo,
      status: "failed",
      error: message
    });
    throw error instanceof BooksError ? error : new BooksError(message);
  }
}

export async function listReports(db: QueryClient, companyId: string) {
  return db
    .select({
      id: reportJobs.id,
      periodFrom: reportJobs.periodFrom,
      periodTo: reportJobs.periodTo,
      status: reportJobs.status,
      fileName: reportJobs.fileName,
      error: reportJobs.error,
      createdAt: reportJobs.createdAt
    })
    .from(reportJobs)
    .where(eq(reportJobs.companyId, companyId))
    .orderBy(desc(reportJobs.createdAt))
    .limit(20);
}

export async function getReportFile(db: QueryClient, companyId: string, id: string) {
  const [row] = await db
    .select({
      fileName: reportJobs.fileName,
      fileData: reportJobs.fileData,
      status: reportJobs.status
    })
    .from(reportJobs)
    .where(and(eq(reportJobs.id, id), eq(reportJobs.companyId, companyId)))
    .limit(1);
  if (!row?.fileData || row.status !== "ready" || !row.fileName) return null;
  return { fileName: row.fileName, fileData: row.fileData };
}
