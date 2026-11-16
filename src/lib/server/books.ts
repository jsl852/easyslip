import { and, asc, desc, eq, gte, lte, ne, sql } from "drizzle-orm";
import { starterAccounts, starterCategories, starterRules } from "$lib/accounting/chart";
import { isIsoDate } from "$lib/accounting/dates";
import { journalDescription } from "$lib/accounting/filename-hint";
import { buildJournalEntry } from "$lib/accounting/journal";
import { defaultCategoryId, matchCategoryName, matchKeyword } from "$lib/accounting/keywords";
import { centsToDecimal, toCents } from "$lib/accounting/money";
import {
  normalBalanceFor,
  txnTypes,
  type AccountSubtype,
  type AccountType,
  type ExtractResult,
  type ExtractionSource,
  type PlGroup,
  type TxnType
} from "$lib/accounting/types";
import { type QueryClient } from "./db/client";
import {
  accounts,
  auditEvents,
  categories,
  companies,
  documents,
  journalLines,
  keywordRules,
  memberships,
  openingBalances,
  transactions
} from "./db/schema";
import { BooksError } from "./errors";

const subtypes: AccountSubtype[] = ["bank", "cash", "card", "employee_band", "receivable", "payable", "general"];
const accountTypes: AccountType[] = ["asset", "liability", "equity", "revenue", "expense"];

function assertTxnType(value: string): TxnType {
  if (!(txnTypes as readonly string[]).includes(value)) throw new BooksError("Choose expense, purchase, or sales.");
  return value as TxnType;
}

export async function createCompanyForUser(db: QueryClient, input: { userId: string; name: string }) {
  const name = input.name.trim();
  if (name.length < 2 || name.length > 120) {
    throw new BooksError("Company name should be between 2 and 120 characters.");
  }
  const [existing] = await db.select({ id: memberships.id }).from(memberships).where(eq(memberships.userId, input.userId)).limit(1);
  if (existing) throw new BooksError("This sign-in already belongs to a company.");

  const [company] = await db
    .insert(companies)
    .values({ name, locale: "en-HK", baseCurrency: "HKD", fiscalYearStartMonth: 1 })
    .returning();
  await db.insert(memberships).values({ userId: input.userId, companyId: company.id, role: "owner" });
  const insertedAccounts = await db
    .insert(accounts)
    .values(
      starterAccounts.map((account) => ({
        companyId: company.id,
        code: account.code,
        name: account.name,
        type: account.type,
        subtype: account.subtype,
        normalBalance: normalBalanceFor(account.type),
        plGroup: account.plGroup,
        currency: "HKD",
        isSettlement: account.isSettlement,
        active: true,
        sortOrder: account.sortOrder
      }))
    )
    .returning();
  const byCode = new Map(insertedAccounts.map((account) => [account.code, account]));
  const insertedCategories = await db
    .insert(categories)
    .values(
      starterCategories.map((category) => ({
        companyId: company.id,
        name: category.name,
        kind: category.kind,
        accountId: byCode.get(category.accountCode)!.id,
        active: true
      }))
    )
    .returning();
  const byName = new Map(insertedCategories.map((category) => [category.name, category]));
  await db.insert(keywordRules).values(
    starterRules.map((rule) => ({
      companyId: company.id,
      pattern: rule.pattern,
      categoryId: byName.get(rule.categoryName)!.id,
      priority: rule.priority,
      active: true
    }))
  );
  await db.insert(auditEvents).values({
    companyId: company.id,
    actorId: input.userId,
    entityType: "company",
    entityId: company.id,
    action: "company.create",
    detail: { name }
  });
  return company;
}

export async function updateCompany(
  db: QueryClient,
  input: { companyId: string; userId: string; name: string; fiscalYearStartMonth: number }
) {
  const name = input.name.trim();
  if (name.length < 2 || name.length > 120) throw new BooksError("Company name should be between 2 and 120 characters.");
  if (!Number.isInteger(input.fiscalYearStartMonth) || input.fiscalYearStartMonth < 1 || input.fiscalYearStartMonth > 12) {
    throw new BooksError("Fiscal year starts in month 1 to 12.");
  }
  await db
    .update(companies)
    .set({ name, fiscalYearStartMonth: input.fiscalYearStartMonth })
    .where(eq(companies.id, input.companyId));
  await db.insert(auditEvents).values({
    companyId: input.companyId,
    actorId: input.userId,
    entityType: "company",
    entityId: input.companyId,
    action: "company.update",
    detail: { name, fiscalYearStartMonth: input.fiscalYearStartMonth }
  });
}

