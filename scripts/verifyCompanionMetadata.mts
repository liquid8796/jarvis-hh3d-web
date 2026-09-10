#!/usr/bin/env node
/** Isolated About cleanup scenarios: injected GitHub transport/state, no network or database. */
import assert from "node:assert/strict";
import { stripCompanionMarker } from "../src/lib/validation/companionMetadata";
import {
  cleanupCompanionAbout, companionAboutRequest, companionAboutTargets,
  type CompanionAboutRegistry, type CompanionAboutTarget, type CompanionAboutRequest,
} from "./cleanupCompanionAbout.mts";

const operationId = "1789084800000-12345678-1234-4234-8234-123456789abc";
const marker = `[companion:${operationId}]`;
const human = "Small useful software. [Contributors] © Example";
const target: CompanionAboutTarget = { stationSlug: "fixture/worker", repo: "utility" };
type Call = { method: string; route: string; body?: unknown };
function fixture() {
  let settings: CompanionAboutRegistry = { githubStations: [{
    owner: "fixture", repo: "worker", pat: "unused-fixture",
    companionRepos: [{ repo: "utility", githubId: 101, language: "TypeScript" }],
  }] };
  const info: { id: number; full_name: string; description: string | null; language: string | null } = {
    id: 101, full_name: "fixture/utility", description: `${human} ${marker}`, language: "TypeScript",
  };
  const calls: Call[] = [];
  const events: string[] = [];
  let reads = 0;
  let hook: ((call: Call, reads: number) => void) | undefined;
  let mutateHook: ((draft: CompanionAboutRegistry) => void) | undefined;
  let readHook: (() => void) | undefined;
  let patchHook: ((body: unknown) => void) | undefined;
  const request: CompanionAboutRequest = async (method, route, body) => {
    const call = { method, route, body };
    calls.push(call);
    events.push(method);
    assert.equal(route, "/repos/fixture/utility");
    if (method === "GET") reads++;
    hook?.(call, reads);
    if (method === "PATCH") {
      assert.deepEqual(Object.keys(body!), ["description"]);
      Object.assign(info, body);
      patchHook?.(body);
    }
    return { status: 200, body: structuredClone(info) };
  };
  return {
    info, calls, events, request,
    state: () => settings,
    hook: (value: typeof hook) => { hook = value; },
    onMutate: (value: typeof mutateHook) => { mutateHook = value; },
    onRead: (value: typeof readHook) => { readHook = value; },
    onPatch: (value: typeof patchHook) => { patchHook = value; },
    writes: () => calls.filter((call) => call.method === "PATCH"),
    deps: {
      read: async () => { readHook?.(); return structuredClone(settings); },
      mutate: async (change: (value: CompanionAboutRegistry) => void) => {
        const draft = structuredClone(settings);
        change(draft);
        mutateHook?.(draft);
        settings = draft;
        events.push("checkpoint");
      },
      request,
    },
  };
}

let count = 0;
async function check(name: string, work: () => void | Promise<void>) {
  await work();
  count++;
  console.log(`ok ${count} - ${name}`);
}

