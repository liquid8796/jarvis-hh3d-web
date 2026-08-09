-- Vai PHÀM NHÂN — danh xưng của người ĐANG CHỜ DUYỆT, và là bậc thấp nhất của thang vai.
--
-- `sort_order` 4 vì nó đứng cuối `ASSIGNABLE_ROLES`; `verify:roles` so đúng con số này với vị
-- trí trong mảng ấy, nên đổi một chỗ mà quên chỗ kia là phép kiểm đỏ ngay.
--
-- KHÔNG có dòng nào cho `role_permissions`, và đó là chủ ý: phàm nhân chưa nhập môn thì chưa
-- có gì để mở (`ROLE_PERMISSIONS["pham-nhan"] = []`). Phép so của `verify:roles` là hai chiều
-- nên một dòng thừa ở đây cũng đỏ y như một dòng thiếu.
--
-- Idempotent như 0013/0015: chạy lại chỉ đồng bộ nhãn và thứ tự, không nhân bản gì.
INSERT INTO "roles" ("code", "label", "sort_order") VALUES
  ('pham-nhan', 'Phàm nhân', 4)
ON CONFLICT ("code") DO UPDATE SET "label" = excluded."label", "sort_order" = excluded."sort_order";--> statement-breakpoint

-- Ban danh xưng cho những đạo hữu chưa có gì: MỌI người KHÔNG mang `gia-chu`, theo đúng lệ
-- 「toàn bộ user trừ gia-chu thành đệ tử」. Danh xưng suy từ TRẠNG THÁI, cùng một luật mà
-- `register` và `setStatus` dùng — chờ duyệt thì Phàm nhân, còn lại thì Đệ tử.
--
-- `disabled` rơi vào nhánh `de-tu`: lịch sử không nói được người ấy bị từ chối lúc còn chờ
-- duyệt hay bị đình quyền sau khi đã nhập môn, mà `de-tu` là phỏng đoán ít gây hại hơn — nó
-- không mở thêm quyền nào. Lúc migration này chạy, cả 9 đạo hữu đều `active` nên nhánh ấy là
-- phép rỗng; nó có mặt để lần chạy sau trên một database khác không rơi vào khoảng trống.
--
-- Chỉ THÊM, không xoá: ai đang mang vai trị sự thì giữ nguyên. `ON CONFLICT` cho lần chạy lại.
INSERT INTO "user_roles" ("user_id", "role_code")
SELECT u."id",
       CASE WHEN u."status" = 'pending' THEN 'pham-nhan' ELSE 'de-tu' END
  FROM "users" u
 WHERE NOT EXISTS (
   SELECT 1 FROM "user_roles" ur
    WHERE ur."user_id" = u."id" AND ur."role_code" = 'gia-chu'
 )
ON CONFLICT ("user_id", "role_code") DO NOTHING;
