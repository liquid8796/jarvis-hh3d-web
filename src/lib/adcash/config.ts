import { normalizeDomainHost } from "@/lib/domains/catalog";

/**
 * Adcash ad formats configuration (Re-added site zones):
 * 1. Autotag: zoneId 'vaup0kxkvs'
 *    Step 1: <script id="aclib" type="text/javascript" src="//acscdn.com/script/aclib.js"></script>
 *    Step 2: <script type="text/javascript">aclib.runAutoTag({ zoneId: 'vaup0kxkvs' });</script>
 * 2. Pop-Under: zoneId '12265806'
 *    Step 1: <script id="aclib" type="text/javascript" src="//acscdn.com/script/aclib.js"></script>
 *    Step 2: <script type="text/javascript">aclib.runPop({ zoneId: '12265806' });</script>
 * 3. Display 160x600 (Flank Left): zoneId '12265814'
 *    Step 1: <script id="aclib" type="text/javascript" src="//acscdn.com/script/aclib.js"></script>
 *    Step 2: <div><script type="text/javascript">aclib.runBanner({ zoneId: '12265814' });</script></div>
 * 4. Display 160x600 (Flank Right): zoneId '12265822'
 *    Step 1: <script id="aclib" type="text/javascript" src="//acscdn.com/script/aclib.js"></script>
 *    Step 2: <div><script type="text/javascript">aclib.runBanner({ zoneId: '12265822' });</script></div>
 * 5. Display 728x90 (Leaderboard): zoneId '12265830'
 *    Step 1: <script id="aclib" type="text/javascript" src="//acscdn.com/script/aclib.js"></script>
 *    Step 2: <div><script type="text/javascript">aclib.runBanner({ zoneId: '12265830' });</script></div>
 */
export const ADCASH_AUTOTAG_ZONE_ID = "vaup0kxkvs" as const;
export const ADCASH_ZONE_ID = ADCASH_AUTOTAG_ZONE_ID;
export const ADCASH_POPUNDER_ZONE_ID = "12265806" as const;
export const ADCASH_BANNER_160X600_LEFT_ZONE_ID = "12265814" as const;
export const ADCASH_BANNER_160X600_RIGHT_ZONE_ID = "12265822" as const;
export const ADCASH_BANNER_160X600_ZONE_ID = ADCASH_BANNER_160X600_LEFT_ZONE_ID;
export const ADCASH_BANNER_728X90_ZONE_ID = "12265830" as const;

export const ADCASH_BANNER_160X600_WIDTH = 160 as const;
export const ADCASH_BANNER_160X600_HEIGHT = 600 as const;
export const ADCASH_BANNER_728X90_WIDTH = 728 as const;
export const ADCASH_BANNER_728X90_HEIGHT = 90 as const;

export const ADCASH_LIB_SRC = "//acscdn.com/script/aclib.js" as const;

export type AdcashEnvironment = Readonly<Record<string, string | undefined>>;

const DISABLED_VALUES = new Set(["1", "true", "yes", "on"]);
const OFFICIAL_AD_HOSTS = new Set(["auto-hh3d.online", "www.auto-hh3d.online"]);

export function adcashEnabled(
  host: string | null | undefined,
  env: AdcashEnvironment = process.env,
): boolean {
  const disabled = DISABLED_VALUES.has(
    String(env.ADCASH_DISABLED ?? "").trim().toLowerCase(),
  );
  return env.NODE_ENV === "production" && isOfficialAdcashHost(host) && !disabled;
}

export function isOfficialAdcashHost(host: string | null | undefined): boolean {
  return OFFICIAL_AD_HOSTS.has(normalizeDomainHost(host));
}
