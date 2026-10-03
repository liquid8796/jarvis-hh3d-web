import { normalizeDomainHost } from "@/lib/domains/catalog";

const DISABLED_VALUES = new Set(["1", "true", "yes", "on"]);
const OFFICIAL_AD_HOSTS = new Set(["auto-hh3d.online", "www.auto-hh3d.online"]);

export type AdsterraEnvironment = Readonly<Record<string, string | undefined>>;

/**
 * Public zone identifiers and tag URLs copied from the authenticated Adsterra publisher panel for
 * site 6090351. They are intentionally visible in page source and do not grant dashboard access.
 */
export const ADSTERRA_SITE_ID = 6090351 as const;
export const ADSTERRA_LEADERBOARD_KEY = "5f0b1341593afd724f2bd2cd211c6b73" as const;
export const ADSTERRA_LEADERBOARD_WIDTH = 728 as const;
export const ADSTERRA_LEADERBOARD_HEIGHT = 90 as const;
export const ADSTERRA_LEADERBOARD_SCRIPT_SRC =
  `https://deliberatewatchful.com/${ADSTERRA_LEADERBOARD_KEY}/invoke.js` as const;

export const ADSTERRA_BANNER_468X60_KEY = "58ea5fb15ce0c0db62dd342b49cc0c09" as const;
export const ADSTERRA_BANNER_468X60_WIDTH = 468 as const;
export const ADSTERRA_BANNER_468X60_HEIGHT = 60 as const;
export const ADSTERRA_BANNER_468X60_SCRIPT_SRC =
  `https://deliberatewatchful.com/${ADSTERRA_BANNER_468X60_KEY}/invoke.js` as const;

export const ADSTERRA_BANNER_320X50_KEY = "bc0a7a3ea5179c58561c3533681bd724" as const;
export const ADSTERRA_BANNER_320X50_WIDTH = 320 as const;
export const ADSTERRA_BANNER_320X50_HEIGHT = 50 as const;
export const ADSTERRA_BANNER_320X50_SCRIPT_SRC =
  `https://deliberatewatchful.com/${ADSTERRA_BANNER_320X50_KEY}/invoke.js` as const;

export const ADSTERRA_BANNER_300X250_KEY = "aef3014b1366e74e02e2a6077acacbd5" as const;
export const ADSTERRA_BANNER_300X250_WIDTH = 300 as const;
export const ADSTERRA_BANNER_300X250_HEIGHT = 250 as const;
export const ADSTERRA_BANNER_300X250_SCRIPT_SRC =
  `https://deliberatewatchful.com/${ADSTERRA_BANNER_300X250_KEY}/invoke.js` as const;

export const ADSTERRA_BANNER_160X600_KEY = "1ac6ab6e1c65f90e0ba12414861b5fc1" as const;
export const ADSTERRA_BANNER_160X600_WIDTH = 160 as const;
export const ADSTERRA_BANNER_160X600_HEIGHT = 600 as const;
export const ADSTERRA_BANNER_160X600_SCRIPT_SRC =
  `https://deliberatewatchful.com/${ADSTERRA_BANNER_160X600_KEY}/invoke.js` as const;

export const ADSTERRA_BANNER_160X300_KEY = "5fa61640659a25e53bad269fbbed6304" as const;
export const ADSTERRA_BANNER_160X300_WIDTH = 160 as const;
export const ADSTERRA_BANNER_160X300_HEIGHT = 300 as const;
export const ADSTERRA_BANNER_160X300_SCRIPT_SRC =
  `https://deliberatewatchful.com/${ADSTERRA_BANNER_160X300_KEY}/invoke.js` as const;

export const ADSTERRA_NATIVE_CONTAINER_ID =
  "container-5e6634da84f8f263d7ab34ae152f1c8d" as const;
export const ADSTERRA_NATIVE_SCRIPT_SRC =
  "https://deliberatewatchful.com/5e6634da84f8f263d7ab34ae152f1c8d/invoke.js" as const;
export const ADSTERRA_POPUNDER_SCRIPT_SRC =
  "https://deliberatewatchful.com/43/0d/4f/430d4fbd8d66c3bb0f47cab838ef8a06.js" as const;
export const ADSTERRA_SOCIAL_BAR_SCRIPT_SRC =
  "https://deliberatewatchful.com/97/7a/66/977a66f06e979e2830ee60ed1fa88533.js" as const;
export const ADSTERRA_SMARTLINK_URL =
  "https://deliberatewatchful.com/ndimkb9kxi?key=f06720140b3b11ad092d96fa65ca5110" as const;

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