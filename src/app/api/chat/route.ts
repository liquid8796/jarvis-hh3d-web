import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth/guards";
import {
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

export async function GET(request: Request) {
  const user = await requireActive();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const cursor = (name: string) => {
    const at = url.searchParams.get(`${name}At`);
    const id = url.searchParams.get(`${name}Id`);
    return at && id ? { at, id } : undefined;
  };

  const feed = await getFeed({
    viewerId: user.id,
    after: cursor("after"),
    before: cursor("before"),
  });

  return NextResponse.json(feed);
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
      const result = await sendMessage(user.id, payload.body);
      return NextResponse.json(result, { status: result.ok ? 200 : 400 });
    }

    case "edit": {
      const result = await editMessage(user.id, String(payload.id ?? ""), String(payload.text ?? ""));
      return NextResponse.json(result, { status: result.ok ? 200 : 400 });
    }

    case "delete": {
      const result = await deleteMessage(user, String(payload.id ?? ""));
      return NextResponse.json(result, { status: result.ok ? 200 : 400 });
    }

    case "react": {
      const result = await toggleReaction(user.id, String(payload.id ?? ""), String(payload.emoji ?? ""));
      return NextResponse.json(result, { status: result.ok ? 200 : 400 });
    }

    case "typing": {
      await markTyping(user.id, payload.typing === true);
      return NextResponse.json({ ok: true });
    }

    default:
      return NextResponse.json({ error: "unknown op" }, { status: 400 });
  }
}
