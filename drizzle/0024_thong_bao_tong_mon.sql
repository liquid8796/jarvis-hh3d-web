-- THÔNG BÁO TÔNG MÔN: lời nhắn bậc trị sự phát ra, hiện thành popup trên mọi trang.
--
-- Phạm vi giữ ở dạng KHAI BÁO (`audience_kind` + danh sách mã trong `audience`), không nở sẵn
-- ra từng dòng người-nhận: một lời nhắn cho cả tông môn là MỘT dòng chứ không phải hai mươi
-- sáu, và câu hỏi「ai nhận」được trả lời lúc ĐỌC nên nó luôn nói theo thang vai HIỆN TẠI —
-- ban thêm một Chưởng môn sáng nay thì thông báo「gửi Chưởng môn」tối qua vẫn tới tay họ.
--
-- `notice_reads` là dấu ĐÃ XEM. Có dòng = đã bấm「Đã hiểu」; không có dòng = chưa. Nhờ vậy phép
-- đọc「còn gì chưa xem」là một `not exists`, đúng cả với người vừa nhập môn hôm nay.
--
-- CHECK trên `audience_kind` là hàng rào cho MÃ (form và server action đã là hàng rào cho người
-- dùng): một đường ghi mới quên validate thì database từ chối, thay vì để một giá trị lạ nằm im
-- trong bảng cho tới ngày phép đọc gặp nó và không biết trả về gì.

CREATE TABLE "notice_reads" (
	"notice_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notice_reads_notice_id_user_id_pk" PRIMARY KEY("notice_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "notices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"body" text NOT NULL,
	"audience_kind" text NOT NULL,
	"audience" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sent_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notices_audience_kind_check" CHECK ("notices"."audience_kind" in ('all', 'roles', 'users'))
);
--> statement-breakpoint
ALTER TABLE "notice_reads" ADD CONSTRAINT "notice_reads_notice_id_notices_id_fk" FOREIGN KEY ("notice_id") REFERENCES "public"."notices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notice_reads" ADD CONSTRAINT "notice_reads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notices" ADD CONSTRAINT "notices_sent_by_users_id_fk" FOREIGN KEY ("sent_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notices_created_idx" ON "notices" USING btree ("created_at");