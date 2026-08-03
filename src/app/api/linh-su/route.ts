import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth/guards";
import { getPresenceFeed } from "@/lib/services/dashboard";

/**
 * Ảnh chụp sổ linh sứ đời cũ/compatibility. Dashboard v0.19 nhận cùng dữ liệu qua SSE chung;
 * route này vẫn là lưới an toàn và phục vụ tab cũ trong lúc rollout.
 */
export async function GET() {
  const user = await currentUser();
  if (!user || user.status !== "active") {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  return NextResponse.json(await getPresenceFeed(user.id));
}
