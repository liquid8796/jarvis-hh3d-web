import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth/guards";
import { gifSearchReady, searchGifs } from "@/lib/services/gif";

/**
 * Tìm GIF cho tab GIF của sảnh đàm đạo.
 *
 * Route này tồn tại để KHOÁ GIPHY KHÔNG BAO GIỜ RA TỚI TRÌNH DUYỆT. Gọi thẳng GIPHY từ client
 * thì nhanh hơn một chặng, nhưng khoá nằm trong mã trang là khoá của cả internet — và hạn mức
 * bị người lạ tiêu hết thì tab GIF của tông môn chết theo.
 *
 * Cũng vì vậy mà cửa vẫn gác: chỉ môn đồ đã nhập môn mới tìm được, y như mọi endpoint khác
 * của sảnh.
 */
export const runtime = "nodejs";

export async function GET(request: Request) {
  const user = await currentUser();
  if (!user || user.status !== "active") {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  if (!gifSearchReady()) {
    return NextResponse.json(
      { error: "Kho GIF chưa khai mở — tông chủ cần đặt GIPHY_API_KEY trước." },
      { status: 503 },
    );
  }

  const query = new URL(request.url).searchParams.get("q") ?? "";

  try {
    return NextResponse.json({ gifs: await searchGifs(query) });
  } catch (err) {
    // 502 chứ không phải 500: hỏng nằm ở nhà bên, và phân biệt được hai thứ ấy là khác biệt
    // giữa "đi soi log GIPHY" với "đi soi code mình".
    const detail = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Không hỏi được GIPHY — ${detail}` }, { status: 502 });
  }
}
