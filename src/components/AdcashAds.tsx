import { headers } from "next/headers";
import { readSession } from "@/lib/auth/session";
import {
  adcashEnabled,
  ADCASH_AUTOTAG_ZONE_ID,
  ADCASH_POPUNDER_ZONE_ID,
  ADCASH_BANNER_160X600_LEFT_ZONE_ID,
  ADCASH_BANNER_160X600_RIGHT_ZONE_ID,
  ADCASH_BANNER_728X90_ZONE_ID,
  ADCASH_LIB_SRC,
} from "@/lib/adcash/config";
import { isAdcashActive } from "@/lib/ads/provider";
import { AdcashClientAds } from "@/components/adcash/AdcashClientAds";

/**
 * Adcash Head Scripts.
 * Renders the Step 1 library script, Step 2 AutoTag (vaup0kxkvs), and Pop-Under (12265806) script inside <head>.
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
    zoneId: '${ADCASH_AUTOTAG_ZONE_ID}',
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
 * Renders:
 * - Display 160x600 Flank Left (12265814)
 * - Display 160x600 Flank Right (12265822)
 * - Display 728x90 Leaderboard (12265830)
 * within enclosing <div> elements as recommended by Adcash, followed by the client manager.
 */
export async function AdcashAds() {
  const [requestHeaders, session] = await Promise.all([headers(), readSession()]);
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");

  if (!adcashEnabled(host) || !isAdcashActive() || session?.role === "admin") return null;

  return (
    <>
      {/* 1. Biểu ngữ sườn trái 160x600 */}
      <div
        id="adcash-banner-160x600-left"
        className="adcash-flank adcash-flank-left adcash-banner-160x600"
        aria-label="Quảng cáo Adcash sườn trái 160x600"
        suppressHydrationWarning
      >
        <script
          type="text/javascript"
          dangerouslySetInnerHTML={{
            __html: `aclib.runBanner({
    zoneId: '${ADCASH_BANNER_160X600_LEFT_ZONE_ID}',
});`,
          }}
        />
      </div>

      {/* 2. Biểu ngữ sườn phải 160x600 */}
      <div
        id="adcash-banner-160x600-right"
        className="adcash-flank adcash-flank-right adcash-banner-160x600"
        aria-label="Quảng cáo Adcash sườn phải 160x600"
        suppressHydrationWarning
      >
        <script
          type="text/javascript"
          dangerouslySetInnerHTML={{
            __html: `aclib.runBanner({
    zoneId: '${ADCASH_BANNER_160X600_RIGHT_ZONE_ID}',
});`,
          }}
        />
      </div>

      {/* 3. Biểu ngữ chính 728x90 Leaderboard */}
      <div
        id="adcash-banner-728x90"
        className="adcash-leaderboard"
        aria-label="Quảng cáo Adcash biểu ngữ 728x90"
        suppressHydrationWarning
      >
        <script
          type="text/javascript"
          dangerouslySetInnerHTML={{
            __html: `aclib.runBanner({
    zoneId: '${ADCASH_BANNER_728X90_ZONE_ID}',
});`,
          }}
        />
      </div>

      <AdcashClientAds />
    </>
  );
}
