-- Một database production cũ từng nhận cột email bằng migration nay không còn trong repo,
-- nhưng chưa có unique constraint. IF NOT EXISTS giúp lịch sử ấy hội tụ với database mới:
-- nơi mới tạo cột, nơi cũ giữ nguyên dữ liệu, cả hai cùng nhận một unique index.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "email" text;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "users_email_unique" ON "users" ("email");
