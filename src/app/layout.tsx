import type { Metadata } from "next";
import { Be_Vietnam_Pro, Noto_Serif } from "next/font/google";
import "./globals.css";

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
