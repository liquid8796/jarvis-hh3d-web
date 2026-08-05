import Link from "next/link";
import { currentUser } from "@/lib/auth/guards";
import { logoutAction } from "@/app/actions/auth";
import { SectSeal } from "./SectSeal";

/**
 * Thanh trên cùng: ấn + tên môn phái bên trái, danh tính + lối đi bên phải.
 *
 * `maxWidth` để trang tự nói bề rộng khung của mình. Mặc định giữ nguyên `max-w-5xl` nên
 * mọi trang cũ không xê dịch một pixel; chỉ trang nào rộng hơn (Linh Đài) mới truyền vào,
 * vì một thanh trên cùng hẹp hơn hàng thẻ bên dưới trông như bị lệch tâm.
 *
 * Nhận nguyên chuỗi lớp có sẵn trong mã nguồn, KHÔNG ghép chuỗi lúc chạy: Tailwind quét
 * tĩnh, một lớp dựng bằng biến sẽ không bao giờ được sinh ra CSS.
 */
export async function SiteHeader({ maxWidth = "max-w-5xl" }: { maxWidth?: string } = {}) {
  const user = await currentUser();

  return (
    <header
      className={`mx-auto flex w-full ${maxWidth} flex-wrap items-center justify-between gap-y-3 px-4 py-4 sm:px-6 sm:py-5`}
    >
      <Link href="/" className="flex items-center gap-3">
        <SectSeal size="2.6rem" />
        <span className="h-display text-lg font-semibold text-gilded">Auto HH3D</span>
      </Link>

      <nav className="flex flex-wrap items-center justify-end gap-3 text-sm">
        {user ? (
          <>
            <Link href="/profile" className="btn btn-ghost">
              Hồ Sơ
            </Link>
            {user.role === "admin" && (
              <Link href="/admin" className="btn btn-ghost">
                Tông Môn
              </Link>
            )}
            <Link href={user.status === "active" ? "/dashboard" : "/pending"} className="btn btn-ghost">
              Linh Đài
            </Link>
            {user.status === "active" && (
              <Link href="/chat" className="btn btn-ghost">
                Tụ Nghĩa Sảnh
              </Link>
            )}
            <form action={logoutAction}>
              <button type="submit" className="btn btn-ghost" title={`Đang đăng nhập: ${user.displayName}`}>
                Xuất Quan
              </button>
            </form>
          </>
        ) : (
          <>
            <Link href="/login" className="btn btn-ghost">
              Nhập Môn
            </Link>
            <Link href="/register" className="btn btn-gold">
              Bái Sư
            </Link>
          </>
        )}
      </nav>
    </header>
  );
}
