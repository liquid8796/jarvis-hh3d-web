import { headers } from "next/headers";
import { readSession } from "@/lib/auth/session";
import {
  adcashEnabled,
  ADCASH_AUTOTAG_ZONE_ID,
  ADCASH_LIB_SRC,
} from "@/lib/adcash/config";
import { isAdcashActive } from "@/lib/ads/provider";
import { AdcashClientAds } from "@/components/adcash/AdcashClientAds";

/**
 * Adcash Head Scripts.
 * Nhúng duy nhất Step 1 thư viện aclib và Step 2 AutoTag (qmnntqoxdc) trong <head>.
 * Crawler Adcash sẽ thấy ngay lập tức mã xác thực này trong phản hồi SSR của trang.
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
    </>
  );
}

/**
 * Quản lý quảng cáo Adcash phía Body.
 * Đã bỏ toàn bộ các banner cứng và popunder riêng biệt, chỉ duy trì vùng chứa cho AutoTag.
 */
export async function AdcashAds() {
  const [requestHeaders, session] = await Promise.all([headers(), readSession()]);
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");

  if (!adcashEnabled(host) || !isAdcashActive() || session?.role === "admin") return null;

  return <AdcashClientAds />;
}
