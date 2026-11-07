-- Additive migration: existing labels remain unlimited. Apply before deploying new readers.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "tag_expirations" jsonb NOT NULL DEFAULT '{}'::jsonb;