export async function listAccounts(db: QueryClient, companyId: string) {
  return db.select().from(accounts).where(eq(accounts.companyId, companyId)).orderBy(asc(accounts.sortOrder), asc(accounts.code));
}

export async function listCategories(db: QueryClient, companyId: string) {
  return db.select().from(categories).where(eq(categories.companyId, companyId)).orderBy(asc(categories.name));
}

export async function createAccount(
  db: QueryClient,
  input: {
    companyId: string;
    userId: string;
    code: string;
    name: string;
    type: string;
    subtype: string;
    plGroup: string;
    currency: string;
    isSettlement: boolean;
    employeeLabel: string;
  }
) {
  const code = input.code.trim();
  const name = input.name.trim();
  if (!/^\d{3,8}$/.test(code)) throw new BooksError("Account code should be 3 to 8 digits.");
  if (name.length < 2 || name.length > 80) throw new BooksError("Account name should be between 2 and 80 characters.");
  if (!accountTypes.includes(input.type as AccountType)) throw new BooksError("Choose an account type.");
  if (!subtypes.includes(input.subtype as AccountSubtype)) throw new BooksError("Choose an account subtype.");
  const type = input.type as AccountType;
  let plGroup: PlGroup | null = null;
  if (type === "revenue") plGroup = "revenue";
  if (type === "expense") plGroup = input.plGroup === "cogs" ? "cogs" : "expense";
  const subtype = input.subtype as AccountSubtype;
  const employeeLabel = input.employeeLabel.trim();
  if (subtype === "employee_band" && employeeLabel.length < 2) {
    throw new BooksError("Name the staff member for an employee cash band.");
  }
  const [created] = await db
    .insert(accounts)
    .values({
      companyId: input.companyId,
      code,
      name,
      type,
      subtype,
      normalBalance: normalBalanceFor(type),
      plGroup,
      currency: /^[A-Za-z]{3}$/.test(input.currency.trim()) ? input.currency.trim().toUpperCase() : "HKD",
      isSettlement: subtype === "employee_band" ? true : input.isSettlement,
      employeeLabel: employeeLabel || null,
      sortOrder: Number(code)
    })
    .returning();
  await db.insert(auditEvents).values({
    companyId: input.companyId,
    actorId: input.userId,
    entityType: "account",
    entityId: created.id,
    action: "account.create",
    detail: { code, name }
  });
  return created;
}

export async function updateAccount(
  db: QueryClient,
  input: { companyId: string; userId: string; id: string; name: string; active: boolean; isSettlement: boolean }
) {
  const name = input.name.trim();
  if (name.length < 2 || name.length > 80) throw new BooksError("Account name should be between 2 and 80 characters.");
  const [row] = await db
    .update(accounts)
    .set({ name, active: input.active, isSettlement: input.isSettlement })
    .where(and(eq(accounts.id, input.id), eq(accounts.companyId, input.companyId)))
    .returning();
  if (!row) throw new BooksError("Account not found.");
  await db.insert(auditEvents).values({
    companyId: input.companyId,
    actorId: input.userId,
    entityType: "account",
    entityId: row.id,
    action: "account.update",
    detail: { name, active: input.active, isSettlement: input.isSettlement }
  });
}

export async function createCategory(
  db: QueryClient,
  input: { companyId: string; userId: string; name: string; kind: string; accountId: string }
) {
  const name = input.name.trim();
  if (name.length < 2 || name.length > 80) throw new BooksError("Category name should be between 2 and 80 characters.");
  if (!["revenue", "cogs", "expense"].includes(input.kind)) throw new BooksError("Choose a category kind.");
  const [account] = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.id, input.accountId), eq(accounts.companyId, input.companyId)))
    .limit(1);
  if (!account) throw new BooksError("Link the category to an account in this company.");
  if (account.type !== "revenue" && account.type !== "expense") {
    throw new BooksError("Link categories to a revenue or expense account.");
  }
  const [created] = await db
    .insert(categories)
    .values({ companyId: input.companyId, name, kind: input.kind, accountId: account.id, active: true })
    .returning();
  await db.insert(auditEvents).values({
    companyId: input.companyId,
    actorId: input.userId,
    entityType: "category",
    entityId: created.id,
    action: "category.create",
    detail: { name, kind: input.kind, accountId: account.id }
  });
  return created;
}

export async function updateCategory(
  db: QueryClient,
  input: { companyId: string; userId: string; id: string; name: string; kind: string; accountId: string; active: boolean }
) {
  const name = input.name.trim();
  if (name.length < 2 || name.length > 80) throw new BooksError("Category name should be between 2 and 80 characters.");
  if (!["revenue", "cogs", "expense"].includes(input.kind)) throw new BooksError("Choose a category kind.");
  const [account] = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.id, input.accountId), eq(accounts.companyId, input.companyId)))
    .limit(1);
  if (!account || (account.type !== "revenue" && account.type !== "expense")) {
    throw new BooksError("Link categories to a revenue or expense account.");
  }
  const [row] = await db
    .update(categories)
    .set({ name, kind: input.kind, accountId: account.id, active: input.active })
    .where(and(eq(categories.id, input.id), eq(categories.companyId, input.companyId)))
    .returning();
  if (!row) throw new BooksError("Category not found.");
}

export async function listRules(db: QueryClient, companyId: string) {
  return db
    .select({
      id: keywordRules.id,
      pattern: keywordRules.pattern,
      priority: keywordRules.priority,
      active: keywordRules.active,
      categoryId: keywordRules.categoryId,
      categoryName: categories.name
    })
    .from(keywordRules)
    .innerJoin(categories, eq(keywordRules.categoryId, categories.id))
    .where(eq(keywordRules.companyId, companyId))
    .orderBy(desc(keywordRules.priority), asc(keywordRules.pattern));
}

export async function createRule(
  db: QueryClient,
  input: { companyId: string; userId: string; pattern: string; categoryId: string; priority: number }
) {
  const pattern = input.pattern.trim();
  if (pattern.length < 2 || pattern.length > 80) throw new BooksError("A keyword should be between 2 and 80 characters.");
  const [category] = await db
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.id, input.categoryId), eq(categories.companyId, input.companyId)))
    .limit(1);
  if (!category) throw new BooksError("Choose a category for this rule.");
  const priority = Number.isFinite(input.priority) ? Math.max(-100, Math.min(1000, Math.trunc(input.priority))) : 0;
  const [created] = await db
    .insert(keywordRules)
    .values({ companyId: input.companyId, pattern, categoryId: category.id, priority, active: true })
    .returning();
  await db.insert(auditEvents).values({
    companyId: input.companyId,
    actorId: input.userId,
    entityType: "keyword_rule",
    entityId: created.id,
    action: "rule.create",
    detail: { pattern, categoryId: category.id, priority }
  });
}

export async function setRuleActive(db: QueryClient, input: { companyId: string; id: string; active: boolean }) {
  await db
    .update(keywordRules)
    .set({ active: input.active })
    .where(and(eq(keywordRules.id, input.id), eq(keywordRules.companyId, input.companyId)));
}

export async function deleteRule(db: QueryClient, input: { companyId: string; id: string }) {
  await db.delete(keywordRules).where(and(eq(keywordRules.id, input.id), eq(keywordRules.companyId, input.companyId)));
}

export async function listOpenings(db: QueryClient, companyId: string) {
  return db
    .select({
      id: openingBalances.id,
      accountId: openingBalances.accountId,
      asOf: openingBalances.asOf,
      debitBalance: openingBalances.debitBalance,
      note: openingBalances.note,
      createdAt: openingBalances.createdAt,
      accountCode: accounts.code,
      accountName: accounts.name
    })
    .from(openingBalances)
    .innerJoin(accounts, eq(openingBalances.accountId, accounts.id))
    .where(eq(openingBalances.companyId, companyId))
    .orderBy(asc(accounts.code), asc(openingBalances.asOf));
}

