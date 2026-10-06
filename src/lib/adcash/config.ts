import { normalizeDomainHost } from "@/lib/domains/catalog";

/**
 * Cấu hình mạng quảng cáo Adcash:
 * Duy nhất AutoTag (zoneId: 'qmnntqoxdc') theo yêu cầu phê duyệt trang web.
 *
 * Bước 1: <script id="aclib" type="text/javascript" src="//acscdn.com/script/aclib.js"></script>
 * Bước 2: <script type="text/javascript">aclib.runAutoTag({ zoneId: 'qmnntqoxdc' });</script>
 */
export const ADCASH_AUTOTAG_ZONE_ID = "qmnntqoxdc" as const;
export const ADCASH_ZONE_ID = ADCASH_AUTOTAG_ZONE_ID;

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
