import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth/guards";
import { findById } from "@/lib/services/users";
import { chatStoreReady } from "@/lib/services/chat";
import { putDirectAttachment, readDirectUploadForm, DirectUploadTooLargeError } from "@/lib/services/directAttachments";
import { MAX_DIRECT_ATTACHMENT_BYTES } from "@/lib/validation/directAttachments";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user || user.status !== "active") return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!chatStoreReady()) return NextResponse.json({ error: "Kho tin nhắn chưa mở." }, { status: 503 });
  let form: FormData;
  try { form = await readDirectUploadForm(request); } catch (error) {
    return NextResponse.json({ error: error instanceof DirectUploadTooLargeError ? "File quá lớn." : "Dữ liệu file không hợp lệ." }, { status: error instanceof DirectUploadTooLargeError ? 413 : 400 });
  }
  const peerId = z.string().uuid().safeParse(form?.get("peer"));
  if (!peerId.success || peerId.data === user.id) return NextResponse.json({ error: "Thành viên không hợp lệ." }, { status: 400 });
  const peer = await findById(peerId.data);
  if (!peer || peer.status !== "active") return NextResponse.json({ error: "Không tìm thấy thành viên." }, { status: 404 });
  const file = form?.get("file");
  if (!(file instanceof File) || !file.name.trim() || file.name.trim().length > 200 ||
      /[\u0000-\u001f\u007f]/.test(file.name) || file.size === 0 || file.size > MAX_DIRECT_ATTACHMENT_BYTES) {
    return NextResponse.json({ error: "File phải có tên hợp lệ, lớn hơn 0 và không quá 8MB." }, { status: 400 });
  }
  const stored = await putDirectAttachment(user.id, peer.id, file.name, new Uint8Array(await file.arrayBuffer()));
  return NextResponse.json(stored, { headers: { "Cache-Control": "no-store" } });
}
