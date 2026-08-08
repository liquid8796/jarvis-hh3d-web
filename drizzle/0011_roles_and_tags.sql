ALTER TABLE "users" ADD COLUMN "roles" text[] DEFAULT ARRAY[]::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "tags" text[] DEFAULT ARRAY[]::text[] NOT NULL;--> statement-breakpoint
UPDATE "users" SET "roles" = ARRAY['admin'] WHERE "role" = 'admin';--> statement-breakpoint
UPDATE "users" SET "roles" = ARRAY['gia-chu','admin'] WHERE "id" = (
  SELECT "id" FROM "users" WHERE "role" = 'admin' ORDER BY "created_at" ASC LIMIT 1
);
