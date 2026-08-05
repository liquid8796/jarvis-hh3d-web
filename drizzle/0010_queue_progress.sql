-- Hàng Đợi Công Việc phải nói được đàn kia ĐANG LÀM NHIỆM VỤ GÌ, không chỉ "đang chạy".
--
-- Cho tới nay điều đó không tồn tại ở đâu dưới dạng dữ liệu: tiến trình một vòng chỉ sống
-- trong văn xuôi của job_events ("Mê Cung: xong", "Sẽ hành sự: A · B · C"). Dựng giao diện
-- bằng cách dò chuỗi trong nhật ký của chính mình là buộc một cột trên màn hình vào cách
-- hành văn của một dòng log — mà chính bản 0.25.2 vừa viết lại đúng mấy dòng ấy. Nên linh
-- sứ khai thẳng, và chỗ khai nằm ở đây.
--
-- Phần ALTER do drizzle-kit sinh từ schema.ts (snapshot 0010 đi kèm); phần trigger viết tay.
ALTER TABLE "automation_jobs" ADD COLUMN "cycle_progress" jsonb;--> statement-breakpoint

-- Chuông cửa cho cột mới — và mệnh đề WHEN mới là toàn bộ giá trị của đoạn này.
--
-- Tiến độ đi kèm NHỊP TIM, tức mỗi 5 giây một lần cho mỗi đàn đang chạy. Trigger
-- `AFTER UPDATE OF <cột>` của Postgres nổ khi cột được NHẮC TỚI trong mệnh đề SET, chứ không
-- phải khi giá trị thật sự đổi — nên thiếu WHEN thì mỗi nhịp tim của mỗi đàn phát một
-- NOTIFY, và MỌI trang Hàng Đợi đang mở sẽ đọc lại database để vẽ ra đúng cái vừa vẽ. Đó
-- chính là sự lãng phí mà route stream đã cố ý né khi nó bỏ qua topic 'event'.
--
-- `IS DISTINCT FROM` chứ không `<>`: NULL (chưa biết, hoặc vừa dọn) là giá trị hợp lệ ở cả
-- hai vế, mà `<>` gặp NULL trả về NULL — trigger sẽ im lặng đúng vào lúc một vòng bắt đầu và
-- lúc nó kết thúc, hai khoảnh khắc hàng đợi cần vẽ lại nhất. So sánh trên jsonb là so theo
-- GIÁ TRỊ đã chuẩn hoá (jsonb tự sắp lại khoá), nên gửi lại y nguyên tiến độ cũ không đánh
-- thức ai, dù JSON gốc có thứ tự khoá khác.
CREATE TRIGGER "jarvis_dashboard_job_progress"
AFTER UPDATE OF "cycle_progress" ON "automation_jobs"
FOR EACH ROW
WHEN (OLD."cycle_progress" IS DISTINCT FROM NEW."cycle_progress")
EXECUTE FUNCTION "jarvis_notify_job_change"();
