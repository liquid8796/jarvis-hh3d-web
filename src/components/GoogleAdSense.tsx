import { headers } from "next/headers";
import { readSession } from "@/lib/auth/session";
import {
  GOOGLE_ADSENSE_CLIENT_ID,
  GOOGLE_ADSENSE_SCRIPT_SRC,
  googleAdSenseEnabled,
  isOfficialAdSenseHost,
} from "@/lib/adsense/config";
import { isAdSenseActive } from "@/lib/ads/provider";

/**
 * Loads the public AdSense account marker on the official host and the Auto ads script for
 * non-admin production sessions. Administrator sessions stay ad-free to reduce accidental owner
 * clicks while operating the site. A Google API key is unrelated to this browser snippet.
 */
export async function GoogleAdSense() {
  const [requestHeaders, session] = await Promise.all([headers(), readSession()]);
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");

  if (!isOfficialAdSenseHost(host) || !isAdSenseActive()) return null;

  return (
    <>
      <meta name="google-adsense-account" content={GOOGLE_ADSENSE_CLIENT_ID} />
      {googleAdSenseEnabled(host) && session?.role !== "admin" && (
        <script
          async
          crossOrigin="anonymous"
          data-ad-client={GOOGLE_ADSENSE_CLIENT_ID}
          src={GOOGLE_ADSENSE_SCRIPT_SRC}
        />
      )}
    </>
  );
}