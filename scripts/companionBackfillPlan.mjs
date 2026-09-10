/** Pure count/selection plan. No model calls, GitHub requests, credentials, or database writes. */
export const DEFAULT_COMPANION_REPO_COUNT = 3;

/** Null inherits the global setting; zero explicitly requests no new repositories. */
export function targetCountForStation(station, defaultCount = DEFAULT_COMPANION_REPO_COUNT) {
  return station?.companionCountOverride ?? defaultCount;
}

export function deficitOf(station, defaultCount = DEFAULT_COMPANION_REPO_COUNT) {
  const have = Array.isArray(station?.companionRepos) ? station.companionRepos.length : 0;
  return Math.max(0, targetCountForStation(station, defaultCount) - have);
}

/**
 * Select stations still needing repositories. `onlyRepo` accepts either repo or owner/repo;
 * duplicate basenames require the full slug. Existing repositories are never removed.
 * @param {readonly any[]} stations
 * @param {string | null} [onlyRepo]
 * @param {number} [defaultCount]
 */
export function planStations(stations, onlyRepo = null, defaultCount = DEFAULT_COMPANION_REPO_COUNT) {
  const list = Array.isArray(stations) ? stations : [];
  const slugOf = (station) => `${station?.owner ?? "?"}/${station?.repo ?? "?"}`;
  const wanted = onlyRepo ? String(onlyRepo).trim().toLowerCase() : null;
  const matches = (station) => wanted === null ||
    (wanted.includes("/") ? slugOf(station) : String(station?.repo ?? "")).toLowerCase() === wanted;
  const selected = list.filter(matches);
  if (wanted && selected.length === 0) {
    return { targets: [], skipped: [], error: `Không có kho「${onlyRepo}」trong sổ Kho GitHub.` };
  }
  if (wanted && selected.length > 1) {
    return { targets: [], skipped: [], error: `Có nhiều kho tên「${onlyRepo}」. Dùng --repo owner/repo để chọn một trạm.` };
  }

  const targets = [];
  const skipped = [];
  for (const station of list) {
    const slug = slugOf(station);
    if (!matches(station)) {
      skipped.push({ slug, reason: "không nằm trong --repo" });
      continue;
    }
    if (station?.enabled === false) {
      skipped.push({ slug, reason: "trạm đang tắt" });
      continue;
    }
    const have = Array.isArray(station?.companionRepos) ? station.companionRepos.length : 0;
    const target = targetCountForStation(station, defaultCount);
    const need = deficitOf(station, defaultCount);
    if (need === 0) {
      skipped.push({ slug, reason: `đã đủ số kho phụ (${have}/${target}); giữ nguyên kho hiện có` });
      continue;
    }
    targets.push({ slug, station, have, target, need });
  }
  return { targets, skipped, error: null };
}
