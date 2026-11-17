ALTER TABLE "documents" ALTER COLUMN "file_data" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "storage_key" text;--> statement-breakpoint
ALTER TABLE "report_jobs" ADD COLUMN "storage_key" text;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_file_stored_check" CHECK (("documents"."file_data" IS NOT NULL AND "documents"."storage_key" IS NULL) OR ("documents"."file_data" IS NULL AND "documents"."storage_key" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "report_jobs" ADD CONSTRAINT "report_jobs_file_stored_check" CHECK ("report_jobs"."status" <> 'ready' OR (("report_jobs"."file_data" IS NOT NULL AND "report_jobs"."storage_key" IS NULL) OR ("report_jobs"."file_data" IS NULL AND "report_jobs"."storage_key" IS NOT NULL)));