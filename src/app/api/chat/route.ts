import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth/guards";
import { isAdminUser } from "@/lib/auth/permissions";
import { avatarsByUserId } from "@/lib/services/users";
import {
  STORE_CLOSED_MESSAGE,
  deleteMessage,
  editMessage,
  getFeed,
  markTyping,
  sendMessage,
  toggleReaction,
} from "@/lib/services/chat";

/**
 * Một endpoint cho cả sảnh đàm đạo — GET là nhịp poll của client (tin mới + ai đang gõ),
 * POST là mọi thao tác, phân nhánh bằng `op` như /api/worker. Client poll mỗi ~2.5s: với
 * quy mô một tông môn, polling là realtime ĐỦ DÙNG và không đòi hạ tầng giữ kết nối —
 * function sống theo request là mô hình duy nhất đang có.
 *
 * Guard bằng session như mọi trang: sảnh chỉ dành cho môn đồ đã được thu nhận.
 */

async function requireActive() {
  const user = await currentUser();
  if (!user || user.status !== "active") return null;
  return user;
}

/**
 * Quét hạn lưu "tiện đường": cron mỗi ngày một lần là lưới chính, nhưng một sảnh có người
 * đọc thì tự sạch nhanh hơn thế — mỗi 10 phút, nhịp poll đầu tiên đi qua đây thả một lượt
 * quét chạy nền. Biến module-level là per-instance và mất khi function nguội: chấp nhận
 * được, vì quét trùng chỉ tốn một câu score-range rỗng.
 */
let lastPurgeAt = 0;
function purgeOpportunistically() {
  const now = Date.now();
  if (now - lastPurgeAt < 10 * 60 * 1000) return;
  lastPurgeAt = now;
  import("@/lib/services/chat").then(({ purgeExpiredChat }) => purgeExpiredChat()).catch(() => {});
}

export async function GET(request: Request) {
  const user = await requireActive();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  purgeOpportunistically();

  const url = new URL(request.url);
  const beforeAt = url.searchParams.get("beforeAt");
  const beforeId = url.searchParams.get("beforeId");

  const feed = await getFeed({
    viewerId: user.id,
    before: beforeAt && beforeId ? { at: beforeAt, id: beforeId } : undefined,
  });

  // Kho chưa tạo không phải lỗi hệ thống — 503 kèm lời người đọc hiểu, client vẽ màn
  // "chưa khai mở" thay vì một sảnh trống trơn nói dối.
  if (feed.storeClosed) {
    return NextResponse.json({ error: STORE_CLOSED_MESSAGE }, { status: 503 });
  }

  /**
   * Ảnh đại diện được ghép Ở ĐÂY, không phải trong `getFeed`.
   *
   * chat.ts là tầng của MongoDB và cố ý không biết gì về Postgres (xem ghi chú đầu tệp ấy:
   * "Postgres giữ danh tính, Mongo giữ đàm đạo"). Route là chỗ hai kho gặp nhau, nên phép
   * tra danh tính thuộc về nó — kéo services/users vào chat.ts là xoá đúng cái ranh giới đã
   * dựng có chủ ý.
   *
   * Trả về MỘT map theo người thay vì gắn URL vào từng tin: một trang 50 tin của năm người
   * thì đó là 5 mục thay vì 50 chuỗi lặp lại.
   *
   * Cái giá là một câu truy vấn Postgres nữa cho mỗi nhịp poll — cân nhắc rồi và nhận: nhịp
   * này đã đi qua `currentUser()`, tức đã có sẵn MỘT lượt hỏi Postgres; câu thứ hai tra theo
   * khoá chính của tối đa 50 id, và nó là cái giá để đổi ảnh không làm vỡ ảnh trong tin cũ.
   */
  const avatars = await avatarsByUserId(feed.messages.map((message) => message.userId));

  return NextResponse.json({ ...feed, avatars });
}

export async function POST(request: Request) {
  const user = await requireActive();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let payload: Record<string, unknown>;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  switch (payload.op) {
    case "send": {
      // isAdmin và tags đọc từ bản ghi THẬT của người đang hỏi rồi đóng băng vào tin —
      // không có trường nào trong body được quyền tự nhận.
      const result = await sendMessage(
        { id: user.id, name: user.displayName, isAdmin: isAdminUser(user), tags: user.tags },
        payload.body,
      );
      return NextResponse.json(result, { status: result.ok ? 200 : 400 });
    }

    case "edit": {
      const result = await editMessage(user.id, String(payload.id ?? ""), String(payload.text ?? ""));
      return NextResponse.json(result, { status: result.ok ? 200 : 400 });
    }

    case "delete": {
      const result = await deleteMessage({ id: user.id }, String(payload.id ?? ""));
      return NextResponse.json(result, { status: result.ok ? 200 : 400 });
    }

    case "react": {
      const result = await toggleReaction(user.id, String(payload.id ?? ""), String(payload.emoji ?? ""));
      return NextResponse.json(result, { status: result.ok ? 200 : 400 });
    }

    case "typing": {
      await markTyping({ id: user.id, name: user.displayName }, payload.typing === true);
      return NextResponse.json({ ok: true });
    }

    default:
      return NextResponse.json({ error: "unknown op" }, { status: 400 });
  }
}
