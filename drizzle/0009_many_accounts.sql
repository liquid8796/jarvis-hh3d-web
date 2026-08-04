-- Nhiều tài khoản game cho một đạo hữu — như bản desktop vẫn làm từ đầu.
--
-- Cho tới nay cookie sống lẫn trong user_configs như một trường của cấu hình, nên "tài
-- khoản" và "cấu hình" là một. Tách nó ra thành bảng riêng vì ba lẽ: (1) một người có thể
-- nuôi nhiều tài khoản và mỗi tài khoản cần bật/tắt độc lập; (2) hạng VIP/thường là thuộc
-- tính CỦA COOKIE chứ không phải của người dùng — hai tài khoản của cùng một người có thể
-- khác hạng; (3) job phải biết nó chạy cho tài khoản nào để linh sứ chọn đúng hồ sơ trình
-- duyệt và server vá đúng verdict hạng.
--
-- Phần DDL bên dưới do drizzle-kit sinh từ schema.ts (snapshot 0009 đi kèm); phần backfill
-- và trigger là viết tay — drizzle không biết kể chuyện dọn nhà.
CREATE TABLE "game_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"label" text NOT NULL,
	"cookie_envelope" text NOT NULL,
	"account_tier" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "automation_jobs" ADD COLUMN "account_id" uuid;--> statement-breakpoint
ALTER TABLE "game_accounts" ADD CONSTRAINT "game_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "accounts_user_idx" ON "game_accounts" USING btree ("user_id","created_at");--> statement-breakpoint
ALTER TABLE "automation_jobs" ADD CONSTRAINT "automation_jobs_account_id_game_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."game_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "jobs_account_idx" ON "automation_jobs" USING btree ("account_id","created_at");--> statement-breakpoint
-- MỖI TÀI KHOẢN TỐI ĐA MỘT ĐÀN SỐNG. startJob là check-then-insert qua nhiều round-trip
-- nên hai lượt Khai Đàn đồng thời có thể cùng thấy tài khoản còn rảnh; luật cuối cùng phải
-- nằm ở database. Hai job sống cùng cookie = hai Chromium giành một hồ sơ, một nhân vật bị
-- chạy nhiệm vụ đôi.
CREATE UNIQUE INDEX "jobs_one_active_per_account" ON "automation_jobs" USING btree ("account_id") WHERE status in ('queued', 'running', 'stopping');
--> statement-breakpoint
-- Hạng chỉ có hai giá trị hợp lệ; NULL nghĩa là cookie này chưa được dò.
ALTER TABLE "game_accounts" ADD CONSTRAINT "game_accounts_tier_check" CHECK ("account_tier" IS NULL OR "account_tier" IN ('vip', 'free'));
--> statement-breakpoint

-- Dọn nhà: cookie đơn đang nằm trong user_configs trở thành "Tài khoản 1". Phong bì đã mã
-- hoá đi nguyên vẹn (app giải mã, không phải SQL); verdict hạng đã chứng minh đi theo cookie.
INSERT INTO "game_accounts" ("user_id", "label", "cookie_envelope", "account_tier")
SELECT
  "user_id",
  'Tài khoản 1',
  "config" ->> 'gameCookie',
  CASE WHEN "config" ->> 'accountTier' IN ('vip', 'free') THEN "config" ->> 'accountTier' END
FROM "user_configs"
WHERE coalesce("config" ->> 'gameCookie', '') <> '';
--> statement-breakpoint

-- Job đang sống (kể cả đang ngủ chờ vòng kế) nhận diện tài khoản vừa sinh — mỗi người chỉ
-- có đúng một tài khoản migrate nên phép gán không nhập nhằng. Job đã kết thúc để nguyên
-- làm lịch sử.
UPDATE "automation_jobs" AS job
SET "account_id" = acc."id"
FROM "game_accounts" AS acc
WHERE acc."user_id" = job."user_id"
  AND job."account_id" IS NULL
  AND job."status" IN ('queued', 'running', 'stopping');
--> statement-breakpoint

-- Cookie rời hẳn user_configs — một bí mật không được phép có hai nhà. storedConfigSchema
-- có default cho cả hai khoá nên document thiếu chúng vẫn parse lành lặn.
UPDATE "user_configs"
SET "config" = ("config" - 'gameCookie') - 'accountTier'
WHERE "config" ? 'gameCookie' OR "config" ? 'accountTier';
--> statement-breakpoint

-- Chuông cửa cho bảng mới: mọi thay đổi tài khoản (thêm/sửa/bật-tắt/xoá/verdict hạng) phát
-- topic 'config' — đúng topic mà tab Nhiệm vụ và danh sách tài khoản trên Linh Đài đang nghe.
CREATE OR REPLACE FUNCTION "jarvis_notify_account_change"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_user text;
BEGIN
  target_user := CASE WHEN TG_OP = 'DELETE' THEN OLD.user_id::text ELSE NEW.user_id::text END;
  PERFORM pg_notify(
    'jarvis_dashboard',
    json_build_object('userId', target_user, 'topic', 'config')::text
  );
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "jarvis_dashboard_account_change"
AFTER INSERT OR UPDATE OR DELETE ON "game_accounts"
FOR EACH ROW EXECUTE FUNCTION "jarvis_notify_account_change"();
