#!/usr/bin/env node
/** Count and selection checks; no database, GitHub, or Ollama calls. */
import assert from "node:assert/strict";
import {
  deficitOf,
  planStations,
  targetCountForStation,
} from "./companionBackfillPlan.mjs";

let count = 0;
const check = (condition, message) => {
  assert.ok(condition, message);
  count += 1;
  console.log(`✔ ${message}`);
};
const station = (overrides = {}) => ({
  owner: "acct", repo: "example", enabled: true,
  companionCountOverride: null, companionRepos: [], ...overrides,
});
const companions = (n) => Array.from({ length: n }, (_, index) => ({ repo: `project-${index}` }));

check(targetCountForStation(station()) === 3, "stations inherit the default of three companions");
check(targetCountForStation(station(), 5) === 5, "configured global count is respected");
check(targetCountForStation(station({ companionCountOverride: 1 }), 5) === 1, "station override wins");
check(targetCountForStation(station({ companionCountOverride: 0 }), 5) === 0, "zero override is not replaced by the global count");
check(deficitOf(station()) === 3, "empty station needs three companions by default");
check(deficitOf(station({ companionRepos: companions(2) })) === 1, "legacy two-companion station needs one");
check(deficitOf(station({ companionRepos: companions(3) })) === 0, "three companions meet the default target");
check(deficitOf(station({ companionRepos: companions(8) })) === 0, "lower target preserves existing repositories without negative deficit");
check(deficitOf(station({ companionCountOverride: 5, companionRepos: companions(2) }), 1) === 3, "deficit follows the station override");
check(deficitOf({ owner: "old", repo: "legacy" }) === 3, "old stations without companion fields inherit the default");

const stations = [
  station({ owner: "one", repo: "empty" }),
  station({ owner: "two", repo: "legacy", companionRepos: companions(2) }),
  station({ owner: "three", repo: "full", companionRepos: companions(3) }),
  station({ owner: "four", repo: "paused", enabled: false }),
  station({ owner: "five", repo: "zero", companionCountOverride: 0 }),
];
const snapshot = structuredClone(stations);
const plan = planStations(stations);
check(plan.error === null && plan.targets.length === 2, "plan selects only enabled stations with missing companions");
check(plan.targets[0].have === 0 && plan.targets[0].target === 3 && plan.targets[0].need === 3, "plan exposes current, requested and missing counts");
check(plan.targets[1].need === 1, "plan backfills only the missing legacy slot");
check(plan.skipped.some((row) => row.slug === "four/paused" && row.reason.includes("tắt")), "disabled station has an explicit skip reason");
check(plan.skipped.some((row) => row.slug === "three/full" && row.reason.includes("3/3")), "full station displays its actual configured count");
assert.deepEqual(stations, snapshot);
check(true, "planning does not mutate settings or companion entries");

check(planStations(stations, "LEGACY").targets[0]?.slug === "two/legacy", "repo filter is case insensitive");
check(planStations(stations, "TWO/LEGACY").targets[0]?.slug === "two/legacy", "owner/repo filter resolves an exact station");
check(planStations(stations, "missing").error !== null, "unknown repo filter fails explicitly");
const sameNames = [station({ owner: "a" }), station({ owner: "b" })];
check(planStations(sameNames, "example").error !== null, "ambiguous repo name requires owner/repo");
check(planStations(sameNames, "b/example").targets.length === 1, "owner/repo resolves duplicate basenames");
check(planStations(stations, null, 5).targets.length === 3, "global target changes the count plan");

console.log(`\n✔ ${count} checks — Ollama companion backfill count plan.`);
