-- BẢN CỦA GÓI KHÔI LỖI mà mỗi tiến trình đang chạy, do chính nó khai lúc gõ cửa.
--
-- Nullable, và null MANG NGHĨA: khôi lỗi đời cũ không biết khai gì, nên vắng số bản chính là
-- dấu「máy này chạy bản cũ, cài lại đi」. Mọi khôi lỗi đang chạy lúc migration này áp xuống vì
-- thế hiện ra là「không rõ bản」— đúng sự thật, vì chúng đúng là chưa biết khai.
--
-- Sinh ra sau lượt chuyển trạm 10/08/2026: một khôi lỗi máy nhà chạy mã cũ trông y hệt một
-- khôi lỗi mới trên dashboard, và ngày chuyển trạm nó lặng lẽ không đi theo được.
ALTER TABLE "workers" ADD COLUMN "version" text;
