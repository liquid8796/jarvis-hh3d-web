-- Hai quyền vào sổ một đợt — một nợ cũ và một quyền mới của hệ gương trạm.
--
-- 1. `job.force_start` (Khai đàn hộ người khác): code khai từ 10/08/2026 (xem chú thích tại
--    THAI_THUONG_PERMISSIONS trong permissions.ts) nhưng đợt ấy THIẾU migration — verify:roles
--    đỏ trên production từ đó: code 7 quyền, bảng permissions 6. Dòng dưới trả đúng món nợ:
--    quyền + hai grant (gia-chu, thai-thuong-truong-lao) khớp từng dòng với ROLE_PERMISSIONS.
--
-- 2. `site.switch` (Chuyển gương trạm): quyền của tab Gương Trạm — nhập sổ trạm dự phòng và
--    phát lệnh chuyển (deploy/mirror/README.md §6). CHỈ gia-chu, và đó là chủ ý: sổ này cầm
--    chuỗi kết nối database của các trạm khác (đã mã hoá), còn lệnh chuyển thì bứng cả tông
--    môn sang một tài khoản Vercel khác — không có lý do nào để bậc trị sự thường chạm vào.
--    Gia chủ nhận qua `PERMISSIONS` nguyên khối phía code nên không cần sửa danh sách vai nào.
--
-- Phép so của verify:roles là HAI CHIỀU — thừa một dòng cũng đỏ như thiếu một dòng. Idempotent
-- như 0013/0015/0017: chạy lại chỉ đồng bộ nhãn, không nhân bản gì.
INSERT INTO "permissions" ("code", "label") VALUES
  ('job.force_start', 'Khai đàn hộ người khác'),
  ('site.switch', 'Chuyển gương trạm')
ON CONFLICT ("code") DO UPDATE SET "label" = excluded."label";--> statement-breakpoint
INSERT INTO "role_permissions" ("role_code", "permission_code") VALUES
  ('gia-chu', 'job.force_start'),
  ('thai-thuong-truong-lao', 'job.force_start'),
  ('gia-chu', 'site.switch')
ON CONFLICT DO NOTHING;
