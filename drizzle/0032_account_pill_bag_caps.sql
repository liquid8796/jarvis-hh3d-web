-- Sức chứa túi đan là số đọc từ từng tài khoản, không phải hằng số chung theo phẩm.
-- NULL giữ đúng nghĩa chưa quan sát; không backfill 10/6/4/2 từ một tài khoản mẫu.
ALTER TABLE "game_accounts" ADD COLUMN "pill_bag_caps" jsonb;
--> statement-breakpoint
ALTER TABLE "game_accounts" ADD COLUMN "pill_bag_caps_observed_at" timestamp with time zone;
