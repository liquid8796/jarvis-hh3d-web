import Link from "next/link";
import { currentUser } from "@/lib/auth/guards";
import { logoutAction } from "@/app/actions/auth";
import { SectSeal } from "./SectSeal";

/** Thanh trên cùng: ấn + tên môn phái bên trái, danh tính + lối đi bên phải. */
export async function SiteHeader() {
  const user = await currentUser();

  return (
    <header className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-y-3 px-4 py-4 sm:px-6 sm:py-5">
      <Link href="/" className="flex items-center gap-3">
        <SectSeal size="2.6rem" />
        <span className="h-display text-lg font-semibold text-gilded">Auto HH3D</span>
      </Link>

      <nav className="flex items-center gap-3 text-sm">
        {user ? (
          <>
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
