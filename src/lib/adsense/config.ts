import { normalizeDomainHost } from "@/lib/domains/catalog";

const DISABLED_VALUES = new Set(["1", "true", "yes", "on"]);
const OFFICIAL_AD_HOSTS = new Set(["auto-hh3d.online", "www.auto-hh3d.online"]);

export type AdSenseEnvironment = Readonly<Record<string, string | undefined>>;

/**
 * Public Google AdSense identifiers. These values are intentionally visible in page source and
 * ads.txt; they do not authorize the AdSense Management API. API keys and OAuth tokens must never
 * be added here.
 */
export const GOOGLE_ADSENSE_PUBLISHER_ID = "pub-7851683096379872" as const;
export const GOOGLE_ADSENSE_CLIENT_ID = `ca-${GOOGLE_ADSENSE_PUBLISHER_ID}` as const;
export const GOOGLE_ADSENSE_SCRIPT_SRC =
  `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${GOOGLE_ADSENSE_CLIENT_ID}` as const;
export const GOOGLE_ADSENSE_ADS_TXT_LINE =
  `google.com, ${GOOGLE_ADSENSE_PUBLISHER_ID}, DIRECT, f08c47fec0942fa0` as const;

/**
 * Auto ads are served only on the official production hostname. Local builds, the retired Vercel
 * tombstone, sslip.io operations access and mirror stations stay ad-free. Set
 * GOOGLE_ADSENSE_DISABLED=1 for an emergency global stop without a code rollback.
 */
export function googleAdSenseEnabled(
  host: string | null | undefined,
  env: AdSenseEnvironment = process.env,
): boolean {
  const disabled = DISABLED_VALUES.has(
    String(env.GOOGLE_ADSENSE_DISABLED ?? "").trim().toLowerCase(),
  );
  return env.NODE_ENV === "production" && isOfficialAdSenseHost(host) && !disabled;
}

export function isOfficialAdSenseHost(host: string | null | undefined): boolean {
  return OFFICIAL_AD_HOSTS.has(normalizeDomainHost(host));
}