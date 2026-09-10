import assert from "node:assert/strict";
import { CompanionGithub, assertCompanionTarget, safeSourcePath } from "../src/lib/services/companionGithub";
import { nurtureDayKey } from "../src/lib/validation/githubStations";

const stations = [{ owner: "Owner", repo: "primary", companionRepos: [{ repo: "side", githubId: 7 }] }];
assert.throws(() => assertCompanionTarget(stations, stations[0], "PRIMARY"), /chính/);
assert.throws(() => assertCompanionTarget(stations, stations[0], "other"), /sổ/);
assert.throws(() => assertCompanionTarget(stations, stations[0], "../side"));
assert.doesNotThrow(() => assertCompanionTarget(stations, stations[0], "side"));
assert.throws(() => assertCompanionTarget([...stations, { owner: "owner", repo: "second", companionRepos: [{ repo: "SIDE" }] }], stations[0], "side"), /nhiều station/);
for (const path of ["credentials.json", "secrets.json", ".gitmodules", ".npmrc", "src/../outside.ts"]) assert.equal(safeSourcePath(path), false, `${path} must never enter cloud context`);

const calls: Array<{ path: string; method: string; body: any }> = [];
let conflict = false;
const fakeFetch: typeof fetch = async (input, init) => {
  const url = new URL(String(input));
  const body = init?.body ? JSON.parse(String(init.body)) : null;
  calls.push({ path: url.pathname, method: init?.method ?? "GET", body });
  if (url.pathname.endsWith("/git/trees") && init?.method === "POST") return Response.json({ sha: "tree-new" }, { status: 201 });
  if (url.pathname.endsWith("/git/commits") && init?.method === "POST") return Response.json({ sha: "commit-new" }, { status: 201 });
  if (url.pathname.includes("/git/refs/heads/")) return Response.json({}, { status: conflict ? 422 : 200 });
  throw new Error(`Unexpected test request ${url.pathname}`);
};
const github = new CompanionGithub("test-secret", Date.now() + 60_000, fakeFetch);
const snapshot = { branch: "main", head: "head-old", tree: "tree-old", files: new Map([["src/main.ts", { sha: "blob-old", mode: "100644", content: "export const n = 1;" }]]), context: "", githubId: 7 };
const changes = [{ path: "src/main.ts", content: "export const n = 2;" }];
assert.equal((await github.commit("Owner", "side", snapshot, changes, "Adjust default")).sha, "commit-new");
assert.equal(calls.at(-1)?.body.force, false);
assert.deepEqual(calls.find((c) => c.path.endsWith("/git/commits"))?.body.parents, ["head-old"]);
assert.equal(calls.find((c) => c.path.endsWith("/git/trees"))?.body.base_tree, "tree-old");
const before = calls.length;
assert.equal((await github.commit("Owner", "side", snapshot, [{ path: "src/main.ts", content: "export const n = 1;" }], "No change")).pushed, 0);
assert.equal(calls.length, before);
await assert.rejects(github.commit("Owner", "side", snapshot, [
  { path: "src/main.ts", content: "export const n = 1;" },
  { path: "README.md", content: "A documentation-only change with unchanged source." },
], "Only documentation changed"), /source/);
assert.equal(calls.length, before, "unchanged source cannot authorize a documentation-only commit");
const prefixSnapshot = { ...snapshot, files: new Map([
  ...snapshot.files,
  ["folder.ts/hidden.ts", { sha: "unread", mode: "100644", content: "export const preserve = true;" }],
  ["submodule.ts", { sha: "submodule-head", mode: "160000", content: "" }],
]) };
for (const path of ["folder.ts", "src/main.ts/nested.ts", "submodule.ts/nested.ts", "submodule.ts"]) {
  await assert.rejects(github.commit("Owner", "side", prefixSnapshot, [{ path, content: "export const replacement = true;" }], "Conflicting file shape"), /cấu trúc|đọc|submodule/);
  assert.equal(calls.length, before, `${path} must be rejected before any GitHub request`);
}
await assert.rejects(github.commit("Owner", "side", snapshot, changes, "Unseen file", []), /đọc|shown|context/i);
assert.equal(calls.length, before);
await assert.rejects(github.commit("Owner", "side", { ...snapshot, complete: false }, [{ path: "src/omitted.ts", content: "export const n = 3;" }], "Omitted tree file", []), /tree|đầy đủ|partial/i);
assert.equal(calls.length, before);
conflict = true;
await assert.rejects(github.commit("Owner", "side", snapshot, changes, "Adjust default"), /422/);
assert.equal(calls.at(-1)?.body.force, false);
const emptyCalls: Array<{ path: string; body: any }> = [];
const emptyGithub = new CompanionGithub("test-secret", Date.now() + 60000, async (input, init) => {
  const url = new URL(String(input));
  emptyCalls.push({ path: url.pathname, body: JSON.parse(String(init?.body)) });
  return Response.json({ commit: { sha: "first-source" } }, { status: 201 });
});
const empty = { branch: "main", head: null, tree: null, files: new Map(), context: "", githubId: 8, complete: true };
const initialFiles = [{ path: "README.md", content: "A useful calculation helper." }, { path: "src/main.ts", content: "export function square(n: number) { return n * n; }" }];
await assert.rejects(emptyGithub.commit("Owner", "side", empty, initialFiles, "Initial", [], 0), /hạn mức/);
assert.equal(emptyCalls.length, 0);
assert.deepEqual(await emptyGithub.commit("Owner", "side", empty, initialFiles, "Initial", [], 1), { sha: "first-source", pushed: 1, partial: true });
assert.equal(emptyCalls.length, 1);
assert(emptyCalls[0].path.endsWith("/contents/src/main.ts"), "one-commit initialization must prioritize substantive source");

