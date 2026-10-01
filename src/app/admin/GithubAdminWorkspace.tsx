"use client";

import { useRef, useState, type KeyboardEvent } from "react";
import type { GithubNurtureView } from "@/app/actions/githubNurture";
import type { StationView } from "@/app/actions/githubStations";
import { GithubNurtureSettings } from "./GithubNurtureSettings";
import { GithubStationPanel } from "./GithubStationPanel";
import type { StationPurpose } from "@/lib/validation/githubStations";

/**
 * HAI LOẠI KHO — cùng cơ chế tạo/nuôi/promote, khác mục đích:
 *
 *   worker    — kho đang giữ khôi lỗi chạy trên Actions (bản gốc, từ đầu).
 *   adViewer  — kho chạy workflow xem quảng cáo trên chính website của tông môn.
 *
 * `PURPOSES` là thanh lựa chọn TRÊN CÙNG — khi đổi mục đích, danh sách kho chính bên dưới
 * được lọc theo `station.purpose`, nhưng Ollama và API key vẫn CHUNG (hạ tầng nuôi repo phụ
 * không phân biệt mục đích).
 */
const PURPOSES: { id: StationPurpose; label: string }[] = [
  { id: "worker", label: "Khôi Lỗi" },
  { id: "adViewer", label: "Xem Quảng Cáo" },
];

const SECTIONS = [
  { id: "stations", label: "Kho chính" },
  { id: "ollama", label: "Ollama" },
  { id: "keys", label: "API key" },
] as const;

type GithubSection = (typeof SECTIONS)[number]["id"];

function initialGithubSection(value: string | undefined): GithubSection {
  return SECTIONS.some((section) => section.id === value) ? (value as GithubSection) : "stations";
}

function initialPurpose(value: string | undefined): StationPurpose {
  return PURPOSES.some((p) => p.id === value) ? (value as StationPurpose) : "worker";
}

export function GithubAdminWorkspace({
  stations,
  config,
  initialSection,
  initialPurposeParam,
}: {
  stations: StationView[];
  config: GithubNurtureView;
  initialSection?: string;
  initialPurposeParam?: string;
}) {
  const [section, setSection] = useState(() => initialGithubSection(initialSection));
  const [purpose, setPurpose] = useState(() => initialPurpose(initialPurposeParam));
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  /** Kho chính lọc theo mục đích đang chọn. Ollama/API key không lọc. */
  const filteredStations = stations.filter((station) => (station.purpose ?? "worker") === purpose);
  const workerCount = stations.filter((s) => (s.purpose ?? "worker") === "worker").length;
  const adViewerCount = stations.filter((s) => s.purpose === "adViewer").length;
  const totalCompanions = stations.reduce((total, station) => total + station.companionRepos.length, 0);
  const enabledKeys = config.apiKeys.filter((key) => !key.disabled).length;

  function openSection(next: GithubSection) {
    setSection(next);
    const url = new URL(window.location.href);
    if (next === "stations") url.searchParams.delete("githubPanel");
    else url.searchParams.set("githubPanel", next);
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  }

  function switchPurpose(next: StationPurpose) {
    setPurpose(next);
    // Khi đổi mục đích mà đang xem Ollama/keys thì giữ nguyên tab; nếu đang xem kho chính
    // thì vẫn ở kho chính nhưng sổ được lọc lại.
    const url = new URL(window.location.href);
    if (next === "worker") url.searchParams.delete("githubPurpose");
    else url.searchParams.set("githubPurpose", next);
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  }

  function onTabKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const current = SECTIONS.findIndex((item) => item.id === section);
    let next = current;
    if (event.key === "ArrowRight") next = (current + 1) % SECTIONS.length;
    else if (event.key === "ArrowLeft") next = (current - 1 + SECTIONS.length) % SECTIONS.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = SECTIONS.length - 1;
    else return;

    event.preventDefault();
    openSection(SECTIONS[next].id);
    tabRefs.current[next]?.focus();
  }

  const countFor = (id: GithubSection) =>
    id === "stations" ? filteredStations.length : id === "keys" ? config.apiKeys.length : null;

  const purposeCountFor = (id: StationPurpose) =>
    id === "worker" ? workerCount : adViewerCount;

  return (
    <div className="flex flex-col gap-4">
      <section className="card card-hairline p-4 sm:p-5" aria-labelledby="github-workspace-title">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <h2 id="github-workspace-title" className="h-display text-lg font-semibold text-gilded">Kho GitHub</h2>
            <p className="mt-1 flex flex-wrap gap-x-2 text-xs text-[var(--color-mist)]">
              <span>{workerCount} khôi lỗi</span>
              <span>· {adViewerCount} xem QC</span>
              <span>· {totalCompanions} kho phụ</span>
              <span>· {enabledKeys}/{config.apiKeys.length} API key bật</span>
              <span className="max-w-full truncate font-mono" title={config.model}>· {config.model}</span>
            </p>
          </div>
          <div
            role="tablist"
            aria-label="Quản lý Kho GitHub"
            className="queue-tabs"
            onKeyDown={onTabKeyDown}
          >
            {SECTIONS.map((item, index) => {
              const active = item.id === section;
              const count = countFor(item.id);
              return (
                <button
                  key={item.id}
                  ref={(node) => { tabRefs.current[index] = node; }}
                  type="button"
                  role="tab"
                  id={`github-workspace-tab-${item.id}`}
                  aria-selected={active}
                  aria-controls={`github-workspace-panel-${item.id}`}
                  tabIndex={active ? 0 : -1}
                  className={active ? "active" : ""}
                  onClick={() => openSection(item.id)}
                >
                  {item.label}
                  {count !== null && <span className="queue-tab-count">{count}</span>}
                </button>
              );
            })}
          </div>
        </div>

        {/* Thanh chọn mục đích — chỉ hiện khi đang xem tab Kho chính, vì Ollama/API key là chung. */}
        {section === "stations" && (
          <div className="mt-3 flex flex-wrap gap-2" role="radiogroup" aria-label="Loại kho GitHub">
            {PURPOSES.map((p) => {
              const active = p.id === purpose;
              const count = purposeCountFor(p.id);
              return (
                <button
                  key={p.id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                    active
                      ? "border-[rgba(232,194,92,0.6)] bg-[rgba(232,194,92,0.12)] text-[var(--color-gold-300)]"
                      : "border-[var(--color-ink-600)] text-[var(--color-mist)] hover:border-[rgba(232,194,92,0.3)] hover:text-[var(--color-parchment)]"
                  }`}
                  onClick={() => switchPurpose(p.id)}
                >
                  {p.label}
                  <span className="ml-1.5 opacity-70">{count}</span>
                </button>
              );
            })}
          </div>
        )}
      </section>

      <div
        role="tabpanel"
        id="github-workspace-panel-stations"
        aria-labelledby="github-workspace-tab-stations"
        tabIndex={0}
        hidden={section !== "stations"}
      >
        <GithubStationPanel stations={filteredStations} purpose={purpose} />
      </div>
      <div
        role="tabpanel"
        id="github-workspace-panel-ollama"
        aria-labelledby="github-workspace-tab-ollama"
        tabIndex={0}
        hidden={section !== "ollama"}
      >
        <GithubNurtureSettings config={config} section="ollama" />
      </div>
      <div
        role="tabpanel"
        id="github-workspace-panel-keys"
        aria-labelledby="github-workspace-tab-keys"
        tabIndex={0}
        hidden={section !== "keys"}
      >
        <GithubNurtureSettings config={config} section="keys" />
      </div>
    </div>
  );
}
