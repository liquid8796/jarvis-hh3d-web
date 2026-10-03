import { headers } from "next/headers";
import { readSession } from "@/lib/auth/session";
import { adsterraEnabled } from "@/lib/adsterra/config";
import { AdsterraClientAds } from "@/components/adsterra/AdsterraClientAds";

/**
 * Server gate for Adsterra. The official production host may render ads for guests and regular
 * users; administrator sessions remain ad-free to prevent accidental publisher clicks.
 */
export async function AdsterraAds() {
  const [requestHeaders, session] = await Promise.all([headers(), readSession()]);
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");

  if (!adsterraEnabled(host) || session?.role === "admin") return null;
  return <AdsterraClientAds />;
}