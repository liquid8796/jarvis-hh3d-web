-- Đổi định danh khôi lỗi tông môn: `tong-mon-linhsu` → `tong-mon-khoiloi`.
--
-- VÌ SAO ĐÂY LÀ CHUYỆN CỦA DATABASE chứ không phải một nhãn hiển thị: trang Hàng Đợi vẽ THẲNG
-- `worker_id` của đàn đã có khôi lỗi nhận (xem QueueBoard — chỉ đàn CHƯA ai nhận mới ra nhãn
-- đẹp「khôi lỗi tông môn」). Nên cái tên hiện trên màn hình chính là dữ liệu.
--
-- Nguồn sự thật là `WORKER_ID` trong /opt/auto-hh3d/linh-su/.env trên VM, và nó phải đổi TRƯỚC:
-- đổi database trước thì nhịp tim kế tiếp lập tức dựng lại dòng cũ (bảng `workers` là upsert
-- theo id).
--
-- CÁI GIÁ của thứ tự ấy, và là lý do migration này KHÔNG phải một câu `UPDATE workers SET id`:
-- khôi lỗi khởi động lại và tự đăng ký tên mới chỉ trong vài giây, nên tới lúc migration chạy
-- thì `tong-mon-khoiloi` ĐÃ tồn tại — đổi tên dòng cũ sang nó là đụng khoá chính. (Đã xảy ra
-- thật ở lần chạy đầu.) Nên: đổi tên nếu chỗ mới còn trống, gộp rồi xoá nếu đã có người.
--
-- Không có khoá ngoại nào trỏ tới `workers.id` (đã soát). Chỉ đụng đúng một định danh — khôi
-- lỗi máy nhà (`desktop-…`, `lt-…`) và đàn chưa ai nhận (`worker_id IS NULL`) không bị chạm.
--
-- Idempotent: chạy lại là ba phép rỗng.

-- 1. Chỗ mới còn trống thì đổi tên thẳng — giữ nguyên `first_seen`, tức giữ được lịch sử.
UPDATE "workers" SET "id" = 'tong-mon-khoiloi'
 WHERE "id" = 'tong-mon-linhsu'
   AND NOT EXISTS (SELECT 1 FROM "workers" w WHERE w."id" = 'tong-mon-khoiloi');--> statement-breakpoint

-- 2. Chỗ mới đã có người (khôi lỗi kịp đăng ký lại): kéo `first_seen` sớm hơn về dòng mới rồi
--    mới bỏ dòng cũ — không thì tông môn mất ngày đầu tiên khôi lỗi lên ca.
UPDATE "workers" w SET "first_seen" = LEAST(w."first_seen", old."first_seen")
  FROM "workers" old
 WHERE w."id" = 'tong-mon-khoiloi' AND old."id" = 'tong-mon-linhsu';--> statement-breakpoint

DELETE FROM "workers" WHERE "id" = 'tong-mon-linhsu';--> statement-breakpoint

-- 3. Đàn cũ mang tên cũ. Sửa để lịch sử đọc liền một mạch, thay vì hiện ra như hai khôi lỗi
--    khác nhau từng thay phiên canh cùng một tông môn.
UPDATE "automation_jobs" SET "worker_id" = 'tong-mon-khoiloi' WHERE "worker_id" = 'tong-mon-linhsu';