export async function createOpening(
  db: QueryClient,
  input: { companyId: string; userId: string; accountId: string; asOf: string; side: string; amount: string; note: string }
) {
  if (!isIsoDate(input.asOf)) throw new BooksError("Opening date must be YYYY-MM-DD.");
  if (input.side !== "debit" && input.side !== "credit") throw new BooksError("Choose debit or credit.");
  const cents = toCents(input.amount);
  if (cents <= 0) throw new BooksError("Enter an opening amount greater than zero.");
  const [account] = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.id, input.accountId), eq(accounts.companyId, input.companyId)))
    .limit(1);
  if (!account) throw new BooksError("Choose an account.");
  const debitBalance = centsToDecimal(input.side === "debit" ? cents : -cents);
  const [created] = await db
    .insert(openingBalances)
    .values({
      companyId: input.companyId,
      accountId: account.id,
      asOf: input.asOf,
      debitBalance,
      note: input.note.trim().slice(0, 240),
      source: "manual"
    })
    .returning();
  await db.insert(auditEvents).values({
    companyId: input.companyId,
    actorId: input.userId,
    entityType: "opening_balance",
    entityId: created.id,
    action: "opening.create",
    detail: { accountId: account.id, asOf: input.asOf, debitBalance }
  });
}

export async function deleteOpening(db: QueryClient, input: { companyId: string; id: string }) {
  await db.delete(openingBalances).where(and(eq(openingBalances.id, input.id), eq(openingBalances.companyId, input.companyId)));
}

async function resolvePosting(
  db: QueryClient,
  companyId: string,
  input: { type: TxnType; settlementAccountId: string; categoryId: string; txnDate: string; description: string; amount: string }
) {
  if (!isIsoDate(input.txnDate)) throw new BooksError("Use a real date in YYYY-MM-DD form.");
  const description = input.description.trim();
  if (!description) throw new BooksError("Description is required.");
  let amountCents = 0;
  try {
    amountCents = toCents(input.amount);
  } catch {
    throw new BooksError("Amount must be a number.");
  }
  if (amountCents < 0) throw new BooksError("Amount cannot be negative.");
  if (amountCents > 99_999_999_99) throw new BooksError("Amount is too large.");
  const [settlement] = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.id, input.settlementAccountId), eq(accounts.companyId, companyId)))
    .limit(1);
  if (!settlement?.active || !settlement.isSettlement) throw new BooksError("Choose an active settlement account.");
  const [category] = await db
    .select()
    .from(categories)
    .where(and(eq(categories.id, input.categoryId), eq(categories.companyId, companyId)))
    .limit(1);
  if (!category?.active) throw new BooksError("Choose an active category.");
  const [categoryAccount] = await db.select().from(accounts).where(eq(accounts.id, category.accountId)).limit(1);
  if (!categoryAccount || categoryAccount.companyId !== companyId) {
    throw new BooksError("That category is not linked to an account in this company.");
  }
  if (categoryAccount.type !== "revenue" && categoryAccount.type !== "expense") {
    throw new BooksError("Categories must post to a revenue or expense account.");
  }
  const draft = buildJournalEntry({
    type: input.type,
    amountCents,
    settlementAccountId: settlement.id,
    categoryAccountId: categoryAccount.id,
    categoryId: category.id
  });
  return { draft, description: description.slice(0, 500), amount: centsToDecimal(amountCents) };
}

async function writeLines(
  db: QueryClient,
  input: { companyId: string; transactionId: string; date: string; description: string; draft: ReturnType<typeof buildJournalEntry> }
) {
  await db.delete(journalLines).where(eq(journalLines.transactionId, input.transactionId));
  await db.insert(journalLines).values(
    input.draft.lines.map((line) => ({
      companyId: input.companyId,
      transactionId: input.transactionId,
      docTypeCode: line.docTypeCode,
      lineDate: input.date,
      description: input.description,
      accountId: line.accountId,
      categoryId: line.categoryId,
      debit: centsToDecimal(line.debitCents),
      credit: centsToDecimal(line.creditCents),
      sortOrder: line.sortOrder
    }))
  );
}

