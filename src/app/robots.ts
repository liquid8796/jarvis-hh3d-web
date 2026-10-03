import type { MetadataRoute } from "next";
import { ROBOTS_DISALLOW, SITE_URL } from "@/lib/seo/site";

/**
 * Chỉ dẫn bot thu thập dữ liệu (Googlebot, Bingbot, AdSense crawler...).
 *
 * Mở cửa các trang công khai (/, /quyen-rieng-tu, /ten-mien, /login, /register).
 * Chặn triệt để các tiền tố cần đăng nhập, API và khung nhúng để tránh bot phí crawl budget
 * và tránh lỗi đánh giá nội dung rỗng / trang lỗi từ Google.
 */
export function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [...ROBOTS_DISALLOW],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}

export default robots;
