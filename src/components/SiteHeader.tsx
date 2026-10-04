import Link from "next/link";
import { isAdminUser } from "@/lib/auth/permissions";
import { currentUser } from "@/lib/auth/guards";
import { logoutAction } from "@/app/actions/auth";
import { SectSeal } from "./SectSeal";

/**
 * Bề rộng khung của cả app — thanh trên cùng luôn dùng nó, và trang nào muốn nội dung trải
 * trọn khung thì dùng đúng hằng này (Auto, Hàng Đợi).
 *
 * 100rem = 1600px. Auto là bàn làm việc hai cột — danh sách tài khoản, hai tab nhiệm vụ
 * với lưới tuỳ chọn hai cột, nhật ký chạy — nên mức 1152px cũ ép mỗi cột còn ~566px và mọi
 * thứ bên trong phải chen nhau. Vẫn có trần chứ không thả tự do: một biểu mẫu kéo ngang hết
 * màn 2560px thì mắt phải quét quá xa, và dòng chữ dài ra là khó đọc hơn chứ không dễ.
 *
 * MỘT bản duy nhất, ở đây. Trước đây Auto và Hàng Đợi mỗi trang tự khai một hằng cùng
 * tên cùng giá trị — hai bản sao của cùng một con số là cách êm ái nhất để chúng lệch nhau.
 *
 * Nguyên một chuỗi lớp có sẵn trong mã nguồn, KHÔNG ghép lúc chạy: Tailwind quét tĩnh, một
 * lớp dựng bằng biến sẽ không bao giờ được sinh ra CSS.
 */
import { SiteHeaderNav } from "./SiteHeaderNav";

export const SHELL_WIDTH = "max-w-[100rem]";

export async function SiteHeader() {
  const user = await currentUser();

  return (
    <header
      className={`mx-auto flex w-full ${SHELL_WIDTH} flex-wrap items-center justify-between gap-y-3 px-4 py-4 sm:px-6 sm:py-5`}
      style={{ paddingRight: "max(var(--peek-gutter, 4rem), 1rem)" }}
    >
      <Link href="/" className="flex items-center gap-3">
        <SectSeal size="2.6rem" />
        <span className="h-display text-lg font-semibold text-gilded">Auto HH3D</span>
      </Link>

      <SiteHeaderNav
        user={
          user
            ? {
                displayName: user.displayName,
                avatarUrl: user.avatarUrl,
                status: user.status,
              }
            : null
        }
        isAdmin={Boolean(user && isAdminUser(user))}
        logoutAction={logoutAction}
      />
    </header>
  );
}
