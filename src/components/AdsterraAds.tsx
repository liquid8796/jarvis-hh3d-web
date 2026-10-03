import { headers } from "next/headers";
import { readSession } from "@/lib/auth/session";
import {
  ADSTERRA_POPUNDER_SCRIPT_SRC,
  ADSTERRA_SOCIAL_BAR_SCRIPT_SRC,
  adsterraEnabled,
} from "@/lib/adsterra/config";

/**
 * Popunder Adsterra đặt ngay trước thẻ đóng </head>.
 * Tải trên tên miền chính thức auto-hh3d.online cho người dùng/khách; không tải với quản trị viên.
 */
export async function AdsterraPopunder() {
  const [requestHeaders, session] = await Promise.all([headers(), readSession()]);
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");

  if (!adsterraEnabled(host) || session?.role === "admin") return null;

  return (
    <script
      src={ADSTERRA_POPUNDER_SCRIPT_SRC}
      data-adsterra="popunder"
    />
  );
}

/**
 * Social Bar Adsterra đặt ngay trước thẻ đóng </body>.
 * Tải trên tên miền chính thức auto-hh3d.online cho người dùng/khách; không tải với quản trị viên.
 */
export async function AdsterraSocialBar() {
  const [requestHeaders, session] = await Promise.all([headers(), readSession()]);
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");

  if (!adsterraEnabled(host) || session?.role === "admin") return null;

  return (
    <script
      src={ADSTERRA_SOCIAL_BAR_SCRIPT_SRC}
      data-adsterra="social-bar"
    />
  );
}

/**
 * Cung cấp AdsterraAds tương thích ngược.
 */
export async function AdsterraAds() {
  return <AdsterraSocialBar />;
}