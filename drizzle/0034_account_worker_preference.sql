-- Null means "use user_configs.config.workerPref". No backfill of existing accounts.
ALTER TABLE "game_accounts" ADD COLUMN IF NOT EXISTS "worker_pref_override" text;
