"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { ADCASH_BANNER_160X600_ZONE_ID } from "@/lib/adcash/config";

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

function pathAllowsBanner(pathname: string): boolean {
  return pathname === "/";
}

/**
 * Adcash Client Ads Component.
 * Cung cấp vùng chứa và hỗ trợ theo dõi quảng cáo Adcash AutoTag, Pop-Under và Banner 160x600 trên trang.
 */
export function AdcashClientAds() {
  const pathname = usePathname();
  const allowed = pathAllowsAds(pathname);
  const bannerAllowed = pathAllowsBanner(pathname);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    const bannerEl = document.getElementById("adcash-banner-160x600");
    if (bannerEl) {
      bannerEl.style.display = bannerAllowed ? "" : "none";
      if (bannerAllowed && typeof window !== "undefined") {
        const aclib = (window as unknown as { aclib?: { runBanner?: (opts: { zoneId: string }) => void } }).aclib;
        if (aclib?.runBanner && !bannerEl.querySelector("iframe")) {
          try {
            aclib.runBanner({ zoneId: ADCASH_BANNER_160X600_ZONE_ID });
          } catch {}
        }
      }
    }
  }, [bannerAllowed, pathname]);

  if (!allowed || !mounted) return null;

  return (
    <div id="adcash-ad-container" className="adcash-container" aria-label="Quảng cáo Adcash">
      {/* Vị trí dự phòng cho các định dạng hiển thị Adcash AutoTag và Banner */}
    </div>
  );
}
