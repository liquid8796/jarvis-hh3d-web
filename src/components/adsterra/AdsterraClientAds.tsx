"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import {
  ADSTERRA_LEADERBOARD_KEY,
  ADSTERRA_LEADERBOARD_WIDTH,
  ADSTERRA_LEADERBOARD_HEIGHT,
  ADSTERRA_LEADERBOARD_SCRIPT_SRC,
  ADSTERRA_BANNER_468X60_KEY,
  ADSTERRA_BANNER_468X60_WIDTH,
  ADSTERRA_BANNER_468X60_HEIGHT,
  ADSTERRA_BANNER_468X60_SCRIPT_SRC,
  ADSTERRA_BANNER_320X50_KEY,
  ADSTERRA_BANNER_320X50_WIDTH,
  ADSTERRA_BANNER_320X50_HEIGHT,
  ADSTERRA_BANNER_320X50_SCRIPT_SRC,
  ADSTERRA_BANNER_300X250_KEY,
  ADSTERRA_BANNER_300X250_WIDTH,
  ADSTERRA_BANNER_300X250_HEIGHT,
  ADSTERRA_BANNER_300X250_SCRIPT_SRC,
  ADSTERRA_BANNER_160X600_KEY,
  ADSTERRA_BANNER_160X600_WIDTH,
  ADSTERRA_BANNER_160X600_HEIGHT,
  ADSTERRA_BANNER_160X600_SCRIPT_SRC,
  ADSTERRA_BANNER_160X300_KEY,
  ADSTERRA_BANNER_160X300_WIDTH,
  ADSTERRA_BANNER_160X300_HEIGHT,
  ADSTERRA_BANNER_160X300_SCRIPT_SRC,
  ADSTERRA_NATIVE_CONTAINER_ID,
  ADSTERRA_NATIVE_SCRIPT_SRC,
  ADSTERRA_POPUNDER_SCRIPT_SRC,
  ADSTERRA_SMARTLINK_URL,
  ADSTERRA_SOCIAL_BAR_SCRIPT_SRC,
} from "@/lib/adsterra/config";

const EXCLUDED_PATH_PREFIXES = [
  "/admin",
  "/chat-frame",
  "/login",
  "/pending",
  "/quyen-rieng-tu",
  "/register",
] as const;

type AdSlotStatus = "loading" | "ready" | "blocked";

interface BannerSpec {
  id: string;
  adKey: string;
  width: number;
  height: number;
  scriptSrc: string;
  className: string;
  ariaLabel: string;
}

const BANNER_LEADERBOARD_SPEC: BannerSpec = {
  id: "leaderboard",
  adKey: ADSTERRA_LEADERBOARD_KEY,
  width: ADSTERRA_LEADERBOARD_WIDTH,
  height: ADSTERRA_LEADERBOARD_HEIGHT,
  scriptSrc: ADSTERRA_LEADERBOARD_SCRIPT_SRC,
  className: "adsterra-leaderboard",
  ariaLabel: "Quảng cáo biểu ngữ 728×90",
};

const BANNER_468X60_SPEC: BannerSpec = {
  id: "banner-468x60",
  adKey: ADSTERRA_BANNER_468X60_KEY,
  width: ADSTERRA_BANNER_468X60_WIDTH,
  height: ADSTERRA_BANNER_468X60_HEIGHT,
  scriptSrc: ADSTERRA_BANNER_468X60_SCRIPT_SRC,
  className: "adsterra-banner-468x60",
  ariaLabel: "Quảng cáo biểu ngữ 468×60",
};

const BANNER_320X50_SPEC: BannerSpec = {
  id: "banner-320x50",
  adKey: ADSTERRA_BANNER_320X50_KEY,
  width: ADSTERRA_BANNER_320X50_WIDTH,
  height: ADSTERRA_BANNER_320X50_HEIGHT,
  scriptSrc: ADSTERRA_BANNER_320X50_SCRIPT_SRC,
  className: "adsterra-banner-320x50",
  ariaLabel: "Quảng cáo biểu ngữ 320×50",
};

const BANNER_300X250_SPEC: BannerSpec = {
  id: "banner-300x250",
  adKey: ADSTERRA_BANNER_300X250_KEY,
  width: ADSTERRA_BANNER_300X250_WIDTH,
  height: ADSTERRA_BANNER_300X250_HEIGHT,
  scriptSrc: ADSTERRA_BANNER_300X250_SCRIPT_SRC,
  className: "adsterra-banner-300x250",
  ariaLabel: "Quảng cáo chữ nhật 300×250",
};

const BANNER_160X600_SPEC: BannerSpec = {
  id: "banner-160x600",
  adKey: ADSTERRA_BANNER_160X600_KEY,
  width: ADSTERRA_BANNER_160X600_WIDTH,
  height: ADSTERRA_BANNER_160X600_HEIGHT,
  scriptSrc: ADSTERRA_BANNER_160X600_SCRIPT_SRC,
  className: "adsterra-banner-160x600",
  ariaLabel: "Quảng cáo dọc 160×600",
};

const BANNER_160X300_SPEC: BannerSpec = {
  id: "banner-160x300",
  adKey: ADSTERRA_BANNER_160X300_KEY,
  width: ADSTERRA_BANNER_160X300_WIDTH,
  height: ADSTERRA_BANNER_160X300_HEIGHT,
  scriptSrc: ADSTERRA_BANNER_160X300_SCRIPT_SRC,
  className: "adsterra-banner-160x300",
  ariaLabel: "Quảng cáo dọc 160×300",
};