export async function postFromExtraction(
  db: QueryClient,
  input: {
    companyId: string;
    userId: string | null;
    documentId: string;
    txnType: TxnType;
    settlementAccountId: string;
    extract: ExtractResult;
  }
) {
  const [existing] = await db
    .select({ id: transactions.id })
    .from(transactions)
    .where(eq(transactions.documentId, input.documentId))
    .limit(1);
  if (existing) return existing.id;

  const categoryRows = await db
    .select({ id: categories.id, name: categories.name, kind: categories.kind, active: categories.active })
    .from(categories)
    .where(and(eq(categories.companyId, input.companyId), eq(categories.active, true)));
  const rules = await db
    .select({
      pattern: keywordRules.pattern,
      categoryId: keywordRules.categoryId,
      priority: keywordRules.priority,
      active: keywordRules.active
    })
    .from(keywordRules)
    .where(eq(keywordRules.companyId, input.companyId));
  const ruled = matchKeyword(rules, `${input.extract.merchant} ${input.extract.description}`);
  const hinted = matchCategoryName(categoryRows, input.extract.suggestedCategory);
  const categoryId = ruled ?? hinted ?? defaultCategoryId(categoryRows, input.txnType);
  if (!categoryId) throw new BooksError("Add a category before documents can be posted.");
  const warnings = [...input.extract.warnings];
  if (ruled) warnings.push("A keyword rule chose the category.");
  else if (!hinted) warnings.push("No keyword or model category matched, so EasySlip used the default for this transaction type.");
  if ((input.extract.confidence ?? 0) < 0.75) warnings.push("Confidence is below 75%. Please review the amount and category.");

  const description = journalDescription(input.extract.merchant, input.extract.description) || input.extract.description;
  const resolved = await resolvePosting(db, input.companyId, {
    type: input.txnType,
    settlementAccountId: input.settlementAccountId,
    categoryId,
    txnDate: input.extract.txnDate,
    description,
    amount: input.extract.amount ?? "0"
  });
  const foreign = input.extract.currency !== "HKD";
  const [created] = await db
    .insert(transactions)
    .values({
      companyId: input.companyId,
      documentId: input.documentId,
      type: input.txnType,
      settlementAccountId: input.settlementAccountId,
      categoryId,
      txnDate: input.extract.txnDate,
      merchant: input.extract.merchant.slice(0, 200),
      description: resolved.description,
      amount: resolved.amount,
      currency: "HKD",
      originalAmount: foreign ? resolved.amount : null,
      originalCurrency: foreign ? input.extract.currency : null,
      aiConfidence: input.extract.confidence.toFixed(3),
      extractionSource: input.extract.source,
      warnings,
      reviewStatus: "needs_review",
      createdBy: input.userId,
      updatedBy: input.userId
    })
    .returning();
  await writeLines(db, {
    companyId: input.companyId,
    transactionId: created.id,
    date: input.extract.txnDate,
    description: resolved.description,
    draft: resolved.draft
  });
  await db.insert(auditEvents).values({
    companyId: input.companyId,
    actorId: input.userId,
    entityType: "transaction",
    entityId: created.id,
    action: "transaction.extract",
    detail: { source: input.extract.source, documentId: input.documentId, categoryId, amount: resolved.amount }
  });
  return created.id;
}

