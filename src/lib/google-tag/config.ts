import { normalizeDomainHost } from "@/lib/domains/catalog";

export const GOOGLE_TAG_ID = "G-CPEZWQKMNB" as const;
export const GOOGLE_TAG_SCRIPT_SRC =
  `https://www.googletagmanager.com/gtag/js?id=${GOOGLE_TAG_ID}` as const;

export type GoogleTagEnvironment = Readonly<Record<string, string | undefined>>;

const DISABLED_VALUES = new Set(["1", "true", "yes", "on"]);
const OFFICIAL_TAG_HOSTS = new Set(["auto-hh3d.online", "www.auto-hh3d.online"]);

export function isOfficialGoogleTagHost(host: string | null | undefined): boolean {
  return OFFICIAL_TAG_HOSTS.has(normalizeDomainHost(host));
}

/**
 * Thẻ Google (gtag.js / Google Analytics GA4).
 * Chỉ phục vụ trên tên miền chính thức ở môi trường production.
 * Có thể đặt GOOGLE_TAG_DISABLED=1 để dừng khẩn cấp, hoặc GOOGLE_TAG_DEV=1 để thử nghiệm ở dev.
 */
export function googleTagEnabled(
  host: string | null | undefined,
  env: GoogleTagEnvironment = process.env,
): boolean {
  const disabled = DISABLED_VALUES.has(
    String(env.GOOGLE_TAG_DISABLED ?? "").trim().toLowerCase(),
  );
  if (disabled) return false;
  if (env.GOOGLE_TAG_DEV === "1") return true;
  return env.NODE_ENV === "production" && isOfficialGoogleTagHost(host);
}
