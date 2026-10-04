"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import {
  ADCASH_BANNER_160X600_LEFT_ZONE_ID,
  ADCASH_BANNER_160X600_RIGHT_ZONE_ID,
  ADCASH_BANNER_728X90_ZONE_ID,
} from "@/lib/adcash/config";

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

const BANNER_CONFIGS = [
  { id: "adcash-banner-160x600-left", zoneId: ADCASH_BANNER_160X600_LEFT_ZONE_ID },
  { id: "adcash-banner-160x600-right", zoneId: ADCASH_BANNER_160X600_RIGHT_ZONE_ID },
  { id: "adcash-banner-728x90", zoneId: ADCASH_BANNER_728X90_ZONE_ID },
] as const;

/**
 * Adcash Client Ads Component.
 * Cung cấp vùng chứa và hỗ trợ theo dõi quảng cáo Adcash AutoTag, Pop-Under và các banner hiển thị trên trang.
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
    BANNER_CONFIGS.forEach(({ id, zoneId }) => {
      const bannerEl = document.getElementById(id);
      if (bannerEl) {
        bannerEl.style.display = bannerAllowed ? "" : "none";
        if (bannerAllowed && typeof window !== "undefined") {
          const aclib = (window as unknown as { aclib?: { runBanner?: (opts: { zoneId: string }) => void } }).aclib;
          if (aclib?.runBanner && !bannerEl.querySelector("iframe")) {
            try {
              aclib.runBanner({ zoneId });
            } catch {}
          }
        }
      }
    });
  }, [bannerAllowed, pathname]);

  if (!allowed || !mounted) return null;

  return (
    <div id="adcash-ad-container" className="adcash-container" aria-label="Quảng cáo Adcash">
      {/* Vị trí dự phòng cho các định dạng hiển thị Adcash AutoTag và Banner */}
    </div>
  );
}
