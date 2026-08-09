import Link from "next/link";
import { isAdminUser } from "@/lib/auth/permissions";
import { currentUser } from "@/lib/auth/guards";
import { logoutAction } from "@/app/actions/auth";
import { Avatar } from "./Avatar";
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
export const SHELL_WIDTH = "max-w-[100rem]";

/**
 * Thanh trên cùng: ấn + tên môn phái bên trái, danh tính + lối đi bên phải.
 *
 * Bề rộng của nó là HẰNG SỐ, không phải tham số của trang. Trước đây nó nhận `maxWidth` để
 * mỗi trang tự nói khung của mình, và hậu quả là cụm menu NHẢY NGANG khi đổi tab: năm trang
 * dùng `max-w-5xl` (1024px) còn Auto với Hàng Đợi dùng `max-w-[100rem]` (1600px). Đo
 * trên màn 1920: mép phải cụm menu ở 1441 trên trang chủ và 1729 trên Auto — lệch 288
 * pixel mỗi bên, chỉ vì bấm sang tab khác.
 *
 * Bề rộng nội dung thì vẫn nên khác nhau (một form hồ sơ rộng 100rem là vô lý), nhưng phần
 * VỎ của app thì không: nó là thứ duy nhất có mặt trên mọi trang, nên nó phải là thứ duy
 * nhất không nhúc nhích. Chốt ở `SHELL_WIDTH` — bản rộng nhất đang dùng — để hai trang hay
 * lui tới nhất vẫn thẳng hàng với nội dung bên dưới; chốt ở bản hẹp thì chính hai trang ấy
 * lại có thanh trên cùng thụt vào so với hàng thẻ, đúng cái lỗi mà tham số kia sinh ra để vá.
 *
 * Bỏ hẳn tham số chứ không chỉ đổi giá trị mặc định: còn cái núm thì còn đường lệch trở lại,
 * và TypeScript giờ chặn ngay tại chỗ gọi.
 */
export async function SiteHeader() {
  const user = await currentUser();

  // `paddingRight` chừa chỗ cho nút Ngắm Tranh ghim ở góc trên bên phải (biến `--peek-gutter`
  // trong globals.css). Cụm menu ở đây biết XUỐNG DÒNG, và số mục thì đổi theo vai người xem —
  // nên không có con số `top` nào đoán trước được chiều cao của nó để mà né. Đổi chiều: nút
  // giữ nguyên góc, còn thanh này nhường chỗ.
  return (
    <header
      className={`mx-auto flex w-full ${SHELL_WIDTH} flex-wrap items-center justify-between gap-y-3 px-4 py-4 sm:px-6 sm:py-5`}
      // Giá trị lui trong `var()` không thừa: biến kia biến mất thì cả `max()` thành vô hiệu ở
      // bước tính giá trị, và padding rơi về 0 — cụm menu dính sát mép, chui xuống dưới nút.
      style={{ paddingRight: "max(var(--peek-gutter, 4rem), 1rem)" }}
    >
      <Link href="/" className="flex items-center gap-3">
        <SectSeal size="2.6rem" />
        <span className="h-display text-lg font-semibold text-gilded">Auto HH3D</span>
      </Link>

      <nav className="flex flex-wrap items-center justify-end gap-3 text-sm">
        {user ? (
          <>
            {/* Ảnh đại diện đứng ngay trong nút Hồ Sơ — đó là nơi đổi nó, nên đó cũng là nơi
                nó nên xuất hiện. Cỡ 22px để nút không cao lên và cả hàng menu không xô lệch;
                `.btn` vốn đã là inline-flex có gap nên không cần thêm lớp xếp hàng nào. */}
            <Link href="/profile" className="btn btn-ghost">
              <Avatar name={user.displayName} url={user.avatarUrl} size={22} />
              Hồ Sơ
            </Link>
            {isAdminUser(user) && (
              <Link href="/admin" className="btn btn-ghost">
                Tông Môn
              </Link>
            )}
            <Link href={user.status === "active" ? "/dashboard" : "/pending"} className="btn btn-ghost">
              Auto
            </Link>
            {user.status === "active" && (
              <>
                <Link href="/hang-doi" className="btn btn-ghost">
                  Hàng Đợi
                </Link>
                <Link href="/chat" className="btn btn-ghost">
                  Phòng Chat
                </Link>
              </>
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
