import { normalizeDomainHost } from "@/lib/domains/catalog";

/**
 * Adcash ad formats configuration:
 * 1. AutoTag: zoneId 's6snqbi4sg'
 * 2. Pop-Under: zoneId '12265546'
 *    Step 1: <script id="aclib" type="text/javascript" src="//acscdn.com/script/aclib.js"></script>
 *    Step 2: <script type="text/javascript">aclib.runPop({ zoneId: '12265546' });</script>
 * 3. Display 160x600: zoneId '12265554'
 *    Step 1: <script id="aclib" type="text/javascript" src="//acscdn.com/script/aclib.js"></script>
 *    Step 2: <div><script type="text/javascript">aclib.runBanner({ zoneId: '12265554' });</script></div>
 */
export const ADCASH_AUTOTAG_ZONE_ID = "s6snqbi4sg" as const;
export const ADCASH_ZONE_ID = ADCASH_AUTOTAG_ZONE_ID;
export const ADCASH_POPUNDER_ZONE_ID = "12265546" as const;
export const ADCASH_BANNER_160X600_ZONE_ID = "12265554" as const;
export const ADCASH_BANNER_160X600_WIDTH = 160 as const;
export const ADCASH_BANNER_160X600_HEIGHT = 600 as const;
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
