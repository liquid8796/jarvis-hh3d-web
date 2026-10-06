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
 * Adcash Client Ads Component.
 * Cung cấp vùng chứa hỗ trợ cho Adcash AutoTag (qmnntqoxdc).
 */
export function AdcashClientAds() {
  const pathname = usePathname();
  const allowed = pathAllowsAds(pathname);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!allowed || !mounted) return null;

  return (
    <div id="adcash-ad-container" className="adcash-container" aria-label="Quảng cáo Adcash">
      {/* Vị trí dự phòng cho các định dạng hiển thị động của Adcash AutoTag */}
    </div>
  );
}
