"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

const EXCLUDED_PATH_PREFIXES = [
  "/admin",
  "/chat-frame",
  "/login",
  "/pending",
  "/quyen-rieng-tu",
  "/register",
] as const;

function pathAllowsAds(pathname: string): boolean {
  return !EXCLUDED_PATH_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

/**
 * Clickadu Client Ads Component.
 * Sẵn sàng tiếp nhận các định dạng quảng cáo Clickadu (Popunder OnClick, Banner, In-Page Push...)
 * ngay khi trang web được Clickadu phê duyệt chính thức.
 */
export function ClickaduClientAds() {
  const pathname = usePathname();
  const allowed = pathAllowsAds(pathname);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!allowed || !mounted) return null;

  return (
    <div id="clickadu-ad-container" className="clickadu-container" aria-label="Quảng cáo Clickadu">
      {/* Vị trí dự phòng sẵn sàng cho mã nhúng Clickadu sau khi được duyệt */}
    </div>
  );
}
