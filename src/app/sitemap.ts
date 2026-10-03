import type { MetadataRoute } from "next";
import { absoluteUrl, PUBLIC_SITEMAP_ROUTES } from "@/lib/seo/site";

/**
 * Bản đồ website (sitemap.xml) tiêu chuẩn.
 *
 * Chỉ phát các đường dẫn công khai, tuyệt đối hoá theo tên miền chính thức (OFFICIAL_ORIGIN).
 * Không phụ thuộc cơ sở dữ liệu, dựng tĩnh hoàn toàn.
 */
export function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return PUBLIC_SITEMAP_ROUTES.map((route) => ({
    url: absoluteUrl(route.path),
    lastModified: now,
    changeFrequency: route.changeFrequency,
    priority: route.priority,
  }));
}

export default sitemap;
