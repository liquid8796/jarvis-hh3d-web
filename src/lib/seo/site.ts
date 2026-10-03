/**
 * SEO — MỘT NGUỒN DUY NHẤT cho danh tính trang, từ khoá, bản đồ route và nội dung FAQ.
 *
 * Vì sao gom về một chỗ: FAQ xuất hiện HAI lần — một lần thành chữ người đọc trên trang chủ,
 * một lần thành JSON-LD `FAQPage` cho máy tìm kiếm. Google phạt kiểu「schema nói một đằng, trang
 * hiện một nẻo」(structured data không khớp nội dung hiển thị là vi phạm chính sách rich result),
 * nên hai bản ấy phải sinh ra từ cùng một mảng chứ không được gõ tay hai lần.
 *
 * Tương tự, `robots.ts` (cấm bot) và `sitemap.ts` (mời bot) đọc cùng hai danh sách bên dưới —
 * một route không thể vừa nằm trong sitemap vừa bị robots chặn.
 *
 * Tệp này thuần: không đọc database, không đọc header. `robots.txt`/`sitemap.xml` vì thế dựng
 * tĩnh được, và `next build` vẫn giữ lời hứa không cần Postgres.
 */
import { OFFICIAL_ORIGIN } from "@/lib/domains/catalog";

export const SITE_URL = OFFICIAL_ORIGIN;
export const SITE_NAME = "Auto HH3D";
export const SITE_TITLE = "Auto HH3D — Linh Đài Tự Động cho Hoạt Hình 3D";
export const SITE_TAGLINE = "Linh Đài Tự Động";

export const SITE_DESCRIPTION =
  "Auto HH3D là nền tảng tự động hoá nhiệm vụ ngày cho hoathinh3d: cấu hình một lần, khai đàn một chạm, khôi lỗi chạy trên server 24/7 — không cần treo máy, theo dõi nhật ký từng lượt chạy.";

export const SITE_KEYWORDS: readonly string[] = [
  "auto hh3d",
  "auto hoathinh3d",
  "hoathinh3d",
  "hoạt hình 3d",
  "tool hoathinh3d",
  "auto nhiệm vụ hoathinh3d",
  "tự động nhiệm vụ ngày",
  "cày linh thạch tự động",
  "khôi lỗi tu tiên",
  "phàm nhân tu tiên",
  "automation game",
  "auto game online",
  "bot chạy trên server",
  "tu tiên automation",
];

export const OG_IMAGE = {
  url: "/og-image.jpg",
  width: 1200,
  height: 630,
  alt: "Auto HH3D — Linh Đài Tự Động: khôi lỗi tu tiên chạy nhiệm vụ hoathinh3d trên server",
} as const;

export type SitemapRoute = Readonly<{
  path: string;
  changeFrequency: "daily" | "weekly" | "monthly";
  priority: number;
}>;

/** Trang công khai, ai cũng xem được — thứ duy nhất được mời bot vào. */
export const PUBLIC_SITEMAP_ROUTES: readonly SitemapRoute[] = [
  { path: "/", changeFrequency: "daily", priority: 1 },
  { path: "/register", changeFrequency: "monthly", priority: 0.7 },
  { path: "/login", changeFrequency: "monthly", priority: 0.6 },
  { path: "/ten-mien", changeFrequency: "weekly", priority: 0.5 },
  { path: "/quyen-rieng-tu", changeFrequency: "monthly", priority: 0.4 },
];

/**
 * Tiền tố cấm bot. Toàn bộ đều là trang cần đăng nhập, API, hoặc khung nhúng — bot vào chỉ
 * gặp cú chuyển hướng về /login (phí ngân sách crawl) hoặc một trang trống không có nội dung.
 */
export const ROBOTS_DISALLOW: readonly string[] = [
  "/api/",
  "/admin",
  "/dashboard",
  "/pending",
  "/profile",
  "/hang-doi",
  "/be-quan",
  "/chat",
  "/chat-frame",
];

/** Metadata dùng chung cho mọi trang riêng tư: đừng lập chỉ mục, cũng đừng lần theo link. */
export const PRIVATE_ROBOTS = { index: false, follow: false } as const;

export type LandingFeature = Readonly<{ title: string; body: string }>;

export const LANDING_FEATURES: readonly LandingFeature[] = [
  {
    title: "Nhiệm vụ ngày tự vận hành",
    body: "Điểm danh, vấn đáp, tế lễ, phúc lợi và các nhiệm vụ lặp lại mỗi ngày được khôi lỗi xử lý theo lịch bạn đặt — không bỏ sót một lượt nào kể cả khi bạn bận.",
  },
  {
    title: "Chạy trên server, không treo máy",
    body: "Khôi lỗi sống trên máy chủ đám mây chứ không trên máy tính của bạn. Tắt trình duyệt, tắt máy, mất điện ở nhà — đàn pháp vẫn chạy đến khi xong việc.",
  },
  {
    title: "Nhật ký minh bạch từng dòng",
    body: "Mỗi lượt chạy để lại nhật ký bằng tiếng Việt dễ hiểu: vào phòng nào, nhận thưởng gì, gặp lỗi ở đâu và đã tự phục hồi ra sao — bạn luôn biết tài khoản mình đang làm gì.",
  },
  {
    title: "Hàng đợi công bằng cho cả tông môn",
    body: "Nhiều đạo hữu cùng khai đàn sẽ được xếp hàng theo thứ tự rõ ràng, hiển thị vị trí và thời gian chờ ước tính, không ai chen ngang, không lượt nào bị thất lạc.",
  },
  {
    title: "Duyệt môn đồ chặt chẽ",
    body: "Tài khoản mới phải được trưởng môn duyệt mới được dùng khôi lỗi. Quyền hạn được phân theo vai trò để cỗ máy chỉ phục vụ đúng người, đúng việc.",
  },
  {
    title: "Bảo mật và riêng tư",
    body: "Mật khẩu được băm một chiều, phiên đăng nhập có hạn dùng, dữ liệu chỉ phục vụ vận hành. Chính sách quyền riêng tư công khai cách hệ thống và đối tác quảng cáo xử lý dữ liệu.",
  },
];

