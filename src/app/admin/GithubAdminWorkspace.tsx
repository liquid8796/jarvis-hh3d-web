"use client";

import { useRef, useState, type KeyboardEvent } from "react";
import type { GithubNurtureView } from "@/app/actions/githubNurture";
import type { StationView } from "@/app/actions/githubStations";
import { GithubNurtureSettings } from "./GithubNurtureSettings";
import { GithubStationPanel } from "./GithubStationPanel";

const SECTIONS = [
  { id: "stations", label: "Kho chính" },
  { id: "ollama", label: "Ollama" },
  { id: "keys", label: "API key" },
] as const;

type GithubSection = (typeof SECTIONS)[number]["id"];

function initialGithubSection(value: string | undefined): GithubSection {
  return SECTIONS.some((section) => section.id === value) ? (value as GithubSection) : "stations";
}

export function GithubAdminWorkspace({
  stations,
  config,
  initialSection,
}: {
  stations: StationView[];
  config: GithubNurtureView;
  initialSection?: string;
}) {
  const [section, setSection] = useState(() => initialGithubSection(initialSection));
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const totalCompanions = stations.reduce((total, station) => total + station.companionRepos.length, 0);
  const enabledKeys = config.apiKeys.filter((key) => !key.disabled).length;

  function openSection(next: GithubSection) {
    setSection(next);
    const url = new URL(window.location.href);
    if (next === "stations") url.searchParams.delete("githubPanel");
    else url.searchParams.set("githubPanel", next);
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
    id === "stations" ? stations.length : id === "keys" ? config.apiKeys.length : null;

  return (
    <div className="flex flex-col gap-4">
      <section className="card card-hairline p-4 sm:p-5" aria-labelledby="github-workspace-title">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <h2 id="github-workspace-title" className="h-display text-lg font-semibold text-gilded">Kho GitHub</h2>
            <p className="mt-1 flex flex-wrap gap-x-2 text-xs text-[var(--color-mist)]">
              <span>{stations.length} kho chính</span>
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
      </section>

      <div
        role="tabpanel"
        id="github-workspace-panel-stations"
        aria-labelledby="github-workspace-tab-stations"
        tabIndex={0}
        hidden={section !== "stations"}
      >
        <GithubStationPanel stations={stations} />
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
