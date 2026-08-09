-- Xoá vai `admin` (danh xưng「Trưởng môn」), gộp người mang nó vào `chuong-mon`.
--
-- VÌ SAO GỘP ĐƯỢC MÀ KHÔNG MẤT GÌ: `admin` và `chuong-mon` xưa nay nắm ĐÚNG một bộ quyền
-- (`TRI_SU_PERMISSIONS` trong permissions.ts) — chúng chỉ khác nhau ở danh xưng. Nên đây là
-- bỏ một cái TÊN thừa, không phải hạ quyền của ai.
--
-- Lúc viết migration này `user_roles` không có dòng nào mang `admin` (đã đếm), nên bước 1 là
-- phép rỗng. Vẫn viết ra, vì migration phải đúng cả khi có người kịp nhận vai giữa lúc này và
-- lúc nó chạy trên production — và vì `user_roles.role_code` là ON DELETE RESTRICT, bỏ bước
-- ấy thì bước 3 sẽ NÉM chứ không âm thầm hỏng.
--
-- `role_permissions` của `admin` (admin.panel, member.manage) tự rụng theo ON DELETE CASCADE,
-- nên không có lệnh nào cho nó ở đây. Đó là chủ ý, không phải bỏ sót.
--
-- Idempotent: chạy lại là ba phép rỗng.

-- 1. Ai đang mang `admin` thì mang `chuong-mon` thay vào. `ON CONFLICT` cho người đã sẵn có
--    cả hai vai — khoá chính là (user_id, role_code).
INSERT INTO "user_roles" ("user_id", "role_code")
SELECT "user_id", 'chuong-mon' FROM "user_roles" WHERE "role_code" = 'admin'
ON CONFLICT ("user_id", "role_code") DO NOTHING;--> statement-breakpoint

DELETE FROM "user_roles" WHERE "role_code" = 'admin';--> statement-breakpoint

-- 2. Xoá vai khỏi danh mục.
DELETE FROM "roles" WHERE "code" = 'admin';--> statement-breakpoint

-- 3. `de-tu` tụt một bậc. KHÔNG phải chuyện thẩm mỹ: `npm run verify:roles` khẳng định
--    `sort_order` bằng ĐÚNG chỉ số của vai trong `ASSIGNABLE_ROLES`, mà `admin` vừa rời khỏi
--    vị trí 3. Quên dòng này là phép kiểm đỏ ngay, và thang vai dưới database thủng một nấc.
UPDATE "roles" SET "sort_order" = 3 WHERE "code" = 'de-tu';
