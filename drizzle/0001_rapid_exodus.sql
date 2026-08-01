CREATE TYPE "public"."runner_kind" AS ENUM('sandbox', 'local');--> statement-breakpoint
DROP INDEX "jobs_status_idx";--> statement-breakpoint
ALTER TABLE "automation_jobs" ADD COLUMN "runner" "runner_kind" DEFAULT 'sandbox' NOT NULL;--> statement-breakpoint
ALTER TABLE "automation_jobs" ADD COLUMN "attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "jobs_queue_idx" ON "automation_jobs" USING btree ("status","runner","created_at");