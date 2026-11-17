-- Replaces receipt, expense, and journal data. Users, companies, memberships, accounts, categories, rules, openings, and report jobs stay.
DELETE FROM "audit_events" WHERE "entity_type" IN ('transaction', 'document');
--> statement-breakpoint
DROP TABLE IF EXISTS "journal_lines";
--> statement-breakpoint
DROP TABLE IF EXISTS "transactions";
--> statement-breakpoint
DROP TABLE IF EXISTS "documents";
--> statement-breakpoint
CREATE TABLE "expenses" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"type" text NOT NULL,
	"settlement_account_id" text NOT NULL,
	"category_id" text NOT NULL,
	"txn_date" date NOT NULL,
	"merchant" text DEFAULT '' NOT NULL,
	"description" text NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"currency" text DEFAULT 'HKD' NOT NULL,
	"original_amount" numeric(14, 2),
	"original_currency" text,
	"payment_method" text,
	"ai_confidence" numeric(4, 3),
	"extraction_source" text DEFAULT 'manual' NOT NULL,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"review_status" text DEFAULT 'needs_review' NOT NULL,
	"group_confidence" numeric(4, 3),
	"created_by" text,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "receipts" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"expense_id" text,
	"uploaded_by" text,
	"batch_id" text NOT NULL,
	"parent_receipt_id" text,
	"file_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"byte_size" integer NOT NULL,
	"file_data" bytea,
	"storage_key" text,
	"source" text DEFAULT 'upload' NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"document_kind" text,
	"role" text,
	"txn_type" text NOT NULL,
	"settlement_account_id" text NOT NULL,
	"extraction_source" text,
	"raw_extract" jsonb,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	CONSTRAINT "receipts_file_stored_check" CHECK (("receipts"."file_data" IS NOT NULL AND "receipts"."storage_key" IS NULL) OR ("receipts"."file_data" IS NULL AND "receipts"."storage_key" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "expense_relations" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"expense_id" text NOT NULL,
	"related_expense_id" text NOT NULL,
	"confidence" numeric(4, 3) NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'suggested' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "expense_relations_distinct_check" CHECK ("expense_relations"."expense_id" <> "expense_relations"."related_expense_id")
);
--> statement-breakpoint
CREATE TABLE "journal_lines" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"expense_id" text NOT NULL,
	"doc_type_code" text NOT NULL,
	"line_date" date NOT NULL,
	"description" text NOT NULL,
	"account_id" text NOT NULL,
	"category_id" text,
	"debit" numeric(14, 2) DEFAULT '0' NOT NULL,
	"credit" numeric(14, 2) DEFAULT '0' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_settlement_account_id_accounts_id_fk" FOREIGN KEY ("settlement_account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_expense_id_expenses_id_fk" FOREIGN KEY ("expense_id") REFERENCES "public"."expenses"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_parent_receipt_id_receipts_id_fk" FOREIGN KEY ("parent_receipt_id") REFERENCES "public"."receipts"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_settlement_account_id_accounts_id_fk" FOREIGN KEY ("settlement_account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "expense_relations" ADD CONSTRAINT "expense_relations_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "expense_relations" ADD CONSTRAINT "expense_relations_expense_id_expenses_id_fk" FOREIGN KEY ("expense_id") REFERENCES "public"."expenses"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "expense_relations" ADD CONSTRAINT "expense_relations_related_expense_id_expenses_id_fk" FOREIGN KEY ("related_expense_id") REFERENCES "public"."expenses"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_expense_id_expenses_id_fk" FOREIGN KEY ("expense_id") REFERENCES "public"."expenses"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "expenses_company_review_idx" ON "expenses" USING btree ("company_id","review_status");
--> statement-breakpoint
CREATE INDEX "expenses_company_type_idx" ON "expenses" USING btree ("company_id","type");
--> statement-breakpoint
CREATE INDEX "expenses_company_date_idx" ON "expenses" USING btree ("company_id","txn_date");
--> statement-breakpoint
CREATE INDEX "receipts_company_status_idx" ON "receipts" USING btree ("company_id","status");
--> statement-breakpoint
CREATE INDEX "receipts_company_created_idx" ON "receipts" USING btree ("company_id","created_at");
--> statement-breakpoint
CREATE INDEX "receipts_expense_idx" ON "receipts" USING btree ("expense_id");
--> statement-breakpoint
CREATE INDEX "receipts_batch_idx" ON "receipts" USING btree ("company_id","batch_id");
--> statement-breakpoint
CREATE INDEX "receipts_parent_idx" ON "receipts" USING btree ("parent_receipt_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "expense_relations_pair_unique" ON "expense_relations" USING btree ("company_id","expense_id","related_expense_id");
--> statement-breakpoint
CREATE INDEX "expense_relations_expense_idx" ON "expense_relations" USING btree ("expense_id");
--> statement-breakpoint
CREATE INDEX "expense_relations_related_idx" ON "expense_relations" USING btree ("related_expense_id");
--> statement-breakpoint
CREATE INDEX "journal_lines_company_date_idx" ON "journal_lines" USING btree ("company_id","line_date");
--> statement-breakpoint
CREATE INDEX "journal_lines_expense_idx" ON "journal_lines" USING btree ("expense_id");
