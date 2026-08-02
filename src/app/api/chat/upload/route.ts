import { put } from "@vercel/blob";
import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth/guards";

/**
 * Nhận file đàm đạo lên blob store. Database chỉ giữ URL — bytes sống ở kho riêng cho
 * media, nơi sinh ra để phục vụ tải xuống công khai và không làm bảng tin nhắn phình.
 *
 * Cần BLOB_READ_WRITE_TOKEN (tạo kho Blob trong dashboard là biến này tự xuất hiện). Khi
 * chưa có, endpoint từ chối bằng lời giải thích thay vì một stacktrace — chat chữ vẫn chạy
 * đầy đủ, chỉ phần đính kèm chờ kho mở cửa.
 *
 * `addRandomSuffix` là bắt buộc về an toàn: tên file do người dùng đặt, hai người cùng
 * gửi "anh.jpg" mà không có hậu tố là người sau ghi đè ảnh người trước.
 */
export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_BYTES = 8 * 1024 * 1024;

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user || user.status !== "active") {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json(
      { error: "Tàng khố media chưa mở — tông chủ cần tạo kho Blob trên dashboard trước." },
      { status: 503 },
    );
  }

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Thiếu file." }, { status: 400 });
  }

  if (file.size === 0 || file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `File phải lớn hơn 0 và không quá ${MAX_BYTES / 1024 / 1024}MB.` },
      { status: 400 },
    );
  }

  const safeName = (file.name || "tep").replace(/[^\p{L}\p{N}._-]+/gu, "_").slice(0, 120);
  const blob = await put(`chat/${user.id}/${safeName}`, file, {
    access: "public",
    addRandomSuffix: true,
    contentType: file.type || "application/octet-stream",
  });

  return NextResponse.json({
    url: blob.url,
    name: file.name || safeName,
    size: file.size,
    type: file.type || "application/octet-stream",
  });
}
