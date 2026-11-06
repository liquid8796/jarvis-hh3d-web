import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth/guards";
import { getDirectAttachment } from "@/lib/services/directAttachments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
  if (!user || user.status !== "active") return NextResponse.json({ error: "unauthorized" }, { status: 401, headers });
  const { id } = await context.params;
  const file = await getDirectAttachment(user.id, id);
  if (!file) return NextResponse.json({ error: "not found" }, { status: 404, headers });
  const encodedName = encodeURIComponent(file.name).replace(/['()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
  return new Response(new Uint8Array(file.bytes), {
    headers: {
      ...headers, "Content-Type": file.type, "Content-Length": String(file.size),
      "Content-Disposition": `${file.type.startsWith("image/") ? "inline" : "attachment"}; filename*=UTF-8''${encodedName}`,
    },
  });
}
