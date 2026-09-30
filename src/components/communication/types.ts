import type { PresenceStatus } from "@/lib/validation/presence";

export type DockTab = "direct" | "room" | "members";

export type Member = {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  isAdmin: boolean;
  presence: PresenceStatus;
  selectedPresence: PresenceStatus;
};

export type DirectMessage = {
  id: string;
  senderId: string;
  recipientId: string;
  senderName: string;
  text: string;
  createdAt: string;
  readAt: string | null;
};

export type DirectThread = {
  peerId: string;
  latest: DirectMessage;
  unread: number;
};

export type CommunicationSnapshot = {
  me: {
    id: string;
    displayName: string;
    avatarUrl: string | null;
    selectedPresence: PresenceStatus;
  };
  members: Member[];
  threads: DirectThread[];
  unread: {
    direct: number;
    room: number;
  };
  storeClosed: boolean;
};

export type RoomAttachment = {
  url: string;
  name: string;
  size: number;
  type: string;
};

export type RoomMessage = {
  id: string;
  userId: string;
  author: string;
  isAdmin: boolean;
  tags: string[];
  text: string;
  sticker: string | null;
  attachments: RoomAttachment[];
  replyTo: { id: string; author: string; excerpt: string } | null;
  createdAt: string;
  editedAt: string | null;
  deleted: boolean;
};

function fold(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("vi");
}

export function matchesMember(member: Member, query: string): boolean {
  const wanted = fold(query.trim());
  if (!wanted) return true;
  return fold(`${member.displayName} ${member.username} ${member.isAdmin ? "quản trị admin" : ""}`).includes(wanted);
}
