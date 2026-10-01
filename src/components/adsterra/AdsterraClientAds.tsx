"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import {
  ADSTERRA_LEADERBOARD_KEY,
  ADSTERRA_LEADERBOARD_SCRIPT_SRC,
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

/**
 * Mounts the exact publisher tags supplied by Adsterra. The Popunder tag and Smartlink came from
 * Adsterra's custom-domain/anti-adblock response; the Social Bar, banner and native tags came from
 * the normal zone page. Auto HH3D does not inspect extensions, block page access or add custom
 * bypass logic of its own. Browser-blocked or empty display slots collapse instead of leaving a
 * blank frame on the page.
 */
export function AdsterraClientAds() {
  const pathname = usePathname();
  const leaderboardRef = useRef<HTMLDivElement>(null);
  const nativeRef = useRef<HTMLDivElement>(null);
  const [leaderboardStatus, setLeaderboardStatus] = useState<AdSlotStatus>("loading");
  const [nativeStatus, setNativeStatus] = useState<AdSlotStatus>("loading");
  const allowed = pathAllowsAds(pathname);

  useEffect(() => {
    if (!allowed) return;
    appendGlobalScriptOnce(ADSTERRA_POPUNDER_SCRIPT_SRC, "popunder");
    appendGlobalScriptOnce(ADSTERRA_SOCIAL_BAR_SCRIPT_SRC, "social-bar");
  }, [allowed]);

  useEffect(() => {
    const slot = leaderboardRef.current;
    if (!allowed || !slot || !window.matchMedia("(min-width: 760px)").matches) return;

    let active = true;
    setLeaderboardStatus("loading");
    slot.replaceChildren();

    const markBlocked = () => {
      if (active) setLeaderboardStatus("blocked");
    };
    const options = document.createElement("script");
    options.text = `window.atOptions = ${JSON.stringify({
      key: ADSTERRA_LEADERBOARD_KEY,
      format: "iframe",
      height: 90,
      width: 728,
      params: {},
    })};`;
    const invoke = document.createElement("script");
    invoke.src = ADSTERRA_LEADERBOARD_SCRIPT_SRC;
    invoke.async = false;
    invoke.dataset.adsterraPlacement = "leaderboard";
    invoke.addEventListener("error", markBlocked, { once: true });
    slot.append(options, invoke);

    const stopWatching = watchForRenderedAd(
      slot,
      () => Boolean(slot.querySelector("iframe")),
      () => {
        if (active) setLeaderboardStatus("ready");
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

  return (
    <aside className="adsterra-stack" aria-label="Quảng cáo tài trợ">
      <div
        ref={leaderboardRef}
        className="adsterra-unit adsterra-leaderboard"
        data-status={leaderboardStatus}
        aria-label="Quảng cáo biểu ngữ"
      />
      <div
        ref={nativeRef}
        className="adsterra-unit adsterra-native"
        data-status={nativeStatus}
        aria-label="Quảng cáo đề xuất"
      />
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
}
