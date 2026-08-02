import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { SectSeal } from "@/components/SectSeal";

const PILLARS = [
  {
    title: "Khai Đàn Viễn Trình",
    body: "Bấm một nút trên Linh Đài, linh sứ trên server tự vận hành nhiệm vụ ngày — đóng trình duyệt, tắt máy, đàn pháp vẫn chạy.",
  },
  {
    title: "Tông Môn Nghiêm Cẩn",
    body: "Bái sư là bước đầu; trưởng môn duyệt danh sách môn đồ, ai được phép khai đàn do tông môn quyết.",
    badge: "Chỉ dành cho thành viên Lạc Vân Tông",
  },
  {
    title: "Nhật Ký Tu Luyện",
    body: "Mọi lượt chạy log bằng ngôn ngữ nhân tộc: ai vào phòng, trục xuất ai, huyền tinh thu về bao nhiêu — từng dòng, từng thời khắc.",
  },
];

export default function LandingPage() {
  return (
    <>
      {/* Bảo hoa rơi — cánh hoa hồng phấn của Bảo Hoa tiên tử (Phàm Nhân Tu Tiên), rắc
          riêng cho trang chủ: đây là sảnh đón, và chân trang ký tên đúng vị tiên tử ấy.
          pointer-events: none, nên hoa chỉ để ngắm, không bao giờ đứng chắn một cú bấm. */}
      <div className="petals" aria-hidden>
        {Array.from({ length: 12 }, (_, i) => (
          <i key={i} style={{ "--i": i } as React.CSSProperties} />
        ))}
      </div>
      <SiteHeader />
      <main className="mx-auto w-full max-w-5xl px-4 pb-24 sm:px-6">
        <section className="rise-in flex flex-col items-center py-14 text-center">
          <SectSeal size="5.5rem" />
          {/* Tấm veil chỉ ôm phần CHỮ của hero: đúng vùng mà mặt trăng trong ảnh nền làm
              chữ vàng lẫn chữ sương chìm nghỉm. Ấn ở trên và ba pillar bên dưới tự đứng
              được trên ảnh, nên chúng ở ngoài veil — ảnh được che ít nhất có thể. */}
          <div className="hero-veil mt-8 flex flex-col items-center">
            <h1 className="h-display max-w-3xl text-3xl font-bold leading-tight sm:text-4xl md:text-5xl">
              <span className="text-gilded">Phàm nhân</span> cũng có thể
              <br />
              <span className="text-gilded">tu tiên bằng automation</span>
            </h1>
            <p className="mt-6 max-w-xl text-base leading-relaxed text-[var(--color-parchment)]/90">
              Auto HH3D đưa cỗ máy nhiệm vụ ngày của hoathinh3d lên mây: cấu hình một lần,
              khai đàn một chạm, linh sứ trên server lo phần cày cuốc — đạo hữu chỉ việc thu
              linh thạch.
            </p>
            <div className="mt-8 flex gap-4">
              <Link href="/register" className="btn btn-gold text-base">
                Bái Sư Nhập Môn
              </Link>
              <Link href="/login" className="btn btn-ghost text-base">
                Đã có đạo hiệu
              </Link>
            </div>
          </div>
        </section>

        <section className="grid gap-6 md:grid-cols-3">
          {PILLARS.map((p, i) => (
            <article
              key={p.title}
              className="card card-hairline rise-in p-6"
              style={{ animationDelay: `${0.12 * (i + 1)}s` }}
            >
              <h2 className="h-display mb-3 text-lg font-semibold text-gilded">{p.title}</h2>
              <p className="text-sm leading-relaxed text-[var(--color-mist)]">{p.body}</p>
              {"badge" in p && (
                <p className="mt-3 text-sm font-semibold text-[var(--color-gold-300)]">
                  {p.badge}
                </p>
              )}
            </article>
          ))}
        </section>
      </main>
    </>
  );
}
