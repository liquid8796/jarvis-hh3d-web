-- THÔNG BÁO CHO KHÁCH CHƯA ĐĂNG NHẬP — nới ràng buộc `audience_kind` thêm một giá trị.
--
-- Ràng buộc này là hàng rào cho MÃ, không phải cho người dùng (form và server action đã gác hai
-- lớp trên) — nên nới nó là việc phải làm tường minh, không phải một chi tiết đi kèm. Thiếu câu
-- dưới thì lượt phát đầu tiên cho khách chết ngay tại database với `violates check constraint`,
-- sau khi form đã báo hợp lệ và action đã cho qua.
--
-- KHÔNG có gì phải vá cho dữ liệu cũ: câu này chỉ NỚI tập giá trị hợp lệ, nên mọi dòng đang có
-- (`all`/`roles`/`users`) vẫn thoả. Postgres vẫn quét lại cả bảng để xác nhận điều đó — với cỡ
-- bảng thông báo (hết hạn sau 7 ngày) thì đó là một phép quét không đáng kể.
--
-- VÌ SAO `guests` KHÔNG LÀM RÒ THÔNG BÁO SANG THÀNH VIÊN: `unseenNotices` — câu truy vấn của
-- người đã đăng nhập — liệt kê tường minh ba kiểu `all`/`users`/`roles` trong mệnh đề phạm vi.
-- Đó là danh sách TRẮNG, nên một kiểu mới không tự lọt vào; và ngược lại, `guestNotices` chỉ hỏi
-- đúng `audience_kind = 'guests'`. Hai đường đọc, hai tập rời nhau, không nhánh nào phải nhớ trừ
-- đi cái của bên kia.
ALTER TABLE "notices" DROP CONSTRAINT "notices_audience_kind_check";--> statement-breakpoint
ALTER TABLE "notices" ADD CONSTRAINT "notices_audience_kind_check" CHECK ("notices"."audience_kind" in ('all', 'roles', 'users', 'guests'));
