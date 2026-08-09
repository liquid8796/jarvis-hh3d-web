-- Vai ĐỆ TỬ — danh xưng cho môn đồ thường, KHÔNG mang quyền nào.
--
-- `sort_order` 4 vì nó đứng cuối `ASSIGNABLE_ROLES`: đó là bậc thấp nhất của thang vai, và
-- `verify:roles` so đúng con số này với vị trí trong mảng ấy.
--
-- KHÔNG có dòng nào cho `role_permissions`, và đó là chủ ý chứ không phải bỏ sót: đệ tử không
-- mở được việc gì cả (`ROLE_PERMISSIONS["de-tu"] = []`). Phép so của `verify:roles` là hai
-- chiều — một dòng thừa ở đây cũng đỏ y như một dòng thiếu.
--
-- Idempotent như 0013: chạy lại chỉ đồng bộ lại nhãn và thứ tự, không nhân bản gì.
INSERT INTO "roles" ("code", "label", "sort_order") VALUES
  ('de-tu', 'Đệ tử', 4)
ON CONFLICT ("code") DO UPDATE SET "label" = excluded."label", "sort_order" = excluded."sort_order";
