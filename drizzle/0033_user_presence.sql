-- Trạng thái giao tiếp do chính đạo hữu chọn; heartbeat quyết định trạng thái còn tươi.
DO $$ BEGIN
  CREATE TYPE "public"."presence_status" AS ENUM('online', 'busy', 'offline');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "presence_status" "presence_status" DEFAULT 'online' NOT NULL;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "presence_seen_at" timestamp with time zone;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "users_presence_idx" ON "users" USING btree ("presence_status", "presence_seen_at");