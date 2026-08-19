-- DÍNH CHÂN ĐÀN VỚI KHÔI LỖI ĐÃ CHẠY NÓ — một cột, để một tài khoản thôi nhảy IP mỗi nửa giờ.
--
-- Đo 19/08/2026 trên sổ thật: tài khoản `fptshop` chạy 39 vòng trong 6 giờ trên MƯỜI khôi lỗi
-- khác nhau; `long01` 41 vòng cũng trên mười. Mỗi khôi lỗi là một IP khác (runner GitHub đổi IP
-- mỗi lượt chạy), nên với Cloudflare thì đó là MỘT phiên đăng nhập nhảy qua mười địa chỉ trong
-- một buổi sáng — và `cf_clearance` vốn gắn chặt với IP đã giải nó. Mỗi cú nhảy là một lần
-- trình diện từ một địa chỉ chưa từng qua cửa, tức một màn Turnstile mới.
--
-- `worker_id` KHÔNG dùng lại được cho việc này: nó cố ý bị xoá về null lúc đàn quay lại hàng chờ
-- (xem 0027) để bảng Hàng Đợi thôi vẽ ra một sự phân công không có thật. Nên cần một cột thứ hai
-- chỉ để NHỚ, không mang nghĩa "đang giữ".
--
-- Null = chưa từng chạy, và nó phải mang đúng nghĩa ấy: đàn mới sinh không được ưu ái khôi lỗi
-- nào cả, phép luân phiên chia như thường. Điền sẵn từ `worker_id` cho những đàn ĐANG chạy để
-- lượt sau chúng ở lại đúng chỗ; đàn đang nghỉ thì `worker_id` đã null nên không có gì để chép.
ALTER TABLE "automation_jobs" ADD COLUMN "last_worker_id" text;--> statement-breakpoint
UPDATE "automation_jobs" SET "last_worker_id" = "worker_id" WHERE "worker_id" IS NOT NULL;
