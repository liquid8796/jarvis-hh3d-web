-- `github_station.manage` (Quản kho khôi lỗi GitHub) vào sổ quyền.
--
-- Quyền của tab Kho GitHub: sổ tài khoản GitHub đang giữ khôi lỗi, cộng lệnh nuôi kho cho khỏi
-- bị tắt lịch sau 60 ngày (deploy/github-actions.md §7). CHỈ gia-chu, và đó là chủ ý — sổ này
-- cầm PAT, thứ PUSH ĐƯỢC MÃ vào kho của bốn tài khoản khác. Một PAT rò ra là kẻ cầm nó sửa
-- được chính `worker.mjs` đang chạy trên runner, nên bậc trị sự thường không có việc gì ở đây.
--
-- KHÔNG núp dưới `site.switch` dù cùng bậc: hai sổ cầm hai loại chìa khác nhau (chuỗi kết nối
-- database ≠ chìa push mã), và ngày muốn tách chúng ra thì phải có sẵn hai cái tên.
--
-- Gia chủ nhận nguyên khối `PERMISSIONS` ở phía code nên danh sách vai bên ấy không phải sửa;
-- bảng dưới database thì vẫn cần dòng grant tường minh — phép so của verify:roles là HAI CHIỀU,
-- thừa một dòng cũng đỏ như thiếu một dòng.
--
-- Idempotent như 0013/0017/0021/0025: chạy lại chỉ đồng bộ nhãn, không nhân bản gì.
INSERT INTO "permissions" ("code", "label") VALUES
  ('github_station.manage', 'Quản kho khôi lỗi GitHub')
ON CONFLICT ("code") DO UPDATE SET "label" = excluded."label";--> statement-breakpoint
INSERT INTO "role_permissions" ("role_code", "permission_code") VALUES
  ('gia-chu', 'github_station.manage')
ON CONFLICT DO NOTHING;
