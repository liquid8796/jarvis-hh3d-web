import { headers } from "next/headers";
import {
  GOOGLE_TAG_ID,
  GOOGLE_TAG_SCRIPT_SRC,
  googleTagEnabled,
} from "@/lib/google-tag/config";

/**
 * Thẻ Google tag (gtag.js) cho tài khoản Google Analytics/Google Tag Manager:
 * Đặt ngay sau thẻ mở <head> trên mỗi trang của website.
 */
export async function GoogleTag() {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");

  if (!googleTagEnabled(host)) return null;

  return (
    <>
      <script async src={GOOGLE_TAG_SCRIPT_SRC} />
      <script
        id="google-tag-init"
        dangerouslySetInnerHTML={{
          __html: `window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config', '${GOOGLE_TAG_ID}');`,
        }}
      />
    </>
  );
}
