import type { Metadata, Viewport } from "next";
import { Be_Vietnam_Pro, Noto_Serif } from "next/font/google";
import "./globals.css";

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

export const metadata: Metadata = {
  title: {
    default: "Auto HH3D — Linh Đài Tự Động",
    template: "%s · Auto HH3D",
  },
  description:
    "Control plane tu tiên cho automation hoathinh3d: đăng ký môn đồ, tông môn duyệt, khai đàn là linh sứ tự vận hành trên server.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi" className={`${display.variable} ${body.variable}`}>
      <body>
        {/* Nền là TẤM ẢNH GỐC (Nam Cung Uyển dưới trăng), nguyên vẹn từng pixel — không phải
            bản dựng lại. Bản 0.5.0 từng vẽ cả cảnh đêm bằng CSS/SVG vì chưa có file; giờ file
            nằm trong public/ nên toàn bộ trăng-lá-núi-chùa giả đã dọn đi: hai mặt trăng trên
            một bầu trời là thứ không cứu được. Chữ vẫn đọc tốt không cần phủ tối lên ảnh —
            header và card tự mang nền mờ của chúng. */}
        <div className="backdrop" aria-hidden />
        {children}
        <footer className="site-footer">© 2026 Bảo Hoa tiên tử. All rights reserved.</footer>
      </body>
    </html>
  );
}