export async function createManualTransaction(
  db: QueryClient,
  input: {
    companyId: string;
    userId: string;
    type: string;
    settlementAccountId: string;
    categoryId: string;
    txnDate: string;
    merchant: string;
    description: string;
    amount: string;
  }
) {
  const type = assertTxnType(input.type);
  const resolved = await resolvePosting(db, input.companyId, { ...input, type });
  const [created] = await db
    .insert(transactions)
    .values({
      companyId: input.companyId,
      type,
      settlementAccountId: input.settlementAccountId,
      categoryId: input.categoryId,
      txnDate: input.txnDate,
      merchant: input.merchant.trim().slice(0, 200),
      description: resolved.description,
      amount: resolved.amount,
      currency: "HKD",
      extractionSource: "manual" satisfies ExtractionSource,
      warnings: [],
      reviewStatus: "needs_review",
      createdBy: input.userId,
      updatedBy: input.userId
    })
    .returning();
  await writeLines(db, {
    companyId: input.companyId,
    transactionId: created.id,
    date: input.txnDate,
    description: resolved.description,
    draft: resolved.draft
  });
  await db.insert(auditEvents).values({
    companyId: input.companyId,
    actorId: input.userId,
    entityType: "transaction",
    entityId: created.id,
    action: "transaction.create",
    detail: { amount: resolved.amount, type }
  });
  return created.id;
}

export async function updateTransaction(
  db: QueryClient,
  input: {
    companyId: string;
    userId: string;
    id: string;
    type: string;
    settlementAccountId: string;
    categoryId: string;
    txnDate: string;
    merchant: string;
    description: string;
    amount: string;
    reviewStatus: "needs_review" | "approved";
  }
) {
  const type = assertTxnType(input.type);
  const [current] = await db
    .select()
    .from(transactions)
    .where(and(eq(transactions.id, input.id), eq(transactions.companyId, input.companyId)))
    .limit(1);
  if (!current) throw new BooksError("Transaction not found.");
  const resolved = await resolvePosting(db, input.companyId, { ...input, type });
  await db
    .update(transactions)
    .set({
      type,
      settlementAccountId: input.settlementAccountId,
      categoryId: input.categoryId,
      txnDate: input.txnDate,
      merchant: input.merchant.trim().slice(0, 200),
      description: resolved.description,
      amount: resolved.amount,
      reviewStatus: input.reviewStatus,
      updatedBy: input.userId,
      updatedAt: new Date()
    })
    .where(eq(transactions.id, current.id));
  await writeLines(db, {
    companyId: input.companyId,
    transactionId: current.id,
    date: input.txnDate,
    description: resolved.description,
    draft: resolved.draft
  });
  await db.insert(auditEvents).values({
    companyId: input.companyId,
    actorId: input.userId,
    entityType: "transaction",
    entityId: current.id,
    action: input.reviewStatus === "approved" ? "transaction.approve" : "transaction.update",
    detail: {
      before: { amount: current.amount, date: current.txnDate, categoryId: current.categoryId, type: current.type },
      after: { amount: resolved.amount, date: input.txnDate, categoryId: input.categoryId, type }
    }
  });
}

export async function listTransactions(db: QueryClient, companyId: string, type?: TxnType) {
  const filters = [eq(transactions.companyId, companyId)];
  if (type) filters.push(eq(transactions.type, type));
  return db
    .select({
      id: transactions.id,
      type: transactions.type,
      txnDate: transactions.txnDate,
      merchant: transactions.merchant,
      description: transactions.description,
      amount: transactions.amount,
      reviewStatus: transactions.reviewStatus,
      extractionSource: transactions.extractionSource,
      categoryName: categories.name,
      accountName: accounts.name,
      accountCode: accounts.code
    })
    .from(transactions)
    .innerJoin(categories, eq(transactions.categoryId, categories.id))
    .innerJoin(accounts, eq(transactions.settlementAccountId, accounts.id))
    .where(and(...filters))
    .orderBy(desc(transactions.txnDate), desc(transactions.createdAt));
}

export async function listReviewQueue(db: QueryClient, companyId: string) {
  return db
    .select({
      id: transactions.id,
      type: transactions.type,
      txnDate: transactions.txnDate,
      description: transactions.description,
      amount: transactions.amount,
      extractionSource: transactions.extractionSource,
      aiConfidence: transactions.aiConfidence,
      categoryName: categories.name
    })
    .from(transactions)
    .innerJoin(categories, eq(transactions.categoryId, categories.id))
    .where(and(eq(transactions.companyId, companyId), eq(transactions.reviewStatus, "needs_review")))
    .orderBy(asc(transactions.txnDate), asc(transactions.createdAt));
}

