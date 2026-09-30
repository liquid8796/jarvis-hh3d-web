import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { effectivePresence, PRESENCE_FRESH_MS } from "../src/lib/validation/presence";

const root = process.cwd();
const read = (relative: string) => readFile(path.join(root, relative), "utf8");
const [
  dock,
  room,
  direct,
  members,
  common,
  styles,
  layout,
  chatFab,
  profilePage,
  passwordForm,
  profileAction,
  userService,
  chatService,
  communicationRoute,
  directRoute,
  schema,
  migration,
  journalRaw,
  globalStyles,
] = await Promise.all([
  read("src/components/communication/CommunicationDock.tsx"),
  read("src/components/communication/RoomPanel.tsx"),
  read("src/components/communication/DirectPanel.tsx"),
  read("src/components/communication/MembersPanel.tsx"),
  read("src/components/communication/Common.tsx"),
  read("src/app/communication.css"),
  read("src/app/layout.tsx"),
  read("src/components/ChatFab.tsx"),
  read("src/app/profile/page.tsx"),
  read("src/app/profile/PasswordForm.tsx"),
  read("src/app/actions/profile.ts"),
  read("src/lib/services/users.ts"),
  read("src/lib/services/chat.ts"),
  read("src/app/api/communication/route.ts"),
  read("src/app/api/direct-messages/route.ts"),
  read("src/lib/db/schema.ts"),
  read("drizzle/0033_user_presence.sql"),
  read("drizzle/meta/_journal.json"),
  read("src/app/globals.css"),
]);

for (const label of ["Trò chuyện", "Phòng chat", "Thành viên"]) {
  assert.match(dock, new RegExp(label), `dock phải có tab ${label}`);
}
assert.match(dock, /CommunicationDock/);
assert.match(chatFab, /CommunicationDock as ChatFab/);
assert.match(layout, /<ChatFab \/>/);
assert.match(layout, /\.\/communication\.css/);
assert.doesNotMatch(dock, /href=["']\/chat/, "tab Phòng chat không được điều hướng sang /chat");
assert.match(room, /fetch\("\/api\/chat"/);
assert.match(room, /Sảnh đàm đạo chung/);
assert.match(direct, /Tìm đạo hữu để trò chuyện/);
assert.match(direct, /DirectThread/);
assert.match(common, /Quản trị/);
assert.match(members, /online[\s\S]*busy[\s\S]*offline/);
assert.match(styles, /grid-template-columns:\s*repeat\(3/);
assert.match(styles, /@media \(max-width: 520px\)/);
assert.doesNotMatch(globalStyles, /\.chat-fab(?:-badge)?\b/, "CSS của icon chat đơn cũ phải được gỡ");

assert.match(profilePage, /<PasswordForm \/>/);
assert.match(passwordForm, /currentPassword/);
assert.match(passwordForm, /newPassword/);
assert.match(passwordForm, /confirmPassword/);
assert.match(profileAction, /updatePasswordAction/);
assert.match(profileAction, /currentPassword/);
assert.match(userService, /verifyPassword\(currentPassword, currentHash\)/);
assert.match(userService, /eq\(schema\.users\.passwordHash, currentHash\)/);

assert.match(communicationRoute, /currentUser\(\)/);
assert.match(communicationRoute, /heartbeatPresence/);
assert.match(communicationRoute, /presenceStatusSchema/);
assert.doesNotMatch(communicationRoute, /body\.userId|data\.userId/);
assert.match(communicationRoute, /latest:\s*conversation\.latest/);
assert.match(communicationRoute, /avatarUrl:\s*user\.avatarUrl/);
assert.doesNotMatch(communicationRoute, /lastText|lastAt|lastSenderId/);
assert.match(directRoute, /activePeer/);
assert.match(directRoute, /peerId === viewerId/);
assert.match(directRoute, /markDirectMessagesRead/);
assert.match(chatService, /direct_messages/);
assert.match(chatService, /recipientId:\s*viewerId/);
assert.match(chatService, /readAt:\s*null/);

assert.match(schema, /pgEnum\("presence_status", \["online", "busy", "offline"\]\)/);
assert.match(schema, /presenceSeenAt/);
assert.match(migration, /CREATE TYPE "public"\."presence_status"/);
assert.match(migration, /users_presence_idx/);
const journal = JSON.parse(journalRaw) as { entries: Array<{ idx: number; tag: string }> };
assert.deepEqual(journal.entries.at(-1), {
  ...journal.entries.at(-1),
  idx: 33,
  tag: "0033_user_presence",
});

const now = Date.now();
assert.equal(effectivePresence("offline", new Date(now), now), "offline");
assert.equal(effectivePresence("busy", new Date(now - 1000), now), "busy");
assert.equal(effectivePresence("online", new Date(now - PRESENCE_FRESH_MS - 1), now), "offline");
assert.equal(effectivePresence("online", null, now), "offline");

console.log("OK: password self-service, three-tab communication dock, direct chat and presence are wired.");
