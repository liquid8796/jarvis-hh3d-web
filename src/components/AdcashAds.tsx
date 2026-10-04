import { headers } from "next/headers";
import { readSession } from "@/lib/auth/session";
import { adcashEnabled, ADCASH_ZONE_ID, ADCASH_LIB_SRC } from "@/lib/adcash/config";
import { isAdcashActive } from "@/lib/ads/provider";
import { AdcashClientAds } from "@/components/adcash/AdcashClientAds";

/**
 * Adcash Head Scripts.
 * Renders the Step 1 library script and Step 2 AutoTag script inside <head>.
 * This ensures the Adcash approval crawler finds the tags immediately in the raw SSR response.
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
    </>
  );
}

/**
 * Server gate for Adcash Body Placements.
 */
export async function AdcashAds() {
  const [requestHeaders, session] = await Promise.all([headers(), readSession()]);
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");

  if (!adcashEnabled(host) || !isAdcashActive() || session?.role === "admin") return null;
  return <AdcashClientAds />;
}
