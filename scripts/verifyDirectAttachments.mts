#!/usr/bin/env node
// Runs only against a fresh local mongod. Never loads production environment files.
import assert from "node:assert/strict";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient } from "mongodb";

const mongod = await MongoMemoryServer.create();
process.env.MONGODB_URI = mongod.getUri();
process.env.MONGODB_DB = "direct_attachment_verification";
const chat = await import("../src/lib/services/chat.ts");
const files = await import("../src/lib/services/directAttachments.ts");
const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const col = client.db(process.env.MONGODB_DB).collection("direct_messages");
const alice = { id: "alice", name: "Alice" };
const externalFile = { url: "https://files.example.test/report.pdf", name: "report.pdf", size: 123, type: "application/pdf" };

try {
  assert.equal((await chat.sendDirectMessage(alice, "bob", "external", [externalFile])).ok, false, "private messages must reject public attachment URLs");
  const file = await files.putDirectAttachment(alice.id, "bob", "report.pdf", new Uint8Array([1, 2, 3]));
  assert.equal(await files.getDirectAttachment("bob", file.url.split("/").at(-1)!), null, "recipient cannot download an unsent draft");
  assert.equal(await files.getDirectAttachment("eve", file.url.split("/").at(-1)!), null);
  assert.deepEqual((await files.getDirectAttachment("alice", file.url.split("/").at(-1)!))?.bytes, new Uint8Array([1, 2, 3]));
  for (const [name, bytes] of [
    ["", new Uint8Array([1])], ["x".repeat(201), new Uint8Array([1])],
    ["bad" + String.fromCharCode(10) + "name", new Uint8Array([1])], ["empty", new Uint8Array()],
    ["oversize", new Uint8Array(8 * 1024 * 1024 + 1)],
  ] as const) await assert.rejects(() => files.putDirectAttachment("alice", "bob", name, bytes));
  const imageBytes = new Uint8Array(16);
  imageBytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
  const image = await files.putDirectAttachment("alice", "bob", "image.png", imageBytes);
  assert.equal(image.type, "image/png");
  assert.equal(file.type, "application/octet-stream");
  assert.equal((await chat.sendDirectMessage(alice, "carol", "", [file])).ok, false);
  assert.equal((await chat.sendDirectMessage({ id: "bob", name: "Bob" }, "alice", "", [file])).ok, false);
  // Removing attachment persistence or rejecting empty text must break this roundtrip.
  assert.equal((await chat.sendDirectMessage(alice, "bob", "", [file])).ok, true, "attachment-only sends must succeed");
  const received = await chat.getDirectMessages("bob", "alice");
  assert.ok(!received.storeClosed);
  assert.equal(received.messages.length, 1);
  assert.equal(received.messages[0].text, "");
  assert.deepEqual(received.messages[0].attachments, [file]);
  assert.deepEqual((await files.getDirectAttachment("bob", file.url.split("/").at(-1)!))?.bytes, new Uint8Array([1, 2, 3]));
  assert.equal(await files.getDirectAttachment("eve", file.url.split("/").at(-1)!), null);
  const preview = await chat.listDirectConversations("bob");
  assert.ok(!preview.storeClosed);
  assert.deepEqual(preview.conversations[0].latest.attachments, [file]);
  assert.equal(preview.unread, 1);
  console.log("PASS attachment-only persistence, reads and conversation preview");

  assert.equal((await chat.sendDirectMessage(alice, "bob", "  hello  ")).ok, true);
  await col.insertOne({
    _id: "legacy", threadKey: "alice:bob", senderId: "bob", recipientId: "alice",
    senderName: "Bob", text: "old message", createdAt: 1, readAt: null,
  } as never);
  const legacy = await chat.getDirectMessages("alice", "bob");
  assert.ok(!legacy.storeClosed);
  assert.deepEqual(legacy.messages.find((m) => m.id === "legacy")?.attachments, []);
  assert.equal(legacy.messages.find((m) => m.text === "hello")?.attachments.length, 0);
  console.log("PASS legacy documents and old three-argument sends");

  const invalid: unknown[] = [
    [{ ...file, url: "http://files.example.test/file" }],
    [{ ...file, url: "javascript:alert(1)" }],
    [{ ...file, url: "data:text/html,test" }],
    Array(7).fill(file),
    [{ ...file, name: "" }],
    [{ ...file, name: "x".repeat(201) }],
    [{ ...file, size: -1 }],
    [{ ...file, url: "/api/direct-messages/files/00000000-0000-4000-8000-000000000000" }],
    [{ ...file, url: file.url + "?download=true" }],
    [{ ...file, url: "//example.com" + file.url }],
    [{ ...file, size: 1.5 }],
    [{ ...file, size: 64 * 1024 * 1024 + 1 }],
    [{ ...file, type: "x".repeat(121) }],
    [{ url: file.url }],
    "not an array", null,
  ];
  const before = await col.countDocuments();
  for (const attachments of invalid) {
    assert.equal((await chat.sendDirectMessage(alice, "bob", "valid text", attachments)).ok, false, JSON.stringify(attachments));
  }
  assert.equal((await chat.sendDirectMessage(alice, "bob", "   ", [])).ok, false);
  assert.equal((await chat.sendDirectMessage(alice, "bob", "x".repeat(4001), [file])).ok, false);
  assert.equal((await chat.sendDirectMessage(alice, "alice", "", [file])).ok, false);
  assert.equal(await col.countDocuments(), before, "invalid payloads must not write");
  assert.equal((await chat.sendDirectMessage(alice, "bob", "six files", Array(6).fill({ ...file, name: "spoofed", type: "text/html", size: 9 }))).ok, true);
  console.log("PASS HTTPS, count, metadata and empty-message validation");

  const privateFile = await files.putDirectAttachment("alice", "carol", "private.pdf", new Uint8Array([4]));
  assert.equal((await chat.sendDirectMessage(alice, "carol", "", [privateFile])).ok, true);
  const canonical = await chat.getDirectMessages("bob", "alice");
  assert.ok(!canonical.storeClosed);
  assert.deepEqual(canonical.messages.find((m) => m.text === "six files")?.attachments, Array(6).fill(file));
  const outsider = await chat.getDirectMessages("carol", "bob");
  assert.ok(!outsider.storeClosed);
  assert.deepEqual(outsider.messages, []);
  const bob = await chat.listDirectConversations("bob");
  assert.ok(!bob.storeClosed);
  assert.deepEqual(bob.conversations.map((c) => c.peerId), ["alice"]);
  assert.equal(bob.conversations.some((c) => c.latest.attachments.some((a) => a.name === "private.pdf")), false);
  assert.equal(await chat.markDirectMessagesRead("carol", "bob"), 0);
  assert.equal(await chat.markDirectMessagesRead("bob", "alice"), 3);
  const carol = await chat.listDirectConversations("carol");
  assert.ok(!carol.storeClosed);
  assert.equal(carol.unread, 1, "reading another thread must not affect Carol");
  console.log("PASS cross-thread content, download authorization and read-state isolation");
  await client.db(process.env.MONGODB_DB).collection("direct_attachments").updateOne({ name: "image.png" }, { $set: { createdAt: 1, lastUsedAt: 1 } });
  assert.equal(await files.purgeExpiredDirectAttachments(2), 1);
  assert.equal(await files.getDirectAttachment("alice", image.url.split("/").at(-1)!), null);
  assert.ok(await files.getDirectAttachment("bob", file.url.split("/").at(-1)!));
  // A draft uploaded long ago must survive if it is sent/reused recently.
  const delayed = await files.putDirectAttachment("alice", "bob", "delayed.bin", new Uint8Array([5]));
  await client.db(process.env.MONGODB_DB).collection("direct_attachments").updateOne({ name: "delayed.bin" }, { $set: { createdAt: 1, lastUsedAt: 1 } });
  assert.equal((await chat.sendDirectMessage(alice, "bob", "", [delayed])).ok, true);
  await files.purgeExpiredDirectAttachments(Date.now() - 1000);
  assert.ok(await files.getDirectAttachment("bob", delayed.url.split("/").at(-1)!), "recently sent/reused old uploads must survive retention");
  const form = new FormData();
  form.set("peer", "bob");
  form.set("file", new File(["abc"], "test.txt"));
  const bounded = await files.readDirectUploadForm(new Request("https://example.test/upload", { method: "POST", body: form }));
  assert.equal((bounded.get("file") as File).size, 3);
  await assert.rejects(() => files.readDirectUploadForm(new Request("https://example.test/upload", { method: "POST", headers: { "content-length": String(9 * 1024 * 1024) }, body: "x" })), files.DirectUploadTooLargeError);
  await assert.rejects(() => files.readDirectUploadForm(new Request("https://example.test/upload", { method: "POST", body: new Uint8Array(8 * 1024 * 1024 + 65537) })), files.DirectUploadTooLargeError);
  console.log("PASS upload limits, byte-sniffing, canonical metadata, multipart bounds and reuse retention");
} finally {
  await chat.closeChatStore();
  await files.closeDirectAttachmentStore();
  await client.close();
  await mongod.stop();
}
