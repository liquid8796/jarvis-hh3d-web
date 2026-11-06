import { Binary, MongoClient, type Db } from "mongodb";
import { resolveMongoDbName } from "@/lib/mongo/dbName";
import { directAttachmentSchema, MAX_DIRECT_ATTACHMENT_BYTES, isSafeDirectAttachmentUrl, type DirectAttachment } from "@/lib/validation/directAttachments";
import { sniffImageKind } from "./media";

type FileDoc = {
  _id: string; senderId: string; recipientId: string;
  name: string; type: string; size: number; bytes: Binary; createdAt: number; lastUsedAt: number;
};
type Opened = { client: MongoClient; db: Db };
const globalStore = globalThis as unknown as { __jarvisDirectFileStore?: Promise<Opened> };
async function store(): Promise<Opened> {
  const uri = process.env.MONGODB_URI?.trim() || process.env.MONGODB_URL?.trim();
  if (!uri) throw new Error("Kho tin nhắn chưa mở.");
  if (!globalStore.__jarvisDirectFileStore) {
    globalStore.__jarvisDirectFileStore = (async () => {
      const client = new MongoClient(uri);
      try {
        await client.connect();
        const db = client.db(resolveMongoDbName(uri, process.env.MONGODB_DB));
        await db.collection<FileDoc>("direct_attachments").createIndex({ lastUsedAt: 1 });
        return { client, db };
      } catch (error) { await client.close(); throw error; }
    })().catch((error) => { globalStore.__jarvisDirectFileStore = undefined; throw error; });
  }
  return globalStore.__jarvisDirectFileStore;
}
export async function closeDirectAttachmentStore(): Promise<void> {
  const opened = globalStore.__jarvisDirectFileStore;
  globalStore.__jarvisDirectFileStore = undefined;
  if (opened) await opened.then(({ client }) => client.close()).catch(() => {});
}
function view(doc: FileDoc): DirectAttachment {
  return { url: `/api/direct-messages/files/${doc._id}`, name: doc.name, type: doc.type, size: doc.size };
}
export async function putDirectAttachment(senderId: string, recipientId: string, name: string, bytes: Uint8Array): Promise<DirectAttachment> {
  const cleanName = name.trim();
  if (!senderId || !recipientId || senderId === recipientId || !cleanName || cleanName.length > 200 ||
      /[\u0000-\u001f\u007f]/.test(cleanName) || bytes.byteLength === 0 || bytes.byteLength > MAX_DIRECT_ATTACHMENT_BYTES) {
    throw new Error("File phải có tên hợp lệ, lớn hơn 0 và không quá 8MB.");
  }
  const doc: FileDoc = {
    _id: crypto.randomUUID(), senderId, recipientId, name: cleanName,
    type: sniffImageKind(bytes)?.contentType ?? "application/octet-stream",
    size: bytes.byteLength, bytes: new Binary(bytes), createdAt: Date.now(), lastUsedAt: Date.now(),
  };
  await (await store()).db.collection<FileDoc>("direct_attachments").insertOne(doc);
  return view(doc);
}
/** Never trust client metadata or let another sender/thread reuse a private file. */
export async function canonicalizeDirectAttachments(senderId: string, recipientId: string, raw: unknown): Promise<DirectAttachment[] | null> {
  const parsed = directAttachmentSchema.array().max(6).safeParse(raw);
  if (!parsed.success) return null;
  if (!parsed.data.length) return [];
  const { db } = await store();
  const result: DirectAttachment[] = [];
  for (const ref of parsed.data) {
    const id = ref.url.slice(ref.url.lastIndexOf("/") + 1);
    const doc = await db.collection<FileDoc>("direct_attachments").findOne({ _id: id, senderId, recipientId }, { projection: { bytes: 0 } });
    if (!doc) return null;
    result.push(view(doc));
  }
  const touched = await db.collection<FileDoc>("direct_attachments").updateMany(
    { _id: { $in: result.map((ref) => ref.url.slice(ref.url.lastIndexOf("/") + 1)) }, senderId, recipientId },
    { $set: { lastUsedAt: Date.now() } },
  );
  if (touched.matchedCount !== new Set(result.map((ref) => ref.url)).size) return null;
  return result;
}
/** Uploader may preview a draft. Recipient needs an actual sent message referencing the file. */
export async function getDirectAttachment(viewerId: string, id: string): Promise<(DirectAttachment & { bytes: Uint8Array }) | null> {
  const url = `/api/direct-messages/files/${id}`;
  if (!viewerId || !isSafeDirectAttachmentUrl(url)) return null;
  const { db } = await store();
  const doc = await db.collection<FileDoc>("direct_attachments").findOne({
    _id: id, $or: [{ senderId: viewerId }, { recipientId: viewerId }],
  });
  if (!doc) return null;
  if (viewerId !== doc.senderId) {
    const sent = await db.collection("direct_messages").findOne({
      senderId: doc.senderId, recipientId: doc.recipientId, "attachments.url": url,
    }, { projection: { _id: 1 } });
    if (!sent) return null;
  }
  return { ...view(doc), bytes: new Uint8Array(doc.bytes.value()) };
}
/** Same retention cutoff as messages, including abandoned upload drafts. */
export async function purgeExpiredDirectAttachments(cutoff: number): Promise<number> {
  return (await (await store()).db.collection<FileDoc>("direct_attachments").deleteMany({ lastUsedAt: { $lt: cutoff } })).deletedCount;
}

export class DirectUploadTooLargeError extends Error {}
/** Bound the raw multipart stream before formData allocates its complete file buffers. */
export async function readDirectUploadForm(request: Request): Promise<FormData> {
  const maxBody = MAX_DIRECT_ATTACHMENT_BYTES + 64 * 1024;
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxBody) throw new DirectUploadTooLargeError("File quá lớn.");
  if (!request.body) throw new Error("Thiếu file.");
  const reader = request.body.getReader();
  const chunks: ArrayBuffer[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBody) {
        await reader.cancel().catch(() => {});
        throw new DirectUploadTooLargeError("File quá lớn.");
      }
      chunks.push(new Uint8Array(value).buffer);
    }
  } finally { reader.releaseLock(); }
  return new Response(new Blob(chunks), { headers: { "Content-Type": request.headers.get("content-type") ?? "" } }).formData();
}