const snapshotCalls: URL[] = [];
const snapshotGithub = new CompanionGithub("test-secret", Date.now() + 60000, async (input) => {
  const url = new URL(String(input)); snapshotCalls.push(url);
  if (url.pathname === "/repos/Owner/side") return Response.json({ id: 7, full_name: "Owner/side", default_branch: "main", private: false });
  if (url.pathname.includes("/git/ref/")) return Response.json({ object: { sha: "pinned-head" } });
  if (url.pathname.endsWith("/git/commits/pinned-head")) return Response.json({ tree: { sha: "pinned-tree" } });
  if (url.pathname.includes("/git/trees/")) return Response.json({ truncated: true, tree: [
    { path: "credentials.json", type: "blob", sha: "private", mode: "100644", size: 10 },
    { path: "src/main.ts", type: "blob", sha: "source", mode: "100644", size: 30 },
    { path: "Sources/App.swift", type: "blob", sha: "swift-source", mode: "100644", size: 20 },
    { path: "external-library", type: "commit", sha: "submodule-head", mode: "160000" },
  ] });
  if (url.pathname.endsWith("/commits") && url.searchParams.has("since")) return Response.json(Array.from({ length: 7 }, () => ({ sha: "today" })));
  if (url.pathname.endsWith("/commits")) return Response.json([{ commit: { message: "Previous change" } }]);
  if (url.pathname.endsWith("/git/blobs/source")) return Response.json({ encoding: "base64", content: Buffer.from("export const uniqueSourceMarker = 42;").toString("base64") });
  if (url.pathname.endsWith("/git/blobs/swift-source")) return Response.json({ encoding: "base64", content: Buffer.from("let answer: Int = 42\n").toString("base64") });
  throw new Error("Unexpected or private blob read");
});
const observed = await snapshotGithub.snapshot("Owner", "side", 8192);
assert(observed);
assert.equal(observed.complete, false);
assert.equal(observed.todayCommits, 7);
assert(!observed.context.includes("uniqueSourceMarker"), "source must travel as separate complete files");
assert(!observed.context.includes("credentials.json"));
assert.equal(observed.files.get("src/main.ts")?.content, "export const uniqueSourceMarker = 42;");
assert.equal(observed.files.get("Sources/App.swift")?.content, "let answer: Int = 42\n", "every supported source language can be read on later commits");
assert.equal(observed.files.get("external-library")?.mode, "160000");
assert.equal(observed.files.get("external-library")?.content, undefined);
const dailyUrl = snapshotCalls.find((url) => url.searchParams.has("since"))!;
assert.equal(dailyUrl.searchParams.get("sha"), "pinned-head");
assert.equal(dailyUrl.searchParams.get("since"), new Date(`${nurtureDayKey(new Date())}T00:00:00+07:00`).toISOString());
console.log("PASS companion GitHub target guards, atomic multi-file commit, no-op, and non-force conflict handling");
