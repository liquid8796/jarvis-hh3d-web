-- `notice.broadcast` (Phát thông báo tông môn) vào sổ quyền.
--
-- Đi RIÊNG khỏi 0024 (nơi dựng hai bảng) vì 0024 đã áp xuống trước khi quyền này thành hình —
-- sửa một migration đã chạy là cách chắc chắn nhất để hai máy có hai lịch sử khác nhau: máy đã
-- áp thì không chạy lại, máy mới thì chạy bản đã sửa.
--
-- Trao cho CẢ BA vai bậc trị sự, khớp từng dòng với `TRI_SU_PERMISSIONS` bên permissions.ts:
-- phát thông báo là việc NÓI, không phải việc ra tay — nó không dừng đàn ai, không xoá gì, và
-- người nhận luôn có nút đóng. (Gia chủ vốn nhận nguyên khối `PERMISSIONS` ở phía code, nhưng
-- bảng dưới database thì cần dòng tường minh — phép so của verify:roles là HAI CHIỀU, thừa một
-- dòng cũng đỏ như thiếu một dòng.)
--
-- Idempotent như 0013/0017/0021: chạy lại chỉ đồng bộ nhãn, không nhân bản gì.
INSERT INTO "permissions" ("code", "label") VALUES
  ('notice.broadcast', 'Phát thông báo tông môn')
ON CONFLICT ("code") DO UPDATE SET "label" = excluded."label";--> statement-breakpoint
INSERT INTO "role_permissions" ("role_code", "permission_code") VALUES
  ('gia-chu', 'notice.broadcast'),
  ('thai-thuong-truong-lao', 'notice.broadcast'),
  ('chuong-mon', 'notice.broadcast')
ON CONFLICT DO NOTHING;
