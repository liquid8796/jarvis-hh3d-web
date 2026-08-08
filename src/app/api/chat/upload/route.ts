import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth/guards";
import { mediaStoreReady, putChatFile } from "@/lib/services/media";

/**
 * Nhận file đàm đạo lên tàng khố media. Database chỉ giữ URL — bytes sống ở kho riêng cho
 * media, nơi sinh ra để phục vụ tải xuống công khai và không làm bảng tin nhắn phình.
 *
 * Kho là OCI Object Storage (trước 08/08/2026 là Vercel Blob); mọi chuyện đặt tên, ký
 * request và dựng URL nằm trong `services/media.ts` — route này chỉ gác cửa và đếm byte.
 * Khi kho chưa khai mở, endpoint từ chối bằng lời giải thích thay vì một stacktrace: chat
 * chữ vẫn chạy đầy đủ, chỉ phần đính kèm chờ kho mở cửa.
 */
export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_BYTES = 8 * 1024 * 1024;

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user || user.status !== "active") {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  if (!mediaStoreReady()) {
    return NextResponse.json(
      { error: "Tàng khố media chưa mở — tông chủ cần tạo kho OCI Object Storage trước." },
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

  const contentType = file.type || "application/octet-stream";
  // Đọc hết vào bộ nhớ là an toàn vì trần 8MB đã chặn ở trên (`file.size` là số byte runtime
  // ĐẾM ĐƯỢC khi bóc multipart, không phải con số client tự khai), và `ContentLength` tường
  // minh giúp SDK khỏi chuyển sang chunked encoding — thứ mà OCI không nhận.
  const body = new Uint8Array(await file.arrayBuffer());

  const stored = await putChatFile({
    userId: user.id,
    fileName: file.name || "tep",
    contentType,
    body,
  });

  return NextResponse.json({
    url: stored.url,
    name: file.name || "tep",
    size: body.byteLength,
    type: contentType,
  });
}