function pathAllowsAds(pathname: string): boolean {
  return !EXCLUDED_PATH_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function appendGlobalScriptOnce(src: string, marker: string): void {
  if (document.querySelector(`script[data-adsterra-global="${marker}"]`)) return;
  const script = document.createElement("script");
  script.src = src;
  script.async = false;
  script.dataset.adsterraGlobal = marker;
  document.body.appendChild(script);
}

function watchForRenderedAd(
  root: HTMLElement,
  isReady: () => boolean,
  onReady: () => void,
  onBlocked: () => void,
): () => void {
  let settled = false;
  let timer = 0;

  const observer = new MutationObserver(() => {
    if (!settled && isReady()) settle("ready");
  });

  function settle(status: Exclude<AdSlotStatus, "loading">) {
    if (settled) return;
    settled = true;
    observer.disconnect();
    window.clearTimeout(timer);
    if (status === "ready") onReady();
    else onBlocked();
  }

  observer.observe(root, { childList: true, subtree: true });
  timer = window.setTimeout(() => settle("blocked"), 8_000);
  if (isReady()) settle("ready");

  return () => {
    settled = true;
    observer.disconnect();
    window.clearTimeout(timer);
  };
}

function fitBannerToSlot(slot: HTMLElement, width: number, height: number): () => void {
  const update = () => {
    const scale = Math.min(1, Math.max(0, slot.clientWidth / width));
    slot.style.setProperty("--adsterra-scale", scale.toFixed(4));
    slot.style.setProperty("--adsterra-leaderboard-scale", scale.toFixed(4));
    slot.style.height = `${Math.ceil(height * scale)}px`;
  };

  const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
  observer?.observe(slot);
  window.addEventListener("resize", update);
  update();

  return () => {
    observer?.disconnect();
    window.removeEventListener("resize", update);
    slot.style.removeProperty("--adsterra-scale");
    slot.style.removeProperty("--adsterra-leaderboard-scale");
    slot.style.removeProperty("height");
  };
}

/**
 * Hàng đợi nạp tuần tự script cho các banner iframe Adsterra để triệt tiêu
 * hoàn toàn hiện tượng ghi đè biến toàn cục window.atOptions.
 */
let bannerMountQueue = Promise.resolve();

function enqueueBannerMount(loadFn: () => Promise<void>): Promise<void> {
  const next = bannerMountQueue.then(loadFn, loadFn);
  bannerMountQueue = next.catch(() => {});
  return next;
}

function AdsterraBannerSlot({
  spec,
  allowed,
  pathname,
}: {
  spec: BannerSpec;
  allowed: boolean;
  pathname: string;
}) {
  const slotRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<AdSlotStatus>("loading");

  useEffect(() => {
    const slot = slotRef.current;
    if (!allowed || !slot) return;

    let active = true;
    setStatus("loading");

    const canvas = document.createElement("div");
    canvas.className = spec.id === "leaderboard"
      ? "adsterra-leaderboard-canvas adsterra-banner-canvas"
      : `adsterra-banner-canvas adsterra-canvas-${spec.id}`;
    canvas.style.width = `${spec.width}px`;
    canvas.style.height = `${spec.height}px`;
    slot.replaceChildren(canvas);

    const stopFitting = fitBannerToSlot(slot, spec.width, spec.height);

    const markBlocked = () => {
      if (active) setStatus("blocked");
    };

    let invokeScript: HTMLScriptElement | null = null;

    enqueueBannerMount(async () => {
      if (!active || !canvas.isConnected) return;

      const options = document.createElement("script");
      options.text = `window.atOptions = ${JSON.stringify({
        key: spec.adKey,
        format: "iframe",
        height: spec.height,
        width: spec.width,
        params: {},
      })};`;

      const invoke = document.createElement("script");
      invoke.src = spec.scriptSrc;
      invoke.async = false;
      invoke.dataset.adsterraPlacement = spec.id;
      invokeScript = invoke;

      const loadedPromise = new Promise<void>((resolve) => {
        invoke.addEventListener("load", () => resolve(), { once: true });
        invoke.addEventListener("error", () => {
          markBlocked();
          resolve();
        }, { once: true });
        setTimeout(resolve, 2000);
      });

      canvas.append(options, invoke);
      await loadedPromise;
    });

    const stopWatching = watchForRenderedAd(
      canvas,
      () => Boolean(canvas.querySelector("iframe")),
      () => {
        if (active) setStatus("ready");
      },
      markBlocked,
    );

    return () => {
      active = false;
      stopWatching();
      stopFitting();
      if (invokeScript) invokeScript.removeEventListener("error", markBlocked);
      slot.replaceChildren();
    };
  }, [allowed, pathname, spec]);

  if (!allowed) return null;

  return (
    <div
      ref={slotRef}
      className={`adsterra-unit adsterra-banner ${spec.className}`}
      data-status={status}
      data-placement={spec.id}
      aria-label={spec.ariaLabel}
    />
  );
}

/**
 * Nhúng đầy đủ 10 định dạng quảng cáo chính thức từ Adsterra:
 * 1. Popunder script (mở tab ngầm khi click)
 * 2. Social Bar script (thông báo / bong bóng nổi)
 * 3. Leaderboard 728×90 (biểu ngữ ngang desktop)
 * 4. Classic Banner 468×60 (biểu ngữ ngang tablet / trung bình)
 * 5. Mobile Banner 320×50 (biểu ngữ ngang mobile)
 * 6. Medium Rectangle 300×250 (hình chữ nhật đa dụng)
 * 7. Wide Skyscraper 160×600 (banner dọc cao)
 * 8. Half Skyscraper 160×300 (banner dọc ngắn)
 * 9. Native Banner 4:1 (đề xuất nội dung tự nhiên)
 * 10. Smartlink (liên kết tài trợ trực tiếp)
 */
import { createPortal } from "react-dom";

export function AdsterraClientAds() {
  const pathname = usePathname();
  const nativeRef = useRef<HTMLDivElement>(null);
  const [nativeStatus, setNativeStatus] = useState<AdSlotStatus>("loading");
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  const allowed = pathAllowsAds(pathname);

  useEffect(() => {
    if (!allowed) return;
    appendGlobalScriptOnce(ADSTERRA_POPUNDER_SCRIPT_SRC, "popunder");
    appendGlobalScriptOnce(ADSTERRA_SOCIAL_BAR_SCRIPT_SRC, "social-bar");
  }, [allowed]);

  useEffect(() => {
    if (pathname === "/") {
      const el = document.getElementById("landing-ad-placement");
      setPortalTarget(el);
    } else {
      setPortalTarget(null);
    }
  }, [pathname]);

  useEffect(() => {
    const slot = nativeRef.current;
    if (!allowed || !slot) return;

    let active = true;
    setNativeStatus("loading");
    slot.replaceChildren();

    const markBlocked = () => {
      if (active) setNativeStatus("blocked");
    };
    const invoke = document.createElement("script");
    invoke.src = ADSTERRA_NATIVE_SCRIPT_SRC;
    invoke.async = true;
    invoke.dataset.cfasync = "false";
    invoke.dataset.adsterraPlacement = "native";
    invoke.addEventListener("error", markBlocked, { once: true });
    const container = document.createElement("div");
    container.id = ADSTERRA_NATIVE_CONTAINER_ID;
    slot.append(invoke, container);

    const stopWatching = watchForRenderedAd(
      slot,
      () => container.childElementCount > 0,
      () => {
        if (active) setNativeStatus("ready");
      },
      markBlocked,
    );

    return () => {
      active = false;
      stopWatching();
      invoke.removeEventListener("error", markBlocked);
      slot.replaceChildren();
    };
  }, [allowed, pathname]);

  if (!allowed) return null;

  const mainStack = (
    <aside className="adsterra-stack" aria-label="Quảng cáo tài trợ">
      {/* 1. Biểu ngữ chính 728×90 */}
      <AdsterraBannerSlot spec={BANNER_LEADERBOARD_SPEC} allowed={allowed} pathname={pathname} />

      {/* 2. Dãy biểu ngữ phụ 468×60 & 320×50 */}
      <div className="adsterra-row-banners">
        <AdsterraBannerSlot spec={BANNER_468X60_SPEC} allowed={allowed} pathname={pathname} />
        <AdsterraBannerSlot spec={BANNER_320X50_SPEC} allowed={allowed} pathname={pathname} />
      </div>

      {/* 3. Khối trung tâm: 300×250 & Native Ads */}
      <div className="adsterra-center-column mx-auto">
        <AdsterraBannerSlot spec={BANNER_300X250_SPEC} allowed={allowed} pathname={pathname} />
        {/* 4. Native Ads 4:1 */}
        <div
          ref={nativeRef}
          className="adsterra-unit adsterra-native"
          data-status={nativeStatus}
          aria-label="Quảng cáo đề xuất"
        />
      </div>

      {/* 5. Smartlink */}
      <a
        className="adsterra-smartlink"
        href={ADSTERRA_SMARTLINK_URL}
        target="_blank"
        rel="sponsored noopener noreferrer"
      >
        Khám phá nội dung tài trợ
      </a>
    </aside>
  );

  return (
    <>
      {/* 2 Banner sườn trái & phải trên desktop (Flank Sidebars) */}
      <aside className="adsterra-flank adsterra-flank-left" aria-label="Quảng cáo sườn trái">
        <AdsterraBannerSlot spec={BANNER_160X600_SPEC} allowed={allowed} pathname={pathname} />
      </aside>
      <aside className="adsterra-flank adsterra-flank-right" aria-label="Quảng cáo sườn phải">
        <AdsterraBannerSlot spec={BANNER_160X300_SPEC} allowed={allowed} pathname={pathname} />
      </aside>

      {/* Cụm quảng cáo trung tâm: portal vào trước block tính năng nếu là trang chủ, hoặc hiển thị mặc định */}
      {portalTarget ? createPortal(mainStack, portalTarget) : mainStack}
    </>
  );
}
