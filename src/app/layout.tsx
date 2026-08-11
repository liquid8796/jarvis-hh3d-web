import type { Metadata, Viewport } from "next";
import { Be_Vietnam_Pro, Noto_Serif } from "next/font/google";
import { AppVersion } from "@/components/AppVersion";
import { NoticePopup } from "@/components/NoticePopup";
import { BackdropPeek } from "@/components/BackdropPeek";
import { MaintenanceGate } from "@/components/MaintenanceGate";
import { getRenderSettings } from "@/lib/services/settings";
import { backdropCss } from "@/lib/validation/backdrops";
import "./globals.css";
import "./peek.css";

/**
 * `minimumScale: 1` là một nửa của tính năng pan tranh trên mobile (nửa kia là `.backdrop`
 * sticky trong globals.css). Trang mobile giờ CỐ Ý rộng hơn khung nhìn — để vuốt ngang mà
 * ngắm trọn tấm tranh nền — nhưng trình duyệt điện thoại gặp trang tràn ngang là tự thu nhỏ
 * cho vừa ("overview mode"). Đo trong emulation: scale bị kéo xuống 0.26, cả canvas 1443px
 * thu tí hon vào 375px — người dùng nhận một cái app kiến thay vì một bức tranh pan được.
 * Ghim sàn zoom ở 1 thì phần tràn trở thành CUỘN, đúng ý đồ. Phóng TO để đọc chữ vẫn tự do.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  minimumScale: 1,
};

const display = Noto_Serif({
  subsets: ["latin", "vietnamese"],
  weight: ["600", "700"],
  variable: "--font-display",
});

const body = Be_Vietnam_Pro({
  subsets: ["latin", "vietnamese"],
  weight: ["400", "500", "600"],
  variable: "--font-body",
});

/**
 * Không trang nào được dựng sẵn lúc build, và từ bản 0.46.0 đó là điều BẮT BUỘC chứ không chỉ
 * là mô tả thực trạng.
 *
 * Layout này giờ đọc cờ bế quan từ database. Trang nào Next dựng sẵn ở build sẽ ĐÓNG BĂNG cờ
 * ấy vào HTML — build lúc đang bảo trì là trang đó treo bảng bế quan vĩnh viễn, build lúc mở
 * cửa là nó không bao giờ treo. `/_not-found` chính là trang như thế: nó là trang duy nhất
 * không tự chạm vào cookie nên nó là trang duy nhất từng được dựng tĩnh.
 *
 * Và nó còn giữ một lời hứa cũ: `next build` KHÔNG cần database để biên dịch (xem ghi chú
 * trong db/client.ts về việc cố ý không tạo client lúc import). Dựng sẵn một trang đi qua
 * layout này là bắt build phải gọi được Postgres.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: {
    default: "Auto HH3D — Linh Đài Tự Động",
    template: "%s · Auto HH3D",
  },
  description:
    "Control plane tu tiên cho automation hoathinh3d: đăng ký môn đồ, tông môn duyệt, khai đàn là khôi lỗi tự vận hành trên server.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Dùng chung ĐÚNG một lượt đọc app_settings với cửa bế quan bên dưới — xem `getRenderSettings`.
  const { appearance } = await getRenderSettings();
  const backdropRules = backdropCss(appearance.defaultBackdrop, appearance.pageBackdrops);

  return (
    <html lang="vi" className={`${display.variable} ${body.variable}`}>
      <body>
        {/*
          Nền của từng trang, rót từ cấu hình.

          THẺ NÀY PHẢI ĐỨNG TRƯỚC `.backdrop` — không phải để cho đẹp. Luật dùng `:has()`, một
          selector ĐỘNG: trình duyệt tính kiểu cho `.backdrop` ngay khi phân tích tới nó, và
          nếu lúc ấy luật chưa có mặt thì nó tải tấm mặc định rồi mới đổi — hai lượt tải ảnh
          vài MB cộng một cú nháy. Đặt ở đây thì luật luôn có trước.

          Vì sao không phải một class do server tính rồi gắn thẳng vào `.backdrop` (khỏi cần
          `:has()`): layout gốc KHÔNG biết nó đang dựng đường dẫn nào. Đường "proxy gắn đường
          dẫn vào header rồi layout đọc ra" đã được thử và ĐO là không chạy trên Next 16.2 —
          xem chú thích trong components/MaintenanceGate.tsx. Trang tự khai bằng
          `data-backdrop` là đường còn lại, và nó không cần proxy biết gì cả.

          `dangerouslySetInnerHTML` vì `<style>` cần nguyên văn CSS, không phải chuỗi đã escape
          HTML. URL đi vào đây đã qua `safeBackdropUrl` — danh sách TRẮNG chặt, không phải lọc
          ký tự xấu; xem lý lẽ tại chính hàm ấy trong validation/backdrops.ts.
        */}
        {backdropRules.length > 0 && <style dangerouslySetInnerHTML={{ __html: backdropRules }} />}
        {/* Nền là TẤM ẢNH GỐC (Nam Cung Uyển dưới trăng), nguyên vẹn từng pixel — không phải
            bản dựng lại. Bản 0.5.0 từng vẽ cả cảnh đêm bằng CSS/SVG vì chưa có file; giờ file
            nằm trong public/ nên toàn bộ trăng-lá-núi-chùa giả đã dọn đi: hai mặt trăng trên
            một bầu trời là thứ không cứu được. Chữ vẫn đọc tốt không cần phủ tối lên ảnh —
            header và card tự mang nền mờ của chúng. */}
        <div className="backdrop" aria-hidden />
        {/* Nút Ngắm Tranh đứng NGOÀI cửa bế quan và ngoài mọi thứ khác, ngay cạnh tấm nền —
            nó là con trực tiếp duy nhất của body (cùng với nền) được miễn khỏi luật làm mờ,
            nên nó không bao giờ tự mờ mất đường quay lại. Xem components/BackdropPeek.tsx. */}
        <BackdropPeek />
        {/* Cửa bế quan đứng Ở ĐÂY để không một trang nào lọt ra ngoài nó — kể cả trang thêm
            vào sau này, thứ mà một danh sách đường dẫn ở proxy sẽ luôn quên. Nền và chân
            trang nằm NGOÀI cửa: chúng là cái vỏ, và bảng bế quan cũng cần được đứng trên tấm
            tranh ấy. Xem components/MaintenanceGate.tsx cho toàn bộ lý lẽ. */}
        <MaintenanceGate>{children}</MaintenanceGate>
        <footer className="site-footer">© 2026 Nam Cung Bình. All rights reserved.</footer>
        {/* Dấu bản đứng NGOÀI cửa bế quan, cùng lẽ với tấm nền: lúc web đang bế quan là đúng
            lúc người ta cần biết trạm mình đang gõ cửa mang bản nào. Đứng cuối trong DOM để
            trình đọc màn hình đọc nó sau cùng — nó là chú thích, không phải nội dung. */}
        <AppVersion />
        {/* Popup thông báo tông môn — đứng ở đây, ngoài cửa bế quan và ngoài mọi trang, vì một
            lời nhắn「phát lúc này」mà chỉ một trang thấy thì không phải là thông báo. Với khách
            vãng lai nó tự nằm im (một cú 401 rồi thôi hẳn) — xem components/NoticePopup.tsx. */}
        <NoticePopup />
      </body>
    </html>
  );
}
