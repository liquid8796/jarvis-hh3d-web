-- BỘ CÂN TẢI LUÂN PHIÊN cho cửa phát việc — hai cột trên sổ điểm danh, và một lượt dọn.
--
-- Luật cũ phát đàn cho khôi lỗi nào gõ cửa sớm nhất, không đếm nó đang cầm mấy đàn. Với bảy
-- khôi lỗi (13/08/2026: VM tông môn, GitHub, bốn khôi lỗi trọ, một máy nhà) thì đó là xếp việc
-- theo NHỊP HỎI chứ không theo SỨC CHỨA. Luật mới luân phiên theo `last_assigned_at`, và để
-- luân phiên được thì máy chủ phải biết trần ghế của từng tiến trình — `max_jobs`.
--
-- `last_assigned_at` nullable, và null MANG NGHĨA「chưa bao giờ được giao」— khôi lỗi vừa lên ca
-- đứng ĐẦU hàng luân phiên chứ không phải cuối. Mọi tiến trình đang chạy lúc migration này áp
-- xuống vì thế cùng xuất phát từ vạch số không, và lượt phát việc kế tiếp chia lại từ đầu.
--
-- `max_jobs` mặc định 2 = trần chuẩn của tông môn từ 14/08/2026, và cũng là con số áp cho khôi
-- lỗi đời cũ chưa biết tự khai. Đoán THIẾU chỉ mất một chút thông lượng; đoán THỪA thì máy chủ
-- phát việc vào một tiến trình không còn chỗ và đàn ấy nằm im tới khi van chống đói mở.
ALTER TABLE "workers" ADD COLUMN "last_assigned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "workers" ADD COLUMN "max_jobs" integer DEFAULT 2 NOT NULL;--> statement-breakpoint
-- ĐÀN ĐANG NGHỈ KHÔNG ĐƯỢC ĐEO TÊN KHÔI LỖI NÀO.
--
-- Trước bản này `worker_id` bám lại suốt cả quãng cooldown — bảng Hàng Đợi vì thế vẽ ra một sự
-- phân công không có thật (đo 13/08/2026: cả 12 dòng đang nghỉ đều đeo tên một khôi lỗi), và
-- người đọc kết luận rằng đàn ấy đã được đặt chỗ trước. Từ nay việc gán xảy ra ĐÚNG lúc đàn
-- thức dậy; câu này dọn nốt những cái tên cũ còn sót.
--
-- An toàn với đàn đang chạy: `status = 'queued'` theo định nghĩa là chưa khôi lỗi nào cầm, và
-- lượt claim đặt `status`+`worker_id` trong CÙNG một câu lệnh nên không có khe nào để câu này
-- xoá mất tên của một lượt vừa nhận việc.
UPDATE "automation_jobs" SET "worker_id" = NULL WHERE "status" = 'queued';
