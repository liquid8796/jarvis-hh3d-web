import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth/guards";
import {
  STORE_CLOSED_MESSAGE,
  getDirectMessages,
  markDirectMessagesRead,
  sendDirectMessage,
} from "@/lib/services/chat";
import { findById } from "@/lib/services/users";

const peerSchema = z.string().uuid();
const operationSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("read"), peer: peerSchema }),
  z.object({
    op: z.literal("send"),
    peer: peerSchema,
    text: z.string().trim().min(1, "Tin nhắn không được để trống.").max(4000),
  }),
]);

async function activeUser() {
  const user = await currentUser();
  return user?.status === "active" ? user : null;
}

async function activePeer(peerId: string, viewerId: string) {
  if (peerId === viewerId) return null;
  const peer = await findById(peerId);
  return peer?.status === "active" ? peer : null;
}

/** Chỉ đọc đúng luồng giữa session hiện tại và một thành viên active. */
export async function GET(request: Request) {
  const user = await activeUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const parsed = peerSchema.safeParse(new URL(request.url).searchParams.get("peer"));
  if (!parsed.success) return NextResponse.json({ error: "bad peer" }, { status: 400 });
  const peer = await activePeer(parsed.data, user.id);
  if (!peer) return NextResponse.json({ error: "Không tìm thấy thành viên này." }, { status: 404 });

  const result = await getDirectMessages(user.id, peer.id);
  if (result.storeClosed) return NextResponse.json({ error: STORE_CLOSED_MESSAGE }, { status: 503 });
  const markedRead = await markDirectMessagesRead(user.id, peer.id);
  return NextResponse.json({ messages: result.messages, markedRead });
}

export async function POST(request: Request) {
  const user = await activeUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  const parsed = operationSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ." }, { status: 400 });
  }
  const peer = await activePeer(parsed.data.peer, user.id);
  if (!peer) return NextResponse.json({ error: "Không tìm thấy thành viên này." }, { status: 404 });

  if (parsed.data.op === "read") {
    await markDirectMessagesRead(user.id, peer.id);
    return NextResponse.json({ ok: true });
  }
  const sent = await sendDirectMessage(
    { id: user.id, name: user.displayName },
    peer.id,
    parsed.data.text,
  );
  return NextResponse.json(sent, { status: sent.ok ? 200 : 400 });
}
