import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth/guards";
import { getPresence, ONLINE_WINDOW_MS } from "@/lib/services/workers";

/**
 * Sổ điểm danh linh sứ cho panel Linh Sứ — một READ thuần, client hỏi theo nhịp để cái
 * chấm "đang trực" phản ánh sự thật chứ không phải trí nhớ của lần tải trang.
 */
export async function GET() {
  const user = await currentUser();
  if (!user || user.status !== "active") {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const presence = await getPresence(user.id);
  const cutoff = Date.now() - ONLINE_WINDOW_MS;

  return NextResponse.json({
    sectOnline: presence.sectOnline,
    mine: presence.mine.map((w) => ({
      id: w.id,
      lastSeen: w.lastSeen,
      online: w.lastSeen.getTime() > cutoff,
    })),
  });
}
