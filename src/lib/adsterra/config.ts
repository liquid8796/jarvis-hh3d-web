import { normalizeDomainHost } from "@/lib/domains/catalog";

const DISABLED_VALUES = new Set(["1", "true", "yes", "on"]);
const OFFICIAL_AD_HOSTS = new Set(["auto-hh3d.online", "www.auto-hh3d.online"]);

export type AdsterraEnvironment = Readonly<Record<string, string | undefined>>;

/**
 * Public zone identifiers and tag URLs copied from the authenticated Adsterra publisher panel for
 * site 6090351. They are intentionally visible in page source and do not grant dashboard access.
 */
export const ADSTERRA_SITE_ID = 6090351 as const;
export const ADSTERRA_POPUNDER_SCRIPT_SRC =
  "https://deliberatewatchful.com/43/0d/4f/430d4fbd8d66c3bb0f47cab838ef8a06.js" as const;
export const ADSTERRA_SOCIAL_BAR_SCRIPT_SRC =
  "https://deliberatewatchful.com/97/7a/66/977a66f06e979e2830ee60ed1fa88533.js" as const;

/**
 * Adsterra is enabled only on the official production hostname. Local builds, the retired Vercel
 * tombstone, sslip.io operations access and mirror stations remain ad-free. Set
 * ADSTERRA_DISABLED=1 for an emergency global stop without reverting source.
 */
export function adsterraEnabled(
  host: string | null | undefined,
  env: AdsterraEnvironment = process.env,
): boolean {
  const disabled = DISABLED_VALUES.has(
    String(env.ADSTERRA_DISABLED ?? "").trim().toLowerCase(),
  );
  return env.NODE_ENV === "production" && isOfficialAdsterraHost(host) && !disabled;
}

export function isOfficialAdsterraHost(host: string | null | undefined): boolean {
  return OFFICIAL_AD_HOSTS.has(normalizeDomainHost(host));
}