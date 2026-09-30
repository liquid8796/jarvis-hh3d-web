import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth/guards";
import { countUnread, listDirectConversations } from "@/lib/services/chat";
import {
  heartbeatPresence,
  listCommunicationMembers,
  setPresenceStatus,
} from "@/lib/services/users";
import { presenceStatusSchema } from "@/lib/validation/presence";

async function activeUser() {
  const user = await currentUser();
  return user?.status === "active" ? user : null;
}

/**
 * Ảnh chụp nhẹ cho cụm giao tiếp nổi. GET đồng thời điểm danh tab đang mở; endpoint không
 * nhận userId từ client nên không thể giả online hay đổi trạng thái hộ người khác.
 */
export async function GET() {
  const user = await activeUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  await heartbeatPresence(user.id);
  const [rawMembers, direct, room] = await Promise.all([
    listCommunicationMembers(),
    listDirectConversations(user.id),
    countUnread(user.id),
  ]);
  const members = rawMembers.map((member) => ({
    id: member.id,
    username: member.username,
    displayName: member.displayName,
    avatarUrl: member.avatarUrl,
    isAdmin: member.isAdmin,
    presence: member.presence,
    selectedPresence: member.presenceMode,
  }));
  const memberById = new Map(members.map((member) => [member.id, member]));
  const threads = direct.storeClosed
    ? []
    : direct.conversations.flatMap((conversation) => {
        const peer = memberById.get(conversation.peerId);
        return peer
          ? [{
              peerId: conversation.peerId,
              latest: conversation.latest,
              unread: conversation.unread,
            }]
          : [];
      });

  return NextResponse.json({
    me: {
      id: user.id,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      selectedPresence: user.presenceStatus,
    },
    members,
    threads,
    unread: {
      direct: direct.storeClosed ? 0 : direct.unread,
      room: room.storeClosed ? 0 : room.unread,
    },
    storeClosed: direct.storeClosed || room.storeClosed,
  });
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
  const status = presenceStatusSchema.safeParse(
    typeof raw === "object" && raw !== null && "status" in raw ? raw.status : undefined,
  );
  if (!status.success) return NextResponse.json({ error: "bad status" }, { status: 400 });
  await setPresenceStatus(user.id, status.data);
  return NextResponse.json({ ok: true, status: status.data });
}