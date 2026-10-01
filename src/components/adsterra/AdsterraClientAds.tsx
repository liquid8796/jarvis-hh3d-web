"use client";

import { useEffect, useRef } from "react";
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

const EXCLUDED_PATH_PREFIXES = ["/admin", "/chat-frame", "/quyen-rieng-tu"] as const;

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

/**
 * Mounts the exact publisher tags supplied by Adsterra. The two anti-adblock tags are vendor code
 * only; Auto HH3D does not inspect extensions, block page access or add custom bypass logic.
 */
export function AdsterraClientAds() {
  const pathname = usePathname();
  const leaderboardRef = useRef<HTMLDivElement>(null);
  const nativeRef = useRef<HTMLDivElement>(null);
  const allowed = pathAllowsAds(pathname);

  useEffect(() => {
    if (!allowed) return;
    appendGlobalScriptOnce(ADSTERRA_POPUNDER_SCRIPT_SRC, "popunder");
    appendGlobalScriptOnce(ADSTERRA_SOCIAL_BAR_SCRIPT_SRC, "social-bar");
  }, [allowed]);

  useEffect(() => {
    const slot = leaderboardRef.current;
    if (!allowed || !slot || !window.matchMedia("(min-width: 760px)").matches) return;

    slot.replaceChildren();
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
    slot.append(options, invoke);

    return () => slot.replaceChildren();
  }, [allowed, pathname]);

  useEffect(() => {
    const slot = nativeRef.current;
    if (!allowed || !slot) return;

    slot.replaceChildren();
    const invoke = document.createElement("script");
    invoke.src = ADSTERRA_NATIVE_SCRIPT_SRC;
    invoke.async = true;
    invoke.dataset.cfasync = "false";
    invoke.dataset.adsterraPlacement = "native";
    const container = document.createElement("div");
    container.id = ADSTERRA_NATIVE_CONTAINER_ID;
    slot.append(invoke, container);

    return () => slot.replaceChildren();
  }, [allowed, pathname]);

  if (!allowed) return null;

  return (
    <aside className="adsterra-stack" aria-label="Quảng cáo tài trợ">
      <p className="adsterra-label">Quảng cáo</p>
      <div
        ref={leaderboardRef}
        className="adsterra-unit adsterra-leaderboard"
        aria-label="Quảng cáo biểu ngữ"
      />
      <div
        ref={nativeRef}
        className="adsterra-unit adsterra-native"
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