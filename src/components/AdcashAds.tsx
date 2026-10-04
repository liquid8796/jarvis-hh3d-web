import { headers } from "next/headers";
import { readSession } from "@/lib/auth/session";
import {
  adcashEnabled,
  ADCASH_ZONE_ID,
  ADCASH_POPUNDER_ZONE_ID,
  ADCASH_BANNER_160X600_ZONE_ID,
  ADCASH_LIB_SRC,
} from "@/lib/adcash/config";
import { isAdcashActive } from "@/lib/ads/provider";
import { AdcashClientAds } from "@/components/adcash/AdcashClientAds";

/**
 * Adcash Head Scripts.
 * Renders the Step 1 library script, Step 2 AutoTag, and Pop-Under (12265546) script inside <head>.
 * This ensures the Adcash approval crawler finds all tags immediately in the raw SSR response.
 */
export async function AdcashHead() {
  const [requestHeaders, session] = await Promise.all([headers(), readSession()]);
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");

  if (!adcashEnabled(host) || !isAdcashActive() || session?.role === "admin") return null;

  return (
    <>
      <script id="aclib" type="text/javascript" src={ADCASH_LIB_SRC} />
      <script
        type="text/javascript"
        dangerouslySetInnerHTML={{
          __html: `aclib.runAutoTag({
    zoneId: '${ADCASH_ZONE_ID}',
});`,
        }}
      />
      <script
        type="text/javascript"
        dangerouslySetInnerHTML={{
          __html: `aclib.runPop({
    zoneId: '${ADCASH_POPUNDER_ZONE_ID}',
});`,
        }}
      />
    </>
  );
}

/**
 * Server gate for Adcash Body Placements.
 * Renders the Display 160x600 banner (12265554) within an enclosing <div> as recommended by Adcash,
 * followed by the client manager for route-aware visibility and fallback.
 */
export async function AdcashAds() {
  const [requestHeaders, session] = await Promise.all([headers(), readSession()]);
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");

  if (!adcashEnabled(host) || !isAdcashActive() || session?.role === "admin") return null;

  return (
    <>
      <div
        id="adcash-banner-160x600"
        className="adcash-banner-160x600"
        aria-label="Quảng cáo Adcash 160x600"
        suppressHydrationWarning
      >
        <script
          type="text/javascript"
          dangerouslySetInnerHTML={{
            __html: `aclib.runBanner({
    zoneId: '${ADCASH_BANNER_160X600_ZONE_ID}',
});`,
          }}
        />
      </div>
      <AdcashClientAds />
    </>
  );
}
