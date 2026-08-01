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
    default: "Jarvis HH3D — Linh Đài Tự Động",
    template: "%s · Jarvis HH3D",
  },
  description:
    "Control plane tu tiên cho automation hoathinh3d: đăng ký môn đồ, tông môn duyệt, khai đàn là linh sứ tự vận hành trên server.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi" className={`${display.variable} ${body.variable}`}>
      <body>
        {/* Ba lớp trời — sau mọi nội dung, không chặn chuột. */}
        <div className="sky" aria-hidden />
        <div className="stars" aria-hidden />
        <div className="clouds" aria-hidden />
        {children}
      </body>
    </html>
  );
}
