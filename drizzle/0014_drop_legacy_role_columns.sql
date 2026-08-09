-- CHỐT CHẶN trước khi xoá. Migration 0013 chép `users.roles` sang `user_roles`, nhưng giữa lúc
-- 0013 chạy và lúc bản code mới lên có một khe hẹp: bản cũ đổi vai trong khoảng ấy chỉ ghi cột
-- gương. Ai rơi vào khe đó thì cột gương là bản DUY NHẤT còn giữ vai của họ — và câu DROP dưới
-- đây sẽ lặng lẽ tước sạch quyền của họ, không một dòng nhật ký nào.
--
-- Nên: đếm trước, và NGÃ NGỰA nếu còn ai. Cách gỡ là chạy lại câu backfill cuối của 0013 (nó
-- `on conflict do nothing`, chạy mấy lần cũng vậy) rồi migrate lại.
DO $$
DECLARE straggler_count integer;
BEGIN
  SELECT count(*) INTO straggler_count
    FROM "users" u
   WHERE cardinality(u."roles") > 0
     AND NOT EXISTS (SELECT 1 FROM "user_roles" ur WHERE ur."user_id" = u."id");

  IF straggler_count > 0 THEN
    RAISE EXCEPTION
      'Còn % đạo hữu mang vai trong cột gương users.roles mà chưa có dòng nào trong user_roles. '
      'Chạy lại câu backfill cuối của 0013_roles_and_permissions.sql rồi migrate lại — '
      'xoá cột ngay bây giờ là tước sạch quyền của họ.', straggler_count;
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "role";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "roles";--> statement-breakpoint
DROP TYPE "public"."user_role";