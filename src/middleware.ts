import { NextResponse, type NextRequest } from "next/server";
import { decideRequest } from "@/lib/control/doc";
import { readControlDoc } from "@/lib/control/read";

/**
 * Tầng chuyển hướng gương trạm — mảnh RUNTIME đầu tiên của deploy/mirror/README.md (§5).
 *
 * Mỗi request soi bảng điều phối (cache 30s, xem read.ts): trạm này vẫn là trạm hoạt động
 * thì cho qua không dấu vết; đã có trạm khác lên thay thì người dùng được 307 sang bên ấy,
 * còn khôi lỗi và cron nhận tín hiệu riêng của chúng. Toàn bộ luật nằm trong `decideRequest`
 * (thuần, verify:control bao từng nhánh) — tệp này chỉ là dây nối vào Next.
 *
 * Runtime nodejs tường minh: chữ ký bảng xác minh bằng node:crypto (doc.ts), và bản chạy
 * phải là MỘT với bản đã kiểm — không dịch lại logic sang WebCrypto chỉ để chiều edge.
 *
 * Trạm chưa đặt SITE_ID (deploy hiện tại, máy dev) → decideRequest trả serve — deploy tệp
 * này TRƯỚC khi init bảng là an toàn tuyệt đối, đúng trình tự triển khai ở §12.
 */
export const config = {
  runtime: "nodejs",
  /**
   * Chặn từ cổng những đường không bao giờ chuyển hướng: tài sản build, ảnh tĩnh, favicon.
   * Regex một dòng thay vì liệt kê từng tệp public — thêm một ảnh vào public/ không được
   * trở thành lý do quay lại đây.
   */
  matcher: ["/((?!_next/|favicon\\.ico|.*\\.(?:png|webp|jpg|jpeg|gif|svg|ico|txt|xml|webmanifest)$).*)"],
};

export async function middleware(request: NextRequest): Promise<NextResponse> {
  const siteId = process.env.SITE_ID?.trim() || undefined;

  // Backend trên VM không mang SITE_ID: nó LÀ nơi phục vụ, không phải một trạm trong vòng
  // xoay — khỏi đọc bảng điều phối cho từng request chỉ để nghe câu "serve" biết trước.
  if (!siteId) {
    return NextResponse.next();
  }

  const decision = decideRequest({
    siteId,
    doc: await readControlDoc(),
    pathname: request.nextUrl.pathname,
    search: request.nextUrl.search,
  });

  switch (decision.kind) {
    case "serve":
      return NextResponse.next();
    case "redirect":
      // 307 chứ không 308: lượt chuyển trạm nào rồi cũng có ngày quay về, đừng để trình
      // duyệt đóng đinh bản ghi vĩnh viễn vào cache của nó.
      return NextResponse.redirect(decision.location, 307);
    case "worker-conflict":
      return NextResponse.json(
        { error: "Trạm này không còn hoạt động — đọc lại bảng điều phối.", activeUrl: decision.activeUrl },
        { status: 409 },
      );
    case "cron-skip":
      return new NextResponse(null, { status: 204 });
  }
}