await check("exact generated suffix is removed while wording and attribution survive", () => {
  assert.equal(stripCompanionMarker(`${human} ${marker}`), human);
  assert.equal(stripCompanionMarker(marker), "");
  assert.equal(stripCompanionMarker(`  ${human}  ${marker}`), `  ${human} `);
  assert.equal(stripCompanionMarker(`${human}${marker}`), human);
  assert.equal(stripCompanionMarker(stripCompanionMarker(`${human} ${marker}`)), human);
});
await check("ordinary brackets, invalid IDs, and non-suffix text are preserved byte for byte", () => {
  for (const description of ["", human, "Tools [companion:manual]", `${human} ${marker} notes`,
    "[companion:1789084800000-not-a-uuid]", "[companion:1789084800000-12345678-1234-1234-8234-123456789abc]",
    "[companion:1789084800000-12345678-1234-4234-1234-123456789abc]", "[companion:0-12345678-1234-4234-8234-123456789abc]",
  ]) assert.equal(stripCompanionMarker(description), description);
});
await check("default dry-run does not write GitHub or checkpoint settings", async () => {
  const f = fixture();
  delete f.state().githubStations[0].companionRepos[0].githubId;
  const result = await cleanupCompanionAbout(target, f.deps);
  assert.equal(result.status, "planned");
  assert.equal(result.markers, 1);
  assert.equal(result.checkpoints, 0);
  assert.equal(result.writes, 0);
  assert.deepEqual(f.events, ["GET"]);
  assert.equal(f.state().githubStations[0].companionRepos[0].githubId, undefined);
});
await check("apply writes description alone and verifies response plus a fresh read", async () => {
  const f = fixture();
  const result = await cleanupCompanionAbout(target, { ...f.deps, apply: true });
  assert.equal(result.status, "updated");
  assert.equal(result.writes, 1);
  assert.equal(result.checkpoints, 0);
  assert.deepEqual(f.events, ["GET", "GET", "PATCH", "GET"]);
  assert.deepEqual(f.writes()[0].body, { description: human });
});
await check("already-clean About and null description do not generate GitHub writes", async () => {
  for (const description of [human, null]) {
    const f = fixture();
    f.info.description = description;
    const result = await cleanupCompanionAbout(target, { ...f.deps, apply: true });
    assert.equal(result.status, "unchanged");
    assert.equal(result.markers, 0);
    assert.deepEqual(f.events, ["GET"]);
  }
});
await check("legacy registered companion ID and missing language are saved before PATCH", async () => {
  const f = fixture();
  const companion = f.state().githubStations[0].companionRepos[0];
  delete companion.githubId;
  delete companion.language;
  f.hook((call) => {
    if (call.method === "PATCH") {
      assert.equal(f.state().githubStations[0].companionRepos[0].githubId, 101);
      assert.equal(f.state().githubStations[0].companionRepos[0].language, "TypeScript");
    }
  });
  const result = await cleanupCompanionAbout(target, { ...f.deps, apply: true });
  assert.equal(result.status, "updated");
  assert.deepEqual(f.events, ["GET", "checkpoint", "GET", "PATCH", "GET"]);
});
await check("an existing declared language is preserved while GitHub detection catches up", async () => {
  const f = fixture();
  f.state().githubStations[0].companionRepos[0].language = "Rust";
  const result = await cleanupCompanionAbout(target, { ...f.deps, apply: true });
  assert.equal(result.status, "updated");
  assert.equal(f.state().githubStations[0].companionRepos[0].language, "Rust");
});
await check("legacy identity can be checkpointed even when its About is already clean", async () => {
  const f = fixture();
  f.info.description = human;
  delete f.state().githubStations[0].companionRepos[0].githubId;
  const result = await cleanupCompanionAbout(target, { ...f.deps, apply: true });
  assert.equal(result.status, "updated");
  assert.equal(result.checkpoints, 1);
  assert.equal(result.writes, 0);
});
await check("fetched ID mismatch rejects cleanup before any mutation", async () => {
  const f = fixture();
  f.info.id = 999;
  const result = await cleanupCompanionAbout(target, { ...f.deps, apply: true });
  assert.equal(result.status, "failed");
  assert.deepEqual(f.events, ["GET"]);
});
await check("a different full_name or owner never establishes legacy ownership", async () => {
  for (const slug of ["other/utility", "fixture/unregistered"]) {
    const f = fixture();
    delete f.state().githubStations[0].companionRepos[0].githubId;
    f.info.full_name = slug;
    const result = await cleanupCompanionAbout(target, { ...f.deps, apply: true });
    assert.equal(result.status, "failed");
    assert.deepEqual(f.events, ["GET"]);
  }
});
await check("a concurrent About edit or replacement repository is skipped and preserved", async () => {
  for (const replacement of [false, true]) {
    const f = fixture();
    f.hook((_call, reads) => {
      if (reads === 2) { if (replacement) f.info.id = 202; else f.info.description = "A concurrent human edit."; }
    });
    const result = await cleanupCompanionAbout(target, { ...f.deps, apply: true });
    assert.equal(result.status, "skipped");
    assert.equal(f.writes().length, 0);
    if (!replacement) assert.equal(f.info.description, "A concurrent human edit.");
  }
});
await check("all registered primaries are rejected before any API call", async () => {
  const f = fixture();
  f.state().githubStations.push({ owner: "FIXTURE", repo: "Utility", pat: "unused", companionRepos: [] });
  const result = await cleanupCompanionAbout(target, { ...f.deps, apply: true });
  assert.equal(result.status, "failed");
  assert.equal(f.calls.length, 0);
});
await check("unregistered repositories and duplicate companion parents are rejected", async () => {
  for (const duplicate of [false, true]) {
    const f = fixture();
    if (duplicate) f.state().githubStations.push({ owner: "fixture", repo: "other-worker", pat: "unused", companionRepos: [{ repo: "utility" }] });
    else f.state().githubStations[0].companionRepos = [];
    const result = await cleanupCompanionAbout(target, { ...f.deps, apply: true });
    assert.equal(result.status, "failed");
    assert.equal(f.calls.length, 0);
  }
});
await check("pending legacy create retains its operation and checkpoints ID before removing marker", async () => {
  const f = fixture();
  const station = f.state().githubStations[0];
  station.companionRepos = [];
  station.nurturePending = { repo: "utility", operationId, kind: "create" };
  const pendingTarget = companionAboutTargets(f.state())[0];
  f.hook((call) => {
    if (call.method === "PATCH") assert.equal(f.state().githubStations[0].nurturePending?.githubId, 101);
  });
  const result = await cleanupCompanionAbout(pendingTarget, { ...f.deps, apply: true });
  assert.equal(result.status, "updated");
  assert.deepEqual(f.state().githubStations[0].nurturePending, { repo: "utility", operationId, kind: "create", githubId: 101 });
  assert.equal(f.state().githubStations[0].companionRepos.length, 0);
  assert.deepEqual(f.events, ["GET", "checkpoint", "GET", "PATCH", "GET"]);
});
await check("pending creation needs its exact marker or an already known matching GitHub ID", async () => {
  for (const knownId of [undefined, 101, 202]) {
    const f = fixture();
    const station = f.state().githubStations[0];
    station.companionRepos = [];
    station.nurturePending = { repo: "utility", operationId: operationId.replace("123456789abc", "123456789def"), kind: "create", githubId: knownId };
    const result = await cleanupCompanionAbout(companionAboutTargets(f.state())[0], { ...f.deps, apply: true });
    assert.equal(result.status, knownId === 101 ? "updated" : "failed");
    assert.equal(f.writes().length, knownId === 101 ? 1 : 0);
  }
});
await check("unknown fork and marker-free pending creations are not automatically adopted", async () => {
  for (const kind of ["create", "fork"] as const) {
    const f = fixture();
    f.state().githubStations[0].companionRepos = [];
    f.state().githubStations[0].nurturePending = { repo: "utility", operationId, kind };
    if (kind === "create") f.info.description = human;
    const result = await cleanupCompanionAbout(companionAboutTargets(f.state())[0], { ...f.deps, apply: true });
    assert.equal(result.status, "failed");
    assert.deepEqual(f.events, ["GET"]);
  }
});
await check("v2 pending creates cannot recover through public markers even when their operation matches", async () => {
  const f = fixture();
  f.state().githubStations[0].companionRepos = [];
  f.state().githubStations[0].nurturePending = { repo: "utility", operationId, kind: "create", metadataVersion: 2 };
  const result = await cleanupCompanionAbout(companionAboutTargets(f.state())[0], { ...f.deps, apply: true });
  assert.equal(result.status, "failed");
  assert.deepEqual(f.events, ["GET"]);
});
await check("overlapping companion and pending registration checkpoint both identities", async () => {
  const f = fixture();
  delete f.state().githubStations[0].companionRepos[0].githubId;
  f.state().githubStations[0].nurturePending = { repo: "utility", operationId, kind: "create" };
  const targets = companionAboutTargets(f.state());
  assert.equal(targets.length, 1);
  const result = await cleanupCompanionAbout(targets[0], { ...f.deps, apply: true });
  assert.equal(result.status, "updated");
  assert.equal(f.state().githubStations[0].companionRepos[0].githubId, 101);
  assert.equal(f.state().githubStations[0].nurturePending?.githubId, 101);
});
await check("a failed or discarded ID checkpoint prevents the public marker write", async () => {
  for (const fail of [true, false]) {
    const f = fixture();
    delete f.state().githubStations[0].companionRepos[0].githubId;
    f.onMutate((draft) => {
      if (fail) throw new Error("private database connection string must not be logged");
      delete draft.githubStations[0].companionRepos[0].githubId;
    });
    const result = await cleanupCompanionAbout(target, { ...f.deps, apply: true });
    assert.equal(result.status, "failed");
    assert.equal(f.writes().length, 0);
    assert.ok(!JSON.stringify(result).includes("connection string"));
  }
});
await check("registration removed or changed between reads prevents PATCH", async () => {
  const f = fixture();
  let reads = 0;
  f.onRead(() => { if (++reads === 2) f.state().githubStations[0].companionRepos = []; });
  const result = await cleanupCompanionAbout(target, { ...f.deps, apply: true });
  assert.equal(result.status, "failed");
  assert.equal(f.writes().length, 0);
});
await check("post-write mismatches are reported as failures with actual write count", async () => {
  const f = fixture();
  f.onPatch(() => { f.info.description = `Unexpected ${marker}`; });
  const result = await cleanupCompanionAbout(target, { ...f.deps, apply: true });
  assert.equal(result.status, "failed");
  assert.equal(result.writes, 1);
});
await check("repo filters select only exact registered companions and pending entries", () => {
  const f = fixture();
  assert.deepEqual(companionAboutTargets(f.state(), "FIXTURE/Utility"), [target]);
  assert.throws(() => companionAboutTargets(f.state(), "fixture/worker"), /not a registered companion/);
  assert.throws(() => companionAboutTargets(f.state(), "fixture/unregistered"), /not a registered companion/);
  assert.throws(() => companionAboutTargets(f.state(), "https://private.example.invalid"), /valid owner\/repo/);
});
await check("transport fixes host, refuses redirects, bounds time, and hides API response text", async () => {
  const f = fixture();
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const request = companionAboutRequest("fixture-pat", (async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({ message: "private-body-must-not-be-logged" }), { status: 403 });
  }) as typeof fetch);
  const result = await cleanupCompanionAbout(target, { ...f.deps, request, apply: true });
  assert.equal(result.status, "failed");
  assert.equal(result.note, "GitHub metadata HTTP 403.");
  assert.equal(calls[0].url, "https://api.github.com/repos/fixture/utility");
  assert.equal(calls[0].init?.redirect, "error");
  assert.ok(calls[0].init?.signal instanceof AbortSignal);
  assert.ok(!JSON.stringify(result).includes("private-body"));
  await assert.rejects(request("GET", "/repos/fixture/utility/contents/README.md"), /Unexpected/);
  await assert.rejects(request("GET", "/repos/fixture/utility?url=https://private.example.invalid"), /Unexpected/);
  await assert.rejects(request("PATCH", "/repos/fixture/utility", { description: "text", homepage: "unwanted" } as { description: string }), /Unexpected/);
  assert.equal(calls.length, 1);
});
await check("oversized bodies and expired operation deadlines fail without exposing private data", async () => {
  const f = fixture();
  const oversized = companionAboutRequest("fixture-pat", (async () => new Response("x".repeat(1024 * 1024 + 1))) as typeof fetch);
  const result = await cleanupCompanionAbout(target, { ...f.deps, request: oversized });
  assert.equal(result.status, "failed");
  assert.equal(result.note, "GitHub metadata response exceeds the size limit.");
  let calls = 0;
  const expired = companionAboutRequest("fixture-pat", (async () => { calls++; throw new Error(); }) as typeof fetch, Date.now() - 1);
  await assert.rejects(expired("GET", "/repos/fixture/utility"), /time limit/);
  assert.equal(calls, 0);
});

console.log(`\n${count} companion metadata scenarios passed with injected transport and state only.`);
