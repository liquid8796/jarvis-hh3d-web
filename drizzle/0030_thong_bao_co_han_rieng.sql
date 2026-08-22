-- THỜI HẠN TỒN TẠI RIÊNG CHO TỪNG THÔNG BÁO — thay cái cửa sổ bảy ngày cứng của mã.
--
-- Trước bản này, phép đọc hỏi `created_at > now() - interval '7 days'`: bảy ngày cho MỌI lời
-- nhắn, kể cả cái「tối nay 21h bế quan 15 phút」. Nay mỗi dòng tự mang mốc hết hạn của nó và cả
-- hai đường đọc (thành viên, khách) chỉ còn hỏi `expires_at > now()`.
--
-- BA CÂU, VÀ THỨ TỰ LÀ BẮT BUỘC. Thêm cột NOT NULL kèm `DEFAULT now() + interval '7 days'` chỉ
-- một câu thì gọn hơn — và nó DỰNG DẬY mọi thông báo đã chết: dòng phát từ tháng trước bỗng có
-- hạn tới bảy ngày TỚI, và cả tông môn ăn một chồng popup cũ ngay lần vào kế tiếp. Nên phải vá
-- theo `created_at` của chính từng dòng, rồi mới siết NOT NULL.
ALTER TABLE "notices" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
UPDATE "notices" SET "expires_at" = "created_at" + interval '7 days' WHERE "expires_at" IS NULL;--> statement-breakpoint
ALTER TABLE "notices" ALTER COLUMN "expires_at" SET NOT NULL;--> statement-breakpoint
-- Mặc định bảy ngày là LƯỚI CHO MỘT LƯỢT LÙI BẢN, không phải chỗ quyết định hạn: mã mới luôn ghi
-- hạn tường minh, nhưng `deploy:backend --rollback` dựng lại bản cũ, và bản cũ INSERT không có
-- cột này. Thiếu mặc định thì cú lùi bản biến「phát thông báo」thành lỗi NOT NULL — đúng lúc người
-- ta cần nó nhất. Bảy ngày cũng chính là hành vi của bản cũ ấy.
ALTER TABLE "notices" ALTER COLUMN "expires_at" SET DEFAULT now() + interval '7 days';--> statement-breakpoint
-- Cả hai đường đọc lọc theo cột này trước tiên.
CREATE INDEX "notices_expires_idx" ON "notices" USING btree ("expires_at");--> statement-breakpoint
-- Hàng rào cho MÃ: một lời nhắn chào đời đã hết hạn thì không đường đọc nào trả nó về, mà trong
-- bảng nó trông y hệt một lượt phát thành công.
ALTER TABLE "notices" ADD CONSTRAINT "notices_expires_after_created_check" CHECK ("notices"."expires_at" > "notices"."created_at");
