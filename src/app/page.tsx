import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { SectSeal } from "@/components/SectSeal";

/**
 * Ba thẻ giới thiệu. Viết như người Việt nói, không như một bản dịch.
 *
 * Bản cũ đọc ra "máy viết" vì bốn tật, và bản này tránh đúng bốn tật ấy: tiêu đề ghép bốn
 * chữ Hán-Việt cho sang ("Tông Môn Nghiêm Cẩn" — không ai đặt tên mục như vậy); một chữ
 * "ngôn ngữ nhân tộc" dịch sát từ "human language" mà tiếng Việt không có; cả ba thẻ dùng
 * chung một nhịp câu dài nối bằng dấu gạch ngang; và động từ tiếng Anh chen giữa câu
 * ("Mọi lượt chạy log bằng…").
 *
 * Giữ nguyên chất tu tiên — Linh Đài, khai đàn, đạo hữu, huyền tinh là tiếng nói của chính
 * sản phẩm, không phải thứ trang trí bỏ đi được. Thứ bỏ đi là cái giọng dịch máy.
 */
const PILLARS = [
  {
    title: "Tắt máy vẫn chạy",
    body: "Bấm Khai Đàn một lần trên Linh Đài rồi đóng trình duyệt, tắt máy đi ngủ. Linh sứ nằm trên server, cày nhiệm vụ ngày thay đạo hữu.",
  },
  {
    // KHÔNG hứa "phải được duyệt mới vào": từ 0.33.0 trưởng môn tắt được bước xét duyệt,
    // và một lời hứa cứng ở đây sẽ sai đúng vào ngày họ tắt nó. Câu này đúng ở cả hai chiều.
    title: "Trưởng môn nắm sổ",
    body: "Bái sư xong là có chỗ trong tông môn. Sổ môn đồ, quyền khai đàn, lịch bảo trì — trưởng môn coi hết ở một trang.",
  },
  {
    title: "Nhật ký đọc là hiểu",
    body: "Viết bằng tiếng Việt chứ không phải mã máy: ai vào phòng, đuổi ai ra, thu được bao nhiêu huyền tinh. Lúc nào muốn soi lại cũng có.",
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
            </article>
          ))}
        </section>
      </main>
    </>
  );
}
