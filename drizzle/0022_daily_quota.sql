-- SỔ ĐỦ LƯỢT HÔM NAY của từng đàn: `{ "day": "2026-08-11", "questIds": ["diem-danh", …] }`.
--
-- Nullable và không default: một đàn chưa từng khai gì là một đàn có sổ TRẮNG, và null nói
-- đúng điều đó mà không tốn một lượt ghi nào. Mọi đàn đang chạy lúc migration này áp xuống
-- vì thế bắt đầu lại từ「kiểm đủ ở vòng kế」— đúng hành vi của một lần Khai Đàn mới.
ALTER TABLE "automation_jobs" ADD COLUMN "daily_done" jsonb;
