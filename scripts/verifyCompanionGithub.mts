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
const legacyMarker = "[companion:1789000000000-01234567-89ab-4cde-8fab-0123456789ab]";
const janetSource = "(defn square [number]\n  (* number number))\n";
let extraDeclaredFiles: string[] = [];
const snapshotGithub = new CompanionGithub("test-secret", Date.now() + 60000, async (input) => {
  const url = new URL(String(input)); snapshotCalls.push(url);
  if (url.pathname === "/repos/Owner/side") return Response.json({ id: 7, full_name: "Owner/side", default_branch: "main", private: false, description: `Small calculation library ${legacyMarker}`, language: "Janet" });
  if (url.pathname.includes("/git/ref/")) return Response.json({ object: { sha: "pinned-head" } });
  if (url.pathname.endsWith("/git/commits/pinned-head")) return Response.json({ tree: { sha: "pinned-tree" } });
  if (url.pathname.includes("/git/trees/")) return Response.json({ truncated: true, tree: [
    { path: "credentials.json", type: "blob", sha: "private", mode: "100644", size: 10 },
    { path: "src/main.ts", type: "blob", sha: "source", mode: "100644", size: 30 },
    { path: "Sources/App.swift", type: "blob", sha: "swift-source", mode: "100644", size: 20 },
    { path: "src/math.janet", type: "blob", sha: "janet-source", mode: "100644", size: Buffer.byteLength(janetSource) },
    { path: "external-library", type: "commit", sha: "submodule-head", mode: "160000" },
    ...extraDeclaredFiles.map((path, index) => ({ path, type: "blob", sha: `extra-source-${index}`, mode: "100644", size: Buffer.byteLength(janetSource) })),
  ] });
  if (url.pathname.endsWith("/commits") && url.searchParams.has("since")) return Response.json(Array.from({ length: 7 }, () => ({ sha: "today" })));
  if (url.pathname.endsWith("/commits")) return Response.json([{ commit: { message: "Previous change" } }]);
  if (url.pathname.endsWith("/git/blobs/source")) return Response.json({ encoding: "base64", content: Buffer.from("export const uniqueSourceMarker = 42;").toString("base64") });
  if (url.pathname.endsWith("/git/blobs/swift-source")) return Response.json({ encoding: "base64", content: Buffer.from("let answer: Int = 42\n").toString("base64") });
  if (url.pathname.endsWith("/git/blobs/janet-source")) return Response.json({ encoding: "base64", content: Buffer.from(janetSource).toString("base64") });
  if (url.pathname.includes("/git/blobs/extra-source-")) return Response.json({ encoding: "base64", content: Buffer.from(janetSource).toString("base64") });
  throw new Error("Unexpected or private blob read");
});
const observed = await snapshotGithub.snapshot("Owner", "side", 8192);
assert(observed);
assert.equal(observed.complete, false);
assert.equal(observed.todayCommits, 7);
assert.equal(observed.language, "Janet");
assert(observed.context.includes("Description: Small calculation library\n"));
assert(!observed.context.includes("[companion:"), "legacy tracking markers cannot enter future model context");
assert(!observed.context.includes("uniqueSourceMarker"), "source must travel as separate complete files");
assert(!observed.context.includes("credentials.json"));
assert.equal(observed.files.get("src/main.ts")?.content, "export const uniqueSourceMarker = 42;");
assert.equal(observed.files.get("Sources/App.swift")?.content, "let answer: Int = 42\n", "every supported source language can be read on later commits");
assert.equal(observed.files.get("src/math.janet")?.content, undefined, "an unfamiliar extension needs explicit source evidence before it is read");
assert.equal(observed.files.get("external-library")?.mode, "160000");
assert.equal(observed.files.get("external-library")?.content, undefined);
const dailyUrl = snapshotCalls.find((url) => url.searchParams.has("since"))!;
assert.equal(dailyUrl.searchParams.get("sha"), "pinned-head");
assert.equal(dailyUrl.searchParams.get("since"), new Date(`${nurtureDayKey(new Date())}T00:00:00+07:00`).toISOString());
const declaredJanet = ["src/math.janet"];
const observedJanet = await snapshotGithub.snapshot("Owner", "side", 8192, declaredJanet);
assert(observedJanet);
assert.equal(observedJanet.files.get("src/math.janet")?.content, janetSource, "an explicitly declared unfamiliar source file is read completely on later turns");
const janetChanges = [{ path: "src/math.janet", content: "(defn cube [number]\n  (* number number number))\n" }];
conflict = false;
const beforeJanet = calls.length;
await assert.rejects(github.commit("Owner", "side", observedJanet, janetChanges, "Add cube calculation", declaredJanet), /source/);
await assert.rejects(github.commit("Owner", "side", observedJanet, janetChanges, "Add cube calculation", [], 2, declaredJanet), /đọc|context/);
assert.equal(calls.length, beforeJanet, "declared source still requires complete read evidence");
assert.equal((await github.commit("Owner", "side", observedJanet, janetChanges, "Add cube calculation", declaredJanet, 2, declaredJanet)).sha, "commit-new");
assert.equal(calls.at(-1)?.body.force, false);
assert.deepEqual(await emptyGithub.commit("Owner", "side", empty, [initialFiles[0], ...janetChanges], "Initial Janet calculation", [], 1, declaredJanet), { sha: "first-source", pushed: 1, partial: true });
assert(emptyCalls.at(-1)?.path.endsWith("/contents/src/math.janet"), "initialization prioritizes declared unfamiliar source over README");
const beforeSpoof = calls.length;
const beforeSnapshotSpoof = snapshotCalls.length;
for (const path of ["README.md", "config.unknown", "package.json", "logo.svg", "assets/image.png", ".env", ".github/workflows/build.unknown"]) {
  await assert.rejects(github.commit("Owner", "side", empty, [{ path, content: "Only documentation or an asset, not working source." }], "Fake source", [], 2, [path]), /source/);
  await assert.rejects(snapshotGithub.snapshot("Owner", "side", 8192, [path]), /source/);
}
assert.equal(calls.length, beforeSpoof, "declaring docs/assets as source fails before a repository mutation");
assert.equal(snapshotCalls.length, beforeSnapshotSpoof, "invalid source declarations fail before repository reads");
extraDeclaredFiles = Array.from({ length: 255 }, (_, index) => `src/module-${index}.janet`);
const accumulatedSources = [...declaredJanet, ...extraDeclaredFiles];
const accumulatedSnapshot = await snapshotGithub.snapshot("Owner", "side", 8192, accumulatedSources);
assert(accumulatedSnapshot);
assert.equal([...accumulatedSnapshot.files.values()].filter((file) => file.content !== undefined).length, 16, "a 256-path source registry retains the 16-file complete-read limit");
assert.equal(accumulatedSnapshot.files.get("src/math.janet")?.content, janetSource);
const beforeRegistryLimit = snapshotCalls.length;
await assert.rejects(snapshotGithub.snapshot("Owner", "side", 8192, [...accumulatedSources, "src/overflow.janet"]), /source/);
assert.equal(snapshotCalls.length, beforeRegistryLimit, "snapshot registry is capped at 256 safe paths");
const beforeCommitLimit = calls.length;
await assert.rejects(github.commit("Owner", "side", observedJanet, janetChanges, "Overfull source declarations", declaredJanet, 2, accumulatedSources.slice(0, 25)), /source/);
assert.equal(calls.length, beforeCommitLimit, "each commit still permits at most 24 declared paths");

const createCalls: Array<{ path: string; body: any }> = [];
const createGithub = new CompanionGithub("test-secret", Date.now() + 60000, async (input, init) => {
  const path = new URL(String(input)).pathname;
  const body = init?.body ? JSON.parse(String(init.body)) : null;
  createCalls.push({ path, body });
  if (path === "/user") return Response.json({ login: "Owner" });
  if (path === "/user/repos") return Response.json({ id: 9, full_name: "Owner/fresh", default_branch: "main", private: false, description: body.description }, { status: 201 });
  throw new Error("Unexpected creation request");
});
assert.equal((await createGithub.create("Owner", "fresh", `Useful calculator ${legacyMarker}`)).description, "Useful calculator");
assert.equal(createCalls.at(-1)?.body.description, "Useful calculator");
assert.equal(createCalls.at(-1)?.body.auto_init, false);
assert.equal(createCalls.at(-1)?.body.private, false);
assert(!JSON.stringify(createCalls).includes("[companion:"));
console.log("PASS companion GitHub target/read guards, declared unfamiliar source, clean descriptions, atomic commit, no-op, and non-force conflicts");
