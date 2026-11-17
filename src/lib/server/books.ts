import { and, asc, desc, eq, gte, inArray, lte, ne, or, sql } from "drizzle-orm";
import { starterAccounts, starterCategories, starterRules } from "$lib/accounting/chart";
import { isIsoDate } from "$lib/accounting/dates";
import {
  canonicalExpensePair,
  choosePrimary,
  classifyDocument,
  evidenceFromExtract,
  paymentLabelForReceipts,
  planReceiptGroups,
  readExtract,
  roleFor
} from "$lib/accounting/expense-group";
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
  expenseRelations,
  expenses,
  journalLines,
  keywordRules,
  memberships,
  openingBalances,
  receipts
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
  input: { companyId: string; expenseId: string; date: string; description: string; draft: ReturnType<typeof buildJournalEntry> }
) {
  await db.delete(journalLines).where(eq(journalLines.expenseId, input.expenseId));
  await db.insert(journalLines).values(
    input.draft.lines.map((line) => ({
      companyId: input.companyId,
      expenseId: input.expenseId,
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

async function resolveCategoryId(db: QueryClient, companyId: string, txnType: TxnType, extract: ExtractResult) {
  const categoryRows = await db
    .select({ id: categories.id, name: categories.name, kind: categories.kind, active: categories.active })
    .from(categories)
    .where(and(eq(categories.companyId, companyId), eq(categories.active, true)));
  const rules = await db
    .select({
      pattern: keywordRules.pattern,
      categoryId: keywordRules.categoryId,
      priority: keywordRules.priority,
      active: keywordRules.active
    })
    .from(keywordRules)
    .where(eq(keywordRules.companyId, companyId));
  const ruled = matchKeyword(rules, `${extract.merchant} ${extract.description}`);
  const hinted = matchCategoryName(categoryRows, extract.suggestedCategory);
  const categoryId = ruled ?? hinted ?? defaultCategoryId(categoryRows, txnType);
  return { categoryId, ruled: Boolean(ruled), hinted: Boolean(hinted) };
}

function extractionWarnings(extract: ExtractResult, ruled: boolean, hinted: boolean): string[] {
  const warnings = [...extract.warnings];
  if (ruled) warnings.push("A keyword rule chose the category.");
  else if (!hinted) warnings.push("No keyword or model category matched, so EasySlip used the default for this transaction type.");
  if ((extract.confidence ?? 0) < 0.75) warnings.push("Confidence is below 75%. Please review the amount and category.");
  return warnings;
}

export async function postExpenseFromReceipt(
  db: QueryClient,
  input: {
    companyId: string;
    userId: string | null;
    receiptId: string;
    txnType: TxnType;
    settlementAccountId: string;
    extract: ExtractResult;
  }
) {
  const [receipt] = await db
    .select({ id: receipts.id, expenseId: receipts.expenseId })
    .from(receipts)
    .where(and(eq(receipts.id, input.receiptId), eq(receipts.companyId, input.companyId)))
    .limit(1);
  if (!receipt) throw new BooksError("Receipt not found.");
  if (receipt.expenseId) return receipt.expenseId;

  const { categoryId, ruled, hinted } = await resolveCategoryId(db, input.companyId, input.txnType, input.extract);
  if (!categoryId) throw new BooksError("Add a category before receipts can be posted.");
  const warnings = extractionWarnings(input.extract, ruled, hinted);
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
  const kind = classifyDocument(`${input.extract.merchant} ${input.extract.description}`);
  const paymentMethod = paymentLabelForReceipts([{ kind, text: `${input.extract.merchant} ${input.extract.description}` }]);
  const [created] = await db
    .insert(expenses)
    .values({
      companyId: input.companyId,
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
      paymentMethod,
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
    expenseId: created.id,
    date: input.extract.txnDate,
    description: resolved.description,
    draft: resolved.draft
  });
  await db
    .update(receipts)
    .set({
      expenseId: created.id,
      documentKind: kind,
      role: roleFor(kind, true),
      updatedAt: new Date()
    })
    .where(eq(receipts.id, receipt.id));
  await db.insert(auditEvents).values({
    companyId: input.companyId,
    actorId: input.userId,
    entityType: "expense",
    entityId: created.id,
    action: "expense.extract",
    detail: { source: input.extract.source, receiptId: input.receiptId, categoryId, amount: resolved.amount }
  });
  return created.id;
}

export async function linkReceiptToExpense(db: QueryClient, input: { companyId: string; receiptId: string; expenseId: string }) {
  const [receipt] = await db
    .update(receipts)
    .set({ expenseId: input.expenseId, updatedAt: new Date() })
    .where(and(eq(receipts.id, input.receiptId), eq(receipts.companyId, input.companyId)))
    .returning({ id: receipts.id });
  if (!receipt) throw new BooksError("Receipt not found.");
}

export async function syncExpenseWithReceipts(
  db: QueryClient,
  input: { companyId: string; userId: string | null; expenseId: string }
) {
  const [expense] = await db
    .select()
    .from(expenses)
    .where(and(eq(expenses.id, input.expenseId), eq(expenses.companyId, input.companyId)))
    .limit(1);
  if (!expense) throw new BooksError("Expense not found.");
  const attached = await db
    .select()
    .from(receipts)
    .where(and(eq(receipts.expenseId, expense.id), eq(receipts.companyId, input.companyId)));
  const parsed = attached.flatMap((receipt) => {
    const extract = readExtract(receipt.rawExtract);
    if (!extract) return [];
    return [{ receipt, extract, evidence: evidenceFromExtract(receipt.id, extract) }];
  });
  if (parsed.length === 0) return expense.id;

  const primary = choosePrimary(parsed.map((item) => item.evidence));
  const primaryRow = parsed.find((item) => item.evidence.id === primary.id) ?? parsed[0];
  const paymentMethod = paymentLabelForReceipts(
    parsed.map((item) => ({
      kind: classifyDocument(`${item.extract.merchant} ${item.extract.description}`),
      text: `${item.extract.merchant} ${item.extract.description}`
    }))
  );
  for (const item of parsed) {
    const kind = classifyDocument(`${item.extract.merchant} ${item.extract.description}`);
    await db
      .update(receipts)
      .set({ documentKind: kind, role: roleFor(kind, item.receipt.id === primary.id), updatedAt: new Date() })
      .where(eq(receipts.id, item.receipt.id));
  }

  const plan = planReceiptGroups(parsed.map((item) => item.evidence));
  const grouped = plan.groups.find((group) => group.ids.length > 1);
  const warnings = (Array.isArray(expense.warnings) ? expense.warnings : []).filter((warning) => !warning.startsWith("Grouped "));
  if (parsed.length > 1) {
    const pct = grouped ? Math.round(grouped.confidence * 100) : 100;
    warnings.push(`Grouped ${parsed.length} receipts onto one expense (${pct}% match).`);
  }

  const locked = expense.reviewStatus === "approved" || expense.extractionSource === "manual";
  if (locked) {
    await db
      .update(expenses)
      .set({
        paymentMethod: expense.paymentMethod || paymentMethod,
        groupConfidence: grouped ? grouped.confidence.toFixed(3) : expense.groupConfidence,
        warnings,
        updatedAt: new Date(),
        updatedBy: input.userId
      })
      .where(eq(expenses.id, expense.id));
    return expense.id;
  }

  const txnType = expense.type as TxnType;
  const { categoryId, ruled, hinted } = await resolveCategoryId(db, input.companyId, txnType, primaryRow.extract);
  if (!categoryId) throw new BooksError("Add a category before receipts can be posted.");
  const baseWarnings = extractionWarnings(primaryRow.extract, ruled, hinted).filter((warning) => !warning.startsWith("Grouped "));
  if (parsed.length > 1) {
    const pct = grouped ? Math.round(grouped.confidence * 100) : 100;
    baseWarnings.push(`Grouped ${parsed.length} receipts onto one expense (${pct}% match).`);
  }
  const description = journalDescription(primaryRow.extract.merchant, primaryRow.extract.description) || primaryRow.extract.description;
  const resolved = await resolvePosting(db, input.companyId, {
    type: txnType,
    settlementAccountId: expense.settlementAccountId,
    categoryId,
    txnDate: isIsoDate(primaryRow.extract.txnDate) ? primaryRow.extract.txnDate : expense.txnDate,
    description,
    amount: expense.amount
  });
  await db
    .update(expenses)
    .set({
      categoryId,
      txnDate: isIsoDate(primaryRow.extract.txnDate) ? primaryRow.extract.txnDate : expense.txnDate,
      merchant: primaryRow.extract.merchant.slice(0, 200),
      description: resolved.description,
      paymentMethod,
      aiConfidence: primaryRow.extract.confidence.toFixed(3),
      extractionSource: primaryRow.extract.source,
      warnings: baseWarnings,
      groupConfidence: grouped ? grouped.confidence.toFixed(3) : null,
      updatedBy: input.userId,
      updatedAt: new Date()
    })
    .where(eq(expenses.id, expense.id));
  await writeLines(db, {
    companyId: input.companyId,
    expenseId: expense.id,
    date: isIsoDate(primaryRow.extract.txnDate) ? primaryRow.extract.txnDate : expense.txnDate,
    description: resolved.description,
    draft: resolved.draft
  });
  return expense.id;
}

export async function suggestExpensePair(
  db: QueryClient,
  input: { companyId: string; leftId: string; rightId: string; confidence: number; reason: string }
) {
  if (input.leftId === input.rightId) return;
  const [expenseId, relatedExpenseId] = canonicalExpensePair(input.leftId, input.rightId);
  await db
    .insert(expenseRelations)
    .values({
      companyId: input.companyId,
      expenseId,
      relatedExpenseId,
      confidence: input.confidence.toFixed(3),
      reason: input.reason.slice(0, 500),
      status: "suggested"
    })
    .onConflictDoNothing();
}

export async function mergeExpenses(
  db: QueryClient,
  input: { companyId: string; userId: string | null; targetId: string; sourceId: string; manual?: boolean }
) {
  if (input.targetId === input.sourceId) throw new BooksError("Choose a different expense to merge.");
  const [target] = await db
    .select()
    .from(expenses)
    .where(and(eq(expenses.id, input.targetId), eq(expenses.companyId, input.companyId)))
    .limit(1);
  const [source] = await db
    .select()
    .from(expenses)
    .where(and(eq(expenses.id, input.sourceId), eq(expenses.companyId, input.companyId)))
    .limit(1);
  if (!target || !source) throw new BooksError("Expense not found.");
  await db
    .update(receipts)
    .set({ expenseId: target.id, updatedAt: new Date() })
    .where(and(eq(receipts.expenseId, source.id), eq(receipts.companyId, input.companyId)));
  await db
    .delete(expenseRelations)
    .where(
      and(
        eq(expenseRelations.companyId, input.companyId),
        or(eq(expenseRelations.expenseId, source.id), eq(expenseRelations.relatedExpenseId, source.id))
      )
    );
  await db.delete(expenses).where(eq(expenses.id, source.id));
  await syncExpenseWithReceipts(db, { companyId: input.companyId, userId: input.userId, expenseId: target.id });
  const [current] = await db.select({ warnings: expenses.warnings }).from(expenses).where(eq(expenses.id, target.id)).limit(1);
  const warnings = [...(Array.isArray(current?.warnings) ? current.warnings : [])];
  if (source.amount !== target.amount) {
    warnings.push(`Merged with an expense of ${source.amount}. The booked amount is still ${target.amount}.`);
  }
  if (input.manual !== false) warnings.push("You merged these receipts onto one expense.");
  await db.update(expenses).set({ warnings, updatedAt: new Date(), updatedBy: input.userId }).where(eq(expenses.id, target.id));
  await db.insert(auditEvents).values({
    companyId: input.companyId,
    actorId: input.userId,
    entityType: "expense",
    entityId: target.id,
    action: "expense.merge",
    detail: { sourceId: source.id, sourceAmount: source.amount, targetAmount: target.amount }
  });
  return target.id;
}

export async function splitReceiptFromExpense(
  db: QueryClient,
  input: { companyId: string; userId: string | null; expenseId: string; receiptId: string }
) {
  const [expense] = await db
    .select()
    .from(expenses)
    .where(and(eq(expenses.id, input.expenseId), eq(expenses.companyId, input.companyId)))
    .limit(1);
  if (!expense) throw new BooksError("Expense not found.");
  const attached = await db
    .select()
    .from(receipts)
    .where(and(eq(receipts.expenseId, expense.id), eq(receipts.companyId, input.companyId)));
  const receipt = attached.find((row) => row.id === input.receiptId);
  if (!receipt) throw new BooksError("That receipt is not attached to this expense.");
  if (attached.length < 2) throw new BooksError("This expense has only one receipt.");
  await db.update(receipts).set({ expenseId: null, role: null, updatedAt: new Date() }).where(eq(receipts.id, receipt.id));
  const extract = readExtract(receipt.rawExtract);
  let createdId: string;
  if (extract) {
    createdId = await postExpenseFromReceipt(db, {
      companyId: input.companyId,
      userId: input.userId,
      receiptId: receipt.id,
      txnType: expense.type as TxnType,
      settlementAccountId: receipt.settlementAccountId,
      extract
    });
  } else {
    const [created] = await db
      .insert(expenses)
      .values({
        companyId: input.companyId,
        type: expense.type,
        settlementAccountId: expense.settlementAccountId,
        categoryId: expense.categoryId,
        txnDate: expense.txnDate,
        merchant: expense.merchant,
        description: expense.description,
        amount: expense.amount,
        currency: expense.currency,
        paymentMethod: expense.paymentMethod,
        extractionSource: "manual",
        warnings: ["Split from another expense. Both amounts stay posted until you edit them."],
        reviewStatus: "needs_review",
        createdBy: input.userId,
        updatedBy: input.userId
      })
      .returning();
    const resolved = await resolvePosting(db, input.companyId, {
      type: expense.type as TxnType,
      settlementAccountId: expense.settlementAccountId,
      categoryId: expense.categoryId,
      txnDate: expense.txnDate,
      description: expense.description,
      amount: expense.amount
    });
    await writeLines(db, {
      companyId: input.companyId,
      expenseId: created.id,
      date: expense.txnDate,
      description: resolved.description,
      draft: resolved.draft
    });
    await db.update(receipts).set({ expenseId: created.id, role: "primary", updatedAt: new Date() }).where(eq(receipts.id, receipt.id));
    createdId = created.id;
  }
  await syncExpenseWithReceipts(db, { companyId: input.companyId, userId: input.userId, expenseId: expense.id });
  const note = "A receipt was split onto its own expense. Both amounts stay posted until you edit them.";
  for (const id of [expense.id, createdId]) {
    const [row] = await db.select({ warnings: expenses.warnings }).from(expenses).where(eq(expenses.id, id)).limit(1);
    const warnings = [...(Array.isArray(row?.warnings) ? row.warnings : [])];
    if (!warnings.includes(note)) warnings.push(note);
    await db.update(expenses).set({ warnings, updatedAt: new Date(), updatedBy: input.userId }).where(eq(expenses.id, id));
  }
  await db.insert(auditEvents).values({
    companyId: input.companyId,
    actorId: input.userId,
    entityType: "expense",
    entityId: expense.id,
    action: "expense.split",
    detail: { receiptId: receipt.id, createdId }
  });
  return createdId;
}

export async function dismissExpenseRelation(db: QueryClient, input: { companyId: string; relationId: string }) {
  const [row] = await db
    .update(expenseRelations)
    .set({ status: "dismissed" })
    .where(and(eq(expenseRelations.id, input.relationId), eq(expenseRelations.companyId, input.companyId)))
    .returning({ id: expenseRelations.id });
  if (!row) throw new BooksError("Suggestion not found.");
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
    .insert(expenses)
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
    expenseId: created.id,
    date: input.txnDate,
    description: resolved.description,
    draft: resolved.draft
  });
  await db.insert(auditEvents).values({
    companyId: input.companyId,
    actorId: input.userId,
    entityType: "expense",
    entityId: created.id,
    action: "expense.create",
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
    .from(expenses)
    .where(and(eq(expenses.id, input.id), eq(expenses.companyId, input.companyId)))
    .limit(1);
  if (!current) throw new BooksError("Expense not found.");
  const resolved = await resolvePosting(db, input.companyId, { ...input, type });
  await db
    .update(expenses)
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
    .where(eq(expenses.id, current.id));
  await writeLines(db, {
    companyId: input.companyId,
    expenseId: current.id,
    date: input.txnDate,
    description: resolved.description,
    draft: resolved.draft
  });
  await db.insert(auditEvents).values({
    companyId: input.companyId,
    actorId: input.userId,
    entityType: "expense",
    entityId: current.id,
    action: input.reviewStatus === "approved" ? "expense.approve" : "expense.update",
    detail: {
      before: { amount: current.amount, date: current.txnDate, categoryId: current.categoryId, type: current.type },
      after: { amount: resolved.amount, date: input.txnDate, categoryId: input.categoryId, type }
    }
  });
}

const receiptCountSql = sql<number>`(select count(*)::int from ${receipts} where ${receipts.expenseId} = ${expenses.id})`;

export async function listExpenses(db: QueryClient, companyId: string, type?: TxnType) {
  const filters = [eq(expenses.companyId, companyId)];
  if (type) filters.push(eq(expenses.type, type));
  return db
    .select({
      id: expenses.id,
      type: expenses.type,
      txnDate: expenses.txnDate,
      merchant: expenses.merchant,
      description: expenses.description,
      amount: expenses.amount,
      reviewStatus: expenses.reviewStatus,
      extractionSource: expenses.extractionSource,
      paymentMethod: expenses.paymentMethod,
      categoryName: categories.name,
      accountName: accounts.name,
      accountCode: accounts.code,
      receiptCount: receiptCountSql
    })
    .from(expenses)
    .innerJoin(categories, eq(expenses.categoryId, categories.id))
    .innerJoin(accounts, eq(expenses.settlementAccountId, accounts.id))
    .where(and(...filters))
    .orderBy(desc(expenses.txnDate), desc(expenses.createdAt));
}

export const listTransactions = listExpenses;

export async function listReviewQueue(db: QueryClient, companyId: string) {
  return db
    .select({
      id: expenses.id,
      type: expenses.type,
      txnDate: expenses.txnDate,
      description: expenses.description,
      amount: expenses.amount,
      extractionSource: expenses.extractionSource,
      aiConfidence: expenses.aiConfidence,
      categoryName: categories.name,
      receiptCount: receiptCountSql
    })
    .from(expenses)
    .innerJoin(categories, eq(expenses.categoryId, categories.id))
    .where(and(eq(expenses.companyId, companyId), eq(expenses.reviewStatus, "needs_review")))
    .orderBy(asc(expenses.txnDate), asc(expenses.createdAt));
}

export async function getExpense(db: QueryClient, companyId: string, id: string) {
  const [row] = await db
    .select()
    .from(expenses)
    .where(and(eq(expenses.id, id), eq(expenses.companyId, companyId)))
    .limit(1);
  if (!row) return null;
  const [category] = await db
    .select({ name: categories.name })
    .from(categories)
    .where(eq(categories.id, row.categoryId))
    .limit(1);
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
    .where(eq(journalLines.expenseId, row.id))
    .orderBy(asc(journalLines.sortOrder));
  const attached = await db
    .select({
      id: receipts.id,
      fileName: receipts.fileName,
      mimeType: receipts.mimeType,
      status: receipts.status,
      extractionSource: receipts.extractionSource,
      error: receipts.error,
      documentKind: receipts.documentKind,
      role: receipts.role
    })
    .from(receipts)
    .where(and(eq(receipts.expenseId, row.id), eq(receipts.companyId, companyId)))
    .orderBy(asc(receipts.createdAt));
  const relations = await db
    .select({
      id: expenseRelations.id,
      expenseId: expenseRelations.expenseId,
      relatedExpenseId: expenseRelations.relatedExpenseId,
      confidence: expenseRelations.confidence,
      reason: expenseRelations.reason
    })
    .from(expenseRelations)
    .where(
      and(
        eq(expenseRelations.companyId, companyId),
        eq(expenseRelations.status, "suggested"),
        or(eq(expenseRelations.expenseId, row.id), eq(expenseRelations.relatedExpenseId, row.id))
      )
    );
  const otherIds = relations.map((relation) => (relation.expenseId === row.id ? relation.relatedExpenseId : relation.expenseId));
  const relatedRows = otherIds.length
    ? await db
        .select({
          id: expenses.id,
          description: expenses.description,
          amount: expenses.amount,
          txnDate: expenses.txnDate,
          merchant: expenses.merchant
        })
        .from(expenses)
        .where(and(eq(expenses.companyId, companyId), inArray(expenses.id, otherIds)))
    : [];
  const relatedById = new Map(relatedRows.map((item) => [item.id, item]));
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
    .select({ id: expenses.id })
    .from(expenses)
    .where(and(eq(expenses.companyId, companyId), eq(expenses.reviewStatus, "needs_review"), ne(expenses.id, row.id)))
    .orderBy(asc(expenses.txnDate), asc(expenses.createdAt))
    .limit(1);
  return {
    expense: row,
    categoryName: category?.name ?? "",
    lines,
    receipts: attached,
    suggestions: relations.flatMap((relation) => {
      const otherId = relation.expenseId === row.id ? relation.relatedExpenseId : relation.expenseId;
      const other = relatedById.get(otherId);
      if (!other) return [];
      return [{ relationId: relation.id, confidence: relation.confidence, reason: relation.reason, expense: other }];
    }),
    history,
    nextReviewId: next?.id ?? null
  };
}

export const getTransaction = getExpense;

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
      expenseId: journalLines.expenseId,
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
    .orderBy(asc(journalLines.lineDate), asc(journalLines.expenseId), asc(journalLines.sortOrder))
    .limit(1000);
}

export async function dashboard(db: QueryClient, companyId: string, from: string, to: string) {
  const [review] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(expenses)
    .where(and(eq(expenses.companyId, companyId), eq(expenses.reviewStatus, "needs_review")));
  const [queued] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(receipts)
    .where(and(eq(receipts.companyId, companyId), sql`${receipts.status} in ('queued', 'processing')`));
  const totals = await db
    .select({
      type: expenses.type,
      count: sql<number>`count(*)::int`,
      total: sql<string>`coalesce(sum(${expenses.amount}), 0)::text`
    })
    .from(expenses)
    .where(and(eq(expenses.companyId, companyId), gte(expenses.txnDate, from), lte(expenses.txnDate, to)))
    .groupBy(expenses.type);
  const recent = await listExpenses(db, companyId);
  return {
    reviewCount: review?.count ?? 0,
    queuedCount: queued?.count ?? 0,
    totals,
    recent: recent.slice(0, 8)
  };
}