export async function getTransaction(db: QueryClient, companyId: string, id: string) {
  const [row] = await db
    .select()
    .from(transactions)
    .where(and(eq(transactions.id, id), eq(transactions.companyId, companyId)))
    .limit(1);
  if (!row) return null;
  const lines = await db
    .select({
      id: journalLines.id,
      docTypeCode: journalLines.docTypeCode,
      debit: journalLines.debit,
      credit: journalLines.credit,
      accountCode: accounts.code,
      accountName: accounts.name
    })
    .from(journalLines)
    .innerJoin(accounts, eq(journalLines.accountId, accounts.id))
    .where(eq(journalLines.transactionId, row.id))
    .orderBy(asc(journalLines.sortOrder));
  const document = row.documentId
    ? (
        await db
          .select({
            id: documents.id,
            fileName: documents.fileName,
            mimeType: documents.mimeType,
            status: documents.status,
            extractionSource: documents.extractionSource,
            error: documents.error
          })
          .from(documents)
          .where(and(eq(documents.id, row.documentId), eq(documents.companyId, companyId)))
          .limit(1)
      )[0] ?? null
    : null;
  const history = await db
    .select({
      id: auditEvents.id,
      action: auditEvents.action,
      createdAt: auditEvents.createdAt,
      detail: auditEvents.detail
    })
    .from(auditEvents)
    .where(and(eq(auditEvents.companyId, companyId), eq(auditEvents.entityId, row.id)))
    .orderBy(desc(auditEvents.createdAt))
    .limit(12);
  const [next] = await db
    .select({ id: transactions.id })
    .from(transactions)
    .where(
      and(eq(transactions.companyId, companyId), eq(transactions.reviewStatus, "needs_review"), ne(transactions.id, row.id))
    )
    .orderBy(asc(transactions.txnDate), asc(transactions.createdAt))
    .limit(1);
  return { transaction: row, lines, document, history, nextReviewId: next?.id ?? null };
}

export async function listJournal(
  db: QueryClient,
  companyId: string,
  filters: { from?: string; to?: string; docType?: string }
) {
  const where = [eq(journalLines.companyId, companyId)];
  if (filters.from && isIsoDate(filters.from)) where.push(gte(journalLines.lineDate, filters.from));
  if (filters.to && isIsoDate(filters.to)) where.push(lte(journalLines.lineDate, filters.to));
  if (filters.docType && ["SJ", "PJ", "EJ"].includes(filters.docType)) where.push(eq(journalLines.docTypeCode, filters.docType));
  return db
    .select({
      id: journalLines.id,
      transactionId: journalLines.transactionId,
      date: journalLines.lineDate,
      docTypeCode: journalLines.docTypeCode,
      description: journalLines.description,
      debit: journalLines.debit,
      credit: journalLines.credit,
      accountCode: accounts.code,
      accountName: accounts.name,
      categoryName: categories.name
    })
    .from(journalLines)
    .innerJoin(accounts, eq(journalLines.accountId, accounts.id))
    .leftJoin(categories, eq(journalLines.categoryId, categories.id))
    .where(and(...where))
    .orderBy(asc(journalLines.lineDate), asc(journalLines.transactionId), asc(journalLines.sortOrder))
    .limit(1000);
}

export async function dashboard(db: QueryClient, companyId: string, from: string, to: string) {
  const [review] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(transactions)
    .where(and(eq(transactions.companyId, companyId), eq(transactions.reviewStatus, "needs_review")));
  const [queued] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(documents)
    .where(and(eq(documents.companyId, companyId), sql`${documents.status} in ('queued', 'processing')`));
  const totals = await db
    .select({
      type: transactions.type,
      count: sql<number>`count(*)::int`,
      total: sql<string>`coalesce(sum(${transactions.amount}), 0)::text`
    })
    .from(transactions)
    .where(and(eq(transactions.companyId, companyId), gte(transactions.txnDate, from), lte(transactions.txnDate, to)))
    .groupBy(transactions.type);
  const recent = await listTransactions(db, companyId);
  return {
    reviewCount: review?.count ?? 0,
    queuedCount: queued?.count ?? 0,
    totals,
    recent: recent.slice(0, 8)
  };
}