export type LandingStep = Readonly<{ title: string; body: string }>;

export const LANDING_STEPS: readonly LandingStep[] = [
  { title: "Bái sư nhập môn", body: "Tạo đạo hiệu và gửi yêu cầu gia nhập tông môn chỉ trong vài giây." },
  { title: "Chờ trưởng môn duyệt", body: "Trưởng môn xét duyệt và cấp quyền sử dụng khôi lỗi cho tài khoản của bạn." },
  { title: "Cấu hình một lần", body: "Chọn nhiệm vụ muốn tự động hoá và khung giờ chạy phù hợp với lịch của bạn." },
  { title: "Khai đàn một chạm", body: "Bấm khai đàn, khôi lỗi nhận việc trên server — bạn chỉ việc thu linh thạch." },
];

export type FaqItem = Readonly<{ question: string; answer: string }>;

export const LANDING_FAQ: readonly FaqItem[] = [
  {
    question: "Auto HH3D là gì?",
    answer:
      "Auto HH3D là nền tảng tự động hoá nhiệm vụ ngày cho hoathinh3d. Bạn cấu hình nhiệm vụ một lần, sau đó khôi lỗi chạy trên server sẽ thay bạn hoàn thành các việc lặp lại hằng ngày và ghi lại nhật ký chi tiết.",
  },
  {
    question: "Tôi có cần mở máy tính hoặc treo trình duyệt không?",
    answer:
      "Không. Khôi lỗi chạy hoàn toàn trên máy chủ đám mây. Sau khi khai đàn, bạn có thể tắt trình duyệt hoặc tắt máy, nhiệm vụ vẫn tiếp tục chạy cho đến khi hoàn thành.",
  },
  {
    question: "Làm sao để bắt đầu sử dụng?",
    answer:
      "Bấm Bái Sư Nhập Môn để tạo tài khoản, chờ trưởng môn duyệt, rồi vào trang Auto để chọn nhiệm vụ và khai đàn. Toàn bộ quá trình chỉ mất vài phút.",
  },
  {
    question: "Tôi theo dõi tiến độ khôi lỗi ở đâu?",
    answer:
      "Trang Auto hiển thị trạng thái từng lượt chạy theo thời gian thực, còn Hàng Đợi Công Việc cho biết vị trí của bạn và thời gian chờ ước tính khi tông môn đông người.",
  },
  {
    question: "Dữ liệu tài khoản của tôi có an toàn không?",
    answer:
      "Mật khẩu được băm một chiều và không bao giờ lưu dạng đọc được. Dữ liệu chỉ dùng để vận hành dịch vụ. Chi tiết cách xử lý dữ liệu và cookie quảng cáo được công khai tại trang Quyền riêng tư.",
  },
  {
    question: "Bế quan trùng tu nghĩa là gì?",
    answer:
      "Đó là thời gian bảo trì khi hệ thống được nâng cấp. Trong lúc bế quan, trang sẽ hiển thị thông báo và thời gian dự kiến mở cửa trở lại; khôi lỗi sẽ tiếp tục làm việc ngay sau đó.",
  },
];

/** Tuyệt đối hoá một đường dẫn về tên miền chính thức — thứ duy nhất được làm canonical. */
export function absoluteUrl(path = "/"): string {
  return new URL(path, SITE_URL).toString();
}

/**
 * JSON-LD cho trang chủ: `Organization` + `WebSite` + `WebApplication` + `FAQPage` trong một
 * `@graph`. FAQ sinh từ `LANDING_FAQ` — đúng mảng trang chủ đang hiển thị.
 */
export function buildLandingJsonLd(): Record<string, unknown> {
  const orgId = `${SITE_URL}/#organization`;
  const siteId = `${SITE_URL}/#website`;
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": orgId,
        name: SITE_NAME,
        url: SITE_URL,
        logo: absoluteUrl("/icon.png"),
      },
      {
        "@type": "WebSite",
        "@id": siteId,
        name: SITE_NAME,
        alternateName: SITE_TITLE,
        url: SITE_URL,
        inLanguage: "vi-VN",
        publisher: { "@id": orgId },
      },
      {
        "@type": "WebApplication",
        name: SITE_NAME,
        url: SITE_URL,
        description: SITE_DESCRIPTION,
        applicationCategory: "GameApplication",
        operatingSystem: "Web",
        inLanguage: "vi-VN",
        image: absoluteUrl(OG_IMAGE.url),
        offers: { "@type": "Offer", price: "0", priceCurrency: "VND" },
        publisher: { "@id": orgId },
      },
      {
        "@type": "FAQPage",
        mainEntity: LANDING_FAQ.map((item) => ({
          "@type": "Question",
          name: item.question,
          acceptedAnswer: { "@type": "Answer", text: item.answer },
        })),
      },
    ],
  };
}

/**
 * Chuỗi hoá JSON-LD để nhét vào `<script type="application/ld+json">`. Thoát `<` để một chuỗi
 * chứa `</script>` không bao giờ đóng thẻ sớm — dữ liệu ở đây là hằng, nhưng hàng rào này rẻ.
 */
export function serializeJsonLd(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
