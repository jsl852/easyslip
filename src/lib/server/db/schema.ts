import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  customType,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex
} from "drizzle-orm/pg-core";

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "bytea";
  }
});

export const users = pgTable("users", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name"),
  email: text("email").notNull().unique(),
  image: text("image"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow()
});

export const companies = pgTable("companies", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull(),
  locale: text("locale").notNull().default("en-HK"),
  baseCurrency: text("base_currency").notNull().default("HKD"),
  fiscalYearStartMonth: integer("fiscal_year_start_month").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow()
});

export const memberships = pgTable(
  "memberships",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    companyId: text("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("owner"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow()
  },
  (table) => [uniqueIndex("memberships_user_unique").on(table.userId)]
);

export const accounts = pgTable(
  "accounts",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    companyId: text("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    type: text("type").notNull(),
    subtype: text("subtype").notNull().default("general"),
    normalBalance: text("normal_balance").notNull(),
    plGroup: text("pl_group"),
    currency: text("currency").notNull().default("HKD"),
    isSettlement: boolean("is_settlement").notNull().default(false),
    employeeLabel: text("employee_label"),
    active: boolean("active").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow()
  },
  (table) => [
    uniqueIndex("accounts_company_code_unique").on(table.companyId, table.code),
    index("accounts_company_idx").on(table.companyId)
  ]
);

export const categories = pgTable(
  "categories",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    companyId: text("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    kind: text("kind").notNull(),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "restrict" }),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow()
  },
  (table) => [
    uniqueIndex("categories_company_name_unique").on(table.companyId, table.name),
    index("categories_company_idx").on(table.companyId)
  ]
);

export const keywordRules = pgTable(
  "keyword_rules",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    companyId: text("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    pattern: text("pattern").notNull(),
    categoryId: text("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "cascade" }),
    priority: integer("priority").notNull().default(0),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow()
  },
  (table) => [index("keyword_rules_company_idx").on(table.companyId)]
);

export const documents = pgTable(
  "documents",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    companyId: text("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    uploadedBy: text("uploaded_by").references(() => users.id, { onDelete: "set null" }),
    batchId: text("batch_id").notNull(),
    parentDocumentId: text("parent_document_id").references((): AnyPgColumn => documents.id, { onDelete: "set null" }),
    fileName: text("file_name").notNull(),
    mimeType: text("mime_type").notNull(),
    byteSize: integer("byte_size").notNull(),
    fileData: bytea("file_data"),
    storageKey: text("storage_key"),
    source: text("source").notNull().default("upload"),
    status: text("status").notNull().default("queued"),
    txnType: text("txn_type").notNull(),
    settlementAccountId: text("settlement_account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "restrict" }),
    extractionSource: text("extraction_source"),
    rawExtract: jsonb("raw_extract"),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    processedAt: timestamp("processed_at", { withTimezone: true, mode: "date" })
  },
  (table) => [
    index("documents_company_status_idx").on(table.companyId, table.status),
    index("documents_company_created_idx").on(table.companyId, table.createdAt),
    index("documents_parent_idx").on(table.parentDocumentId),
    check(
      "documents_file_stored_check",
      sql`(${table.fileData} IS NOT NULL AND ${table.storageKey} IS NULL) OR (${table.fileData} IS NULL AND ${table.storageKey} IS NOT NULL)`
    )
  ]
);

export const transactions = pgTable(
  "transactions",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    companyId: text("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    documentId: text("document_id").references(() => documents.id, { onDelete: "set null" }),
    type: text("type").notNull(),
    settlementAccountId: text("settlement_account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "restrict" }),
    categoryId: text("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "restrict" }),
    txnDate: date("txn_date", { mode: "string" }).notNull(),
    merchant: text("merchant").notNull().default(""),
    description: text("description").notNull(),
    amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
    currency: text("currency").notNull().default("HKD"),
    originalAmount: numeric("original_amount", { precision: 14, scale: 2 }),
    originalCurrency: text("original_currency"),
    aiConfidence: numeric("ai_confidence", { precision: 4, scale: 3 }),
    extractionSource: text("extraction_source").notNull().default("manual"),
    warnings: jsonb("warnings")
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    reviewStatus: text("review_status").notNull().default("needs_review"),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    updatedBy: text("updated_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow()
  },
  (table) => [
    index("transactions_company_review_idx").on(table.companyId, table.reviewStatus),
    index("transactions_company_type_idx").on(table.companyId, table.type),
    index("transactions_company_date_idx").on(table.companyId, table.txnDate),
    index("transactions_document_idx").on(table.documentId)
  ]
);

export const journalLines = pgTable(
  "journal_lines",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    companyId: text("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    transactionId: text("transaction_id")
      .notNull()
      .references(() => transactions.id, { onDelete: "cascade" }),
    docTypeCode: text("doc_type_code").notNull(),
    lineDate: date("line_date", { mode: "string" }).notNull(),
    description: text("description").notNull(),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "restrict" }),
    categoryId: text("category_id").references(() => categories.id, { onDelete: "set null" }),
    debit: numeric("debit", { precision: 14, scale: 2 }).notNull().default("0"),
    credit: numeric("credit", { precision: 14, scale: 2 }).notNull().default("0"),
    sortOrder: integer("sort_order").notNull().default(0)
  },
  (table) => [
    index("journal_lines_company_date_idx").on(table.companyId, table.lineDate),
    index("journal_lines_transaction_idx").on(table.transactionId)
  ]
);

export const openingBalances = pgTable(
  "opening_balances",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    companyId: text("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    asOf: date("as_of", { mode: "string" }).notNull(),
    debitBalance: numeric("debit_balance", { precision: 14, scale: 2 }).notNull(),
    note: text("note").notNull().default(""),
    source: text("source").notNull().default("manual"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow()
  },
  (table) => [index("opening_balances_company_idx").on(table.companyId, table.accountId)]
);

export const reportJobs = pgTable(
  "report_jobs",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    companyId: text("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    requestedBy: text("requested_by").references(() => users.id, { onDelete: "set null" }),
    periodFrom: date("period_from", { mode: "string" }).notNull(),
    periodTo: date("period_to", { mode: "string" }).notNull(),
    status: text("status").notNull(),
    fileName: text("file_name"),
    fileData: bytea("file_data"),
    storageKey: text("storage_key"),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow()
  },
  (table) => [
    index("report_jobs_company_idx").on(table.companyId, table.createdAt),
    check(
      "report_jobs_file_stored_check",
      sql`${table.status} <> 'ready' OR ((${table.fileData} IS NOT NULL AND ${table.storageKey} IS NULL) OR (${table.fileData} IS NULL AND ${table.storageKey} IS NOT NULL))`
    )
  ]
);

export const auditEvents = pgTable(
  "audit_events",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    companyId: text("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    actorId: text("actor_id").references(() => users.id, { onDelete: "set null" }),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    action: text("action").notNull(),
    detail: jsonb("detail").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow()
  },
  (table) => [index("audit_events_entity_idx").on(table.companyId, table.entityType, table.entityId)]
);
