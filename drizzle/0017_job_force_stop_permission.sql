-- Quyền DỪNG ĐÀN CỦA NGƯỜI KHÁC — nút Dừng trên trang Hàng Đợi.
--
-- Chỉ hai vai được ban: Gia chủ và Thái thượng trưởng lão. Chưởng môn và Trưởng môn KHÔNG,
-- và đó là chủ ý — đây là lần đầu ba vai bậc trị sự thôi ngang nhau, xem chú thích tại
-- `THAI_THUONG_PERMISSIONS` trong src/lib/auth/permissions.ts.
--
-- Phép so của `verify:roles` là HAI CHIỀU: một dòng thừa ở đây cũng đỏ y như một dòng thiếu.
-- Nên nếu sau này ai đó thu quyền này khỏi một vai trong code, phải có một migration gỡ dòng
-- tương ứng, không phải chỉ sửa code rồi thôi.
--
-- Idempotent như 0013 và 0015: chạy lại chỉ đồng bộ lại nhãn, không nhân bản gì.
INSERT INTO "permissions" ("code", "label") VALUES
  ('job.force_stop', 'Dừng đàn của người khác')
ON CONFLICT ("code") DO UPDATE SET "label" = excluded."label";--> statement-breakpoint
INSERT INTO "role_permissions" ("role_code", "permission_code") VALUES
  ('gia-chu', 'job.force_stop'),
  ('thai-thuong-truong-lao', 'job.force_stop')
ON CONFLICT DO NOTHING;
