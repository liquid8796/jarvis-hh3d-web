import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { SectSeal } from "@/components/SectSeal";
import {
  buildLandingJsonLd,
  serializeJsonLd,
  LANDING_FEATURES,
  LANDING_STEPS,
  LANDING_FAQ,
} from "@/lib/seo/site";

const PILLARS = [
  {
    title: "Khai Đàn Viễn Trình",
    body: "Bấm một nút trên Tế đàn, khôi lỗi trên server tự vận hành nhiệm vụ ngày — đóng trình duyệt, tắt máy, đàn pháp vẫn chạy.",
  },
  {
    title: "Tông Môn Nghiêm Cẩn",
    body: "Bái sư là bước đầu; trưởng môn duyệt danh sách môn đồ, ai được phép khai đàn do tông môn quyết.",
  },
  {
    title: "Nhật Ký Tu Luyện",
    body: "Mọi lượt chạy log bằng ngôn ngữ nhân tộc: ai vào phòng, trục xuất ai, huyền tinh thu về bao nhiêu — từng dòng, từng thời khắc.",
  },
];

export default function LandingPage() {
  const landingJsonLd = buildLandingJsonLd();

  return (
    <>
      {/* Schema.org Structured Data: Organization, WebSite, WebApplication, FAQPage */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(landingJsonLd) }}
      />

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
              khai đàn một chạm, khôi lỗi trên server lo phần cày cuốc — đạo hữu chỉ việc thu
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

        {/* 3 Trụ cột cốt lõi */}
        <section aria-label="Đặc điểm cốt lõi" className="grid gap-6 md:grid-cols-3">
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

        {/* Tính năng linh đài chi tiết */}
        <section aria-labelledby="features-heading" className="mt-20">
          <div className="text-center">
            <p className="text-xs font-bold uppercase tracking-[.18em] text-[var(--color-gold-300)]">
              Pháp bảo tự động
            </p>
            <h2 id="features-heading" className="h-display mt-2 text-2xl font-bold text-gilded sm:text-3xl">
              Tính năng linh đài phục vụ tu sĩ
            </h2>
            <p className="mt-3 max-w-2xl mx-auto text-sm leading-relaxed text-[var(--color-mist)]">
              Mọi tính năng được thiết kế riêng cho việc tối ưu thời gian thực hiện nhiệm vụ ngày trên hoathinh3d,
              bảo đảm công bằng, minh bạch và an toàn tài khoản.
            </p>
          </div>

          <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {LANDING_FEATURES.map((feature, idx) => (
              <article key={idx} className="card card-hairline p-6 flex flex-col justify-between">
                <div>
                  <h3 className="h-display text-base font-semibold text-gilded mb-2 flex items-center gap-2">
                    <span className="text-[var(--color-gold-300)]" aria-hidden="true">✦</span>
                    <span>{feature.title}</span>
                  </h3>
                  <p className="text-sm leading-relaxed text-[var(--color-mist)]">{feature.body}</p>
                </div>
              </article>
            ))}
          </div>
        </section>

        {/* 4 Bước nhập môn */}
        <section aria-labelledby="steps-heading" className="mt-20">
          <div className="text-center">
            <p className="text-xs font-bold uppercase tracking-[.18em] text-[var(--color-gold-300)]">
              Lộ trình tu tập
            </p>
            <h2 id="steps-heading" className="h-display mt-2 text-2xl font-bold text-gilded sm:text-3xl">
              Bốn bước bắt đầu cùng Auto HH3D
            </h2>
          </div>

          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {LANDING_STEPS.map((step, idx) => (
              <div key={idx} className="card card-hairline p-5 relative">
                <div className="text-xs font-bold uppercase tracking-wider text-[var(--color-gold-300)] mb-2">
                  Bước 0{idx + 1}
                </div>
                <h3 className="h-display text-base font-semibold text-gilded mb-2">{step.title}</h3>
                <p className="text-xs leading-relaxed text-[var(--color-mist)]">{step.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Câu hỏi thường gặp (FAQ) - Khớp 100% Schema.org FAQPage */}
        <section aria-labelledby="faq-heading" className="mt-20">
          <div className="text-center">
            <p className="text-xs font-bold uppercase tracking-[.18em] text-[var(--color-gold-300)]">
              Hỏi đáp tu luyện
            </p>
            <h2 id="faq-heading" className="h-display mt-2 text-2xl font-bold text-gilded sm:text-3xl">
              Câu hỏi thường gặp
            </h2>
            <p className="mt-3 max-w-xl mx-auto text-sm leading-relaxed text-[var(--color-mist)]">
              Giải đáp các thắc mắc phổ biến về cơ chế hoạt động, độ an toàn và cách vận hành khôi lỗi.
            </p>
          </div>

          <div className="mt-10 space-y-4 max-w-3xl mx-auto">
            {LANDING_FAQ.map((faq, idx) => (
              <details
                key={idx}
                className="card card-hairline group rounded-xl p-5 open:bg-[rgba(31,27,55,0.7)] transition-colors"
                {...(idx === 0 ? { open: true } : {})}
              >
                <summary className="h-display cursor-pointer text-base font-semibold text-gilded list-none flex items-center justify-between gap-4">
                  <span>{faq.question}</span>
                  <span
                    className="text-xs text-[var(--color-gold-300)] transition-transform duration-200 group-open:rotate-180"
                    aria-hidden="true"
                  >
                    ▼
                  </span>
                </summary>
                <p className="mt-3 text-sm leading-relaxed text-[var(--color-mist)] border-t border-[rgba(155,150,190,.14)] pt-3">
                  {faq.answer}
                </p>
              </details>
            ))}
          </div>
        </section>

        {/* Kêu gọi hành động */}
        <section className="mt-20 text-center">
          <div className="card card-hairline p-8 sm:p-12 max-w-2xl mx-auto bg-[linear-gradient(145deg,rgba(31,27,55,.8),rgba(12,10,26,.9))]">
            <h2 className="h-display text-2xl font-bold text-gilded sm:text-3xl">
              Sẵn sàng giải phóng thời gian của bạn?
            </h2>
            <p className="mt-4 text-sm leading-relaxed text-[var(--color-mist)]">
              Tạo tài khoản ngay hôm nay để gia nhập tông môn và trải nghiệm cỗ máy tự động hoá nhiệm vụ ngày chạy trên đám mây.
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-4">
              <Link href="/register" className="btn btn-gold text-base">
                Bái Sư Nhập Môn
              </Link>
              <Link href="/quyen-rieng-tu" className="btn btn-ghost text-base">
                Chính sách bảo mật
              </Link>
            </div>
          </div>
        </section>
      </main>
    </>
  );
}

