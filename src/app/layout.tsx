import type { Metadata } from "next";
import { Be_Vietnam_Pro, Dancing_Script, Noto_Serif } from "next/font/google";
import { NightScene } from "@/components/NightScene";
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

// Nét bút cho ấn "Phàm nhân tu tiên" — phải là font CÓ subset vietnamese: chữ trong ấn mang
// đủ dấu ("Phàm", "tiên"), và một font script chỉ có latin sẽ rơi về font hệ thống ở đúng
// những ký tự có dấu, cho ra một con dấu chắp vá.
const brush = Dancing_Script({
  subsets: ["latin", "vietnamese"],
  weight: ["600", "700"],
  variable: "--font-brush",
});

export const metadata: Metadata = {
  title: {
    default: "Jarvis HH3D — Linh Đài Tự Động",
    template: "%s · Jarvis HH3D",
  },
  description:
    "Control plane tu tiên cho automation hoathinh3d: đăng ký môn đồ, tông môn duyệt, khai đàn là linh sứ tự vận hành trên server.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi" className={`${display.variable} ${body.variable} ${brush.variable}`}>
      <body>
        {/* Đêm trăng — các lớp cố định sau mọi nội dung, không chặn chuột.
            Thứ tự vẽ: trời → sao → TRĂNG → mây (mây che nhẹ mép trăng cho có chiều sâu)
            → cảnh núi-chùa-mặt nước → lá vàng rơi trên cùng. */}
        <div className="sky" aria-hidden />
        <div className="stars" aria-hidden />
        <div className="moon" aria-hidden />
        <div className="clouds" aria-hidden />
        <NightScene />
        <div className="leaves" aria-hidden>
          {Array.from({ length: 9 }, (_, i) => (
            <i key={i} style={{ "--i": i } as React.CSSProperties} />
          ))}
        </div>
        {children}
      </body>
    </html>
  );
}
