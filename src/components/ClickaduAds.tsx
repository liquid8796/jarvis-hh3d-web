import { headers } from "next/headers";
import { readSession } from "@/lib/auth/session";
import { clickaduEnabled } from "@/lib/clickadu/config";
import { isClickaduActive } from "@/lib/ads/provider";
import { ClickaduClientAds } from "@/components/clickadu/ClickaduClientAds";

/**
 * Server gate for Clickadu. The official production host may render ads for guests and regular
 * users; administrator sessions remain ad-free to prevent accidental publisher clicks.
 */
export async function ClickaduAds() {
  const [requestHeaders, session] = await Promise.all([headers(), readSession()]);
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");

  if (!clickaduEnabled(host) || !isClickaduActive() || session?.role === "admin") return null;
  return <ClickaduClientAds />;
}
