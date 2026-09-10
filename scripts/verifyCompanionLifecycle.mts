#!/usr/bin/env node
/** Offline lifecycle integration: no database, real credentials, network, or model-code execution. */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { encryptSecret } from "../src/lib/crypto/secretBox";
import { createCompanionEngine } from "../src/lib/services/companionNurture";
import { appSettingsSchema, type AppSettings } from "../src/lib/services/settings";
import type { CompanionGithub, RepoInfo, RepoSnapshot, SourceFile } from "../src/lib/services/companionGithub";
import type { CompanionDecision } from "../src/lib/services/ollamaCompanion";

type Station = AppSettings["githubStations"][number];
type Dependencies = NonNullable<Parameters<typeof createCompanionEngine>[0]>;
type PlanInput = Parameters<Dependencies["plan"]>[0];
type Event = { method: string; slug: string; files?: SourceFile[]; message?: string; description?: string };

const previousEncryptionKey = process.env.ENCRYPTION_KEY;
const previousDatabaseUrl = process.env.DATABASE_URL;
const previousFetch = globalThis.fetch;
process.env.ENCRYPTION_KEY = randomBytes(32).toString("hex");
delete process.env.DATABASE_URL;
let attemptedNetwork = 0;
globalThis.fetch = (async () => {
  attemptedNetwork++;
  throw new Error("Lifecycle verifier forbids network access.");
}) as typeof fetch;

const FIXTURE_PAT = "offline-fixture-pat";
const SLUG = "fixture/worker-main";
const modelSource = [
  { path: "README.md", content: "# Library explorer\nA small local catalog with a search function.\n" },
  { path: "src/catalog.py", content: "def find_titles(titles, query):\n    return [title for title in titles if query.lower() in title.lower()]\n" },
];
const decision = (action: CompanionDecision["action"], repo = "library-explorer", extra: Partial<CompanionDecision> = {}): CompanionDecision => ({
  action, repo, description: "Search a local catalog", reason: "Improve the local catalog search", commitMessage: "feat: add catalog search",
  files: action === "create" || action === "commit" ? structuredClone(modelSource) : [], nextCheckMinutes: 30, ...extra,
});
function stationFixture(overrides: Record<string, unknown> = {}): Station {
  const parsed = appSettingsSchema.parse({ githubStations: [{ owner: "fixture", repo: "worker-main", workerId: "worker-main", pat: encryptSecret(FIXTURE_PAT), enabled: true, ...overrides }] });
  assert.equal(parsed.githubStations.length, 1, "test station must pass the real settings schema");
  return parsed.githubStations[0];
}
function companionFixture(repo = "library-explorer", githubId = 101, extra: Record<string, unknown> = {}) {
  return { repo, githubId, managedBy: "ollama", actionsDisabled: true, ...extra };
}

function harness(options: {
  station?: Record<string, unknown>;
  otherStations?: Station[];
  config?: Record<string, unknown>;
  decisions?: CompanionDecision[];
  busy?: string;
  loseCreateResponse?: boolean;
} = {}) {
  let state = appSettingsSchema.parse({
    githubNurture: { apiKeys: [{ id: "fixture-key", label: "Offline test key", secret: encryptSecret("offline-ollama-key") }], ...options.config },
    githubStations: [stationFixture(options.station), ...(options.otherStations ?? [])],
  });
  const events: Event[] = [];
  const plans: PlanInput[] = [];
  const leases: string[] = [];
  const counters = { reads: 0, mutations: 0, githubFactories: 0 };
  const remote = new Map<string, RepoInfo>();
  const storedFiles = new Map<string, SourceFile[]>();
  for (const station of state.githubStations) {
    for (const c of station.companionRepos) {
      const slug = `${station.owner}/${c.repo}`.toLowerCase();
      remote.set(slug, { id: c.githubId ?? 101, full_name: `${station.owner}/${c.repo}`, default_branch: "main", private: false });
      storedFiles.set(slug, [{ path: "src/catalog.py", content: "def find_titles(titles, query):\n    return []\n" }]);
    }
  }
  const pendingDecisions = [...(options.decisions ?? [])];
  let onPlan: ((input: PlanInput) => void | Promise<void>) | undefined;
  let rejectMutation: ((next: AppSettings, previous: AppSettings) => boolean) | undefined;
  let loseCreateResponse = options.loseCreateResponse ?? false;
  let serial = 1000;
  const fakeGithub = {
    async info(owner: string, repo: string): Promise<RepoInfo | null> {
      const slug = `${owner}/${repo}`.toLowerCase();
      events.push({ method: "info", slug });
      return structuredClone(remote.get(slug) ?? null);
    },
    async create(owner: string, repo: string, description: string): Promise<RepoInfo> {
      const slug = `${owner}/${repo}`.toLowerCase();
      assert.ok(!remote.has(slug), "fake GitHub must never overwrite a repository");
      events.push({ method: "create", slug, description });
      const info: RepoInfo = { id: ++serial, full_name: `${owner}/${repo}`, default_branch: "main", private: false, description };
      remote.set(slug, info);
      if (loseCreateResponse) {
        loseCreateResponse = false;
        throw new Error("Simulated create response lost after remote accepted the repository.");
      }
      return structuredClone(info);
    },
    async fork(): Promise<RepoInfo> { throw new Error("Unexpected fork in lifecycle fixture."); },
    async disableActions(owner: string, repo: string) { events.push({ method: "disableActions", slug: `${owner}/${repo}`.toLowerCase() }); },
    async snapshot(owner: string, repo: string): Promise<RepoSnapshot | null> {
      const slug = `${owner}/${repo}`.toLowerCase();
      events.push({ method: "snapshot", slug });
      const info = remote.get(slug);
      if (!info) return null;
      return { branch: "main", head: "fixture-head", tree: "fixture-tree", githubId: info.id, context: "Existing local catalog source.",
        files: new Map((storedFiles.get(slug) ?? []).map((file) => [file.path, { sha: "fixture-blob", mode: "100644", content: file.content ?? "" }])) };
    },
    async commit(owner: string, repo: string, _snapshot: RepoSnapshot, files: SourceFile[], message: string) {
      const slug = `${owner}/${repo}`.toLowerCase();
      events.push({ method: "commit", slug, files: structuredClone(files), message });
      storedFiles.set(slug, structuredClone(files));
      return { pushed: 1, sha: `fixture-commit-${++serial}` };
    },
    async delete(owner: string, repo: string) {
      const slug = `${owner}/${repo}`.toLowerCase();
      events.push({ method: "delete", slug });
      assert.ok(remote.delete(slug), "fake GitHub only deletes a known fixture repository");
    },
  };
  const deps: Dependencies = {
    read: async () => { counters.reads++; return structuredClone(state); },
    mutate: async (change) => {
      const fresh = structuredClone(state);
      change(fresh);
      const parsed = appSettingsSchema.parse(fresh);
      assert.equal(parsed.githubStations.length, fresh.githubStations.length, "state checkpoint must not silently discard the register");
      if (rejectMutation?.(parsed, state)) {
        rejectMutation = undefined;
        throw new Error("Simulated settings checkpoint save failure.");
      }
      state = parsed;
      counters.mutations++;
    },
    lease: async <T,>(slug: string, work: () => Promise<T>): Promise<T | null> => {
      leases.push(slug);
      return slug === options.busy ? null : work();
    },
    plan: async (input) => {
      plans.push(structuredClone(input));
      await onPlan?.(input);
      const next = pendingDecisions.shift();
      assert.ok(next, "unexpected model call: no decision queued");
      return structuredClone(next);
    },
    github: (pat) => {
      assert.equal(pat, FIXTURE_PAT, "only the isolated fixture credential may reach the fake adapter");
      counters.githubFactories++;
      return fakeGithub as unknown as CompanionGithub;
    },
  };
  return {
    engine: createCompanionEngine(deps), events, plans, leases, counters, remote, storedFiles,
    state: () => structuredClone(state),
    setPlanHook: (hook: typeof onPlan) => { onPlan = hook; },
    failNextMutationWhen: (predicate: NonNullable<typeof rejectMutation>) => { rejectMutation = predicate; },
    update: (change: (value: AppSettings) => void) => { const next = structuredClone(state); change(next); state = appSettingsSchema.parse(next); },
    mutations: () => events.filter((event) => ["create", "fork", "commit", "delete", "disableActions"].includes(event.method)),
  };
}

let passed = 0;
let failed = 0;
async function test(name: string, work: () => Promise<void>) {
  try { await work(); passed++; console.log(`✔ ${name}`); }
  catch (error) { failed++; console.error(`✖ ${name}`); console.error(error); }
}

try {
  await test("default count of three is reached over resumable runs and model source is registered unchanged", async () => {
    const h = harness({ decisions: [decision("create", "catalog-one"), decision("create", "catalog-two"), decision("create", "catalog-three")] });
    assert.equal(h.state().githubNurture.defaultCompanionCount, 3);
    for (let index = 1; index <= 3; index++) {
      const result = await h.engine.run({ stationSlug: SLUG });
      assert.equal(result.failed, 0);
      assert.equal(result.pushed, 1);
      assert.equal(h.state().githubStations[0].companionRepos.length, index);
    }
    const state = h.state();
    assert.equal(state.githubStations[0].repo, "worker-main");
    assert.equal(state.githubStations[0].nurturePending, undefined);
    for (const companion of state.githubStations[0].companionRepos) {
      assert.equal(companion.managedBy, "ollama");
      assert.equal(companion.actionsDisabled, true);
      assert.ok(companion.githubId);
      assert.equal(companion.lastPushOk, true);
      assert.deepEqual(h.storedFiles.get(`fixture/${companion.repo}`), modelSource);
    }
    assert.deepEqual(h.events.slice(0, 4).map((event) => event.method), ["info", "create", "disableActions", "commit"]);
    assert.ok(h.events.find((event) => event.method === "create")?.description?.includes("[companion:"));
    assert.equal(h.plans[0].mode, "create");
    assert.ok(h.plans[0].existingRepos.includes("worker-main"));
    assert.ok(h.plans[2].existingRepos.includes("catalog-one"));
    const complete = await h.engine.run({ stationSlug: SLUG });
    assert.equal(complete.pushed, 0);
    assert.equal(h.plans.length, 3);
  });

  await test("station count override zero creates no companion under global default three", async () => {
    const h = harness({ station: { companionCountOverride: 0 } });
    const result = await h.engine.run();
    assert.equal(result.failed, 0);
    assert.equal(result.pushed, 0);
    assert.equal(h.state().githubStations[0].companionRepos.length, 0);
    assert.equal(h.plans.length, 0);
    assert.equal(h.mutations().length, 0);
  });

  await test("create wait decision persists a future station schedule without GitHub mutation", async () => {
    const start = Date.now();
    const h = harness({ decisions: [decision("wait", "catalog-later", { nextCheckMinutes: 90, reason: "Revisit the catalog design later" })] });
    const result = await h.engine.run();
    assert.equal(result.failed, 0);
    const station = h.state().githubStations[0];
    assert.ok(Date.parse(station.nurtureNextAt!) >= start + 90 * 60_000);
    assert.equal(station.nurtureLastNote, "Revisit the catalog design later");
    assert.equal(h.mutations().length, 0);
    await h.engine.run();
    assert.equal(h.plans.length, 1);
  });

  await test("maintenance wait persists the companion schedule and leaves source and quota unchanged", async () => {
    const start = Date.now();
    const h = harness({ station: { companionCountOverride: 1, companionRepos: [companionFixture()] }, decisions: [decision("wait", "library-explorer", { nextCheckMinutes: 75 })] });
    const filesBefore = structuredClone(h.storedFiles);
    const result = await h.engine.run();
    assert.equal(result.failed, 0);
    assert.equal(result.pushed, 0);
    const companion = h.state().githubStations[0].companionRepos[0];
    assert.ok(Date.parse(companion.nextDecisionAt!) >= start + 75 * 60_000);
    assert.equal(companion.pushesToday, 0);
    assert.equal(companion.lastCommitSha, "fixture-head");
    assert.equal(h.mutations().length, 0);
    assert.deepEqual(h.storedFiles, filesBefore);
    await h.engine.run();
    assert.equal(h.plans.length, 1);
  });

  await test("manual deletion removes only the registered companion and schedules replenishment", async () => {
    const h = harness({ station: { companionRepos: [companionFixture()], nurtureNextAt: "2099-01-01T00:00:00.000Z" } });
    await h.engine.remove(SLUG, "LIBRARY-EXPLORER");
    const station = h.state().githubStations[0];
    assert.equal(station.companionRepos.length, 0);
    assert.equal(station.repo, "worker-main");
    assert.equal(station.nurtureNextAt, null);
    assert.deepEqual(h.events.map((event) => event.method), ["info", "delete"]);
  });

  await test("manual deletion protects the station primary even if erroneously listed as a companion", async () => {
    const h = harness({ station: { companionRepos: [companionFixture("worker-main")] } });
    await assert.rejects(h.engine.remove(SLUG, "WORKER-MAIN"), /kho chính/);
    assert.equal(h.counters.githubFactories, 0);
    assert.equal(h.state().githubStations[0].companionRepos.length, 1);
  });

  await test("manual deletion protects every other station primary for the same owner", async () => {
    const h = harness({ station: { companionRepos: [companionFixture("other-worker")] }, otherStations: [stationFixture({ repo: "OTHER-WORKER" })] });
    await assert.rejects(h.engine.remove(SLUG, "other-worker"), /kho chính/);
    assert.equal(h.counters.githubFactories, 0);
    assert.equal(h.state().githubStations.length, 2);
  });

  await test("manual deletion refuses an unknown companion without looking up GitHub", async () => {
    const h = harness({ station: { companionRepos: [companionFixture()] } });
    await assert.rejects(h.engine.remove(SLUG, "unknown-project"), /không nằm trong sổ/);
    assert.equal(h.counters.githubFactories, 0);
    assert.equal(h.state().githubStations[0].companionRepos.length, 1);
  });

  await test("manual deletion refuses an unavailable remote instead of silently removing the register entry", async () => {
    const h = harness({ station: { companionRepos: [companionFixture()] } });
    h.remote.clear();
    await assert.rejects(h.engine.remove(SLUG, "library-explorer"), /kiểm tra quyền truy cập/);
    assert.equal(h.mutations().length, 0);
    assert.equal(h.state().githubStations[0].companionRepos.length, 1);
  });

  await test("manual deletion refuses a replacement repository with a changed GitHub ID", async () => {
    const h = harness({ station: { companionRepos: [companionFixture()] } });
    h.remote.get("fixture/library-explorer")!.id = 999;
    await assert.rejects(h.engine.remove(SLUG, "library-explorer"), /ID repo đã thay đổi/);
    assert.equal(h.mutations().length, 0);
    assert.equal(h.state().githubStations[0].companionRepos[0].pendingDelete, undefined);
  });

  for (const [name, keys] of [
    ["missing", []],
    ["disabled", [{ id: "blocked-key", label: "Blocked", secret: "fixture-only", disabled: true }]],
    ["cooling down", [{ id: "waiting-key", label: "Waiting", secret: "fixture-only", cooldownUntil: "2099-01-01T00:00:00.000Z" }]],
  ] as const) {
    await test(`${name} Ollama keys cause a visible failure before any GitHub mutation`, async () => {
      const h = harness({ config: { apiKeys: keys } });
      const result = await h.engine.run();
      assert.equal(result.failed, 1);
      assert.match(result.results[0].note, /API key Ollama/);
      assert.equal(h.plans.length, 0);
      assert.equal(h.counters.githubFactories, 0);
      assert.equal(h.mutations().length, 0);
    });
  }

  await test("model deletion is blocked when the per-station toggle is off", async () => {
    const h = harness({ station: { companionCountOverride: 1, allowCompanionDelete: false, companionRepos: [companionFixture()] }, decisions: [decision("delete")] });
    const result = await h.engine.run();
    assert.equal(result.failed, 1);
    assert.equal(h.events.filter((event) => event.method === "delete").length, 0);
    assert.equal(h.state().githubStations[0].companionRepos.length, 1);
  });

  await test("enabled model deletion also applies to registered legacy companions", async () => {
    const h = harness({ station: { companionCountOverride: 1, allowCompanionDelete: true, companionRepos: [companionFixture("library-explorer", 101, { managedBy: undefined })] }, decisions: [decision("delete")] });
    const result = await h.engine.run();
    assert.equal(result.failed, 0);
    assert.equal(h.events.filter((event) => event.method === "delete").length, 1);
    assert.equal(h.state().githubStations[0].companionRepos.length, 0);
  });

  await test("model deletion rechecks a toggle disabled while the model was planning", async () => {
    const h = harness({ station: { companionCountOverride: 1, allowCompanionDelete: true, companionRepos: [companionFixture()] }, decisions: [decision("delete")] });
    h.setPlanHook(() => h.update((state) => { state.githubStations[0].allowCompanionDelete = false; }));
    const result = await h.engine.run();
    assert.equal(result.failed, 1);
    assert.equal(h.events.filter((event) => event.method === "delete").length, 0);
    assert.equal(h.state().githubStations[0].companionRepos.length, 1);
  });

  await test("model deletion succeeds for an owned companion with the toggle enabled", async () => {
    const h = harness({ station: { companionCountOverride: 1, allowCompanionDelete: true, companionRepos: [companionFixture()] }, decisions: [decision("delete")] });
    const result = await h.engine.run();
    assert.equal(result.failed, 0);
    assert.equal(result.pushed, 0);
    assert.equal(h.events.filter((event) => event.method === "delete").length, 1);
    assert.equal(h.state().githubStations[0].companionRepos.length, 0);
    assert.equal(h.state().githubStations[0].nurtureNextAt, null);
  });

  await test("busy global lease skips the run without reading or mutating settings", async () => {
    const h = harness({ busy: "all-runners" });
    const result = await h.engine.run();
    assert.equal(result.skipped, 1);
    assert.equal(result.checked, 0);
    assert.deepEqual(h.counters, { reads: 0, mutations: 0, githubFactories: 0 });
    assert.equal(h.plans.length, 0);
  });

  await test("busy station lease skips its runtime work and rejects manual deletion", async () => {
    const h = harness({ busy: SLUG, station: { companionRepos: [companionFixture()] } });
    const result = await h.engine.run();
    assert.equal(result.skipped, 1);
    assert.equal(result.checked, 0);
    await assert.rejects(h.engine.remove(SLUG, "library-explorer"), /đang có lượt nuôi chạy/);
    assert.equal(h.counters.mutations, 0);
    assert.equal(h.counters.githubFactories, 0);
    assert.equal(h.plans.length, 0);
  });

  await test("lost create response keeps its reservation and recovers the marked remote without another create", async () => {
    const h = harness({ station: { companionCountOverride: 1 }, loseCreateResponse: true, decisions: [decision("create"), decision("commit")] });
    const interrupted = await h.engine.run();
    assert.equal(interrupted.failed, 1);
    const pending = h.state().githubStations[0].nurturePending;
    assert.ok(pending);
    assert.equal(pending.githubId, undefined, "no response means the host has not learned the ID yet");
    assert.equal(h.state().githubStations[0].companionRepos.length, 0);
    const remote = h.remote.get("fixture/library-explorer")!;
    assert.ok(remote.description?.includes(`companion:${pending.operationId}`));
    const resumed = await h.engine.run();
    assert.equal(resumed.failed, 0);
    assert.equal(resumed.pushed, 1);
    assert.equal(h.events.filter((event) => event.method === "create").length, 1);
    assert.equal(h.state().githubStations[0].nurturePending, undefined);
    assert.equal(h.state().githubStations[0].companionRepos[0].githubId, remote.id);
    assert.deepEqual(h.storedFiles.get("fixture/library-explorer"), modelSource);
    assert.deepEqual(h.plans.map((input) => input.mode), ["create", "maintain"]);
  });

  await test("create recovery refuses a same-name remote without the pending operation marker", async () => {
    const h = harness({ station: { companionCountOverride: 1 }, loseCreateResponse: true, decisions: [decision("create")] });
    await h.engine.run();
    h.remote.get("fixture/library-explorer")!.description = "An unrelated existing project";
    const before = h.mutations().length;
    const resumed = await h.engine.run();
    assert.equal(resumed.failed, 1);
    assert.match(resumed.results[0].note, /chưa xác minh được ID/);
    assert.equal(h.mutations().length, before);
    assert.equal(h.state().githubStations[0].companionRepos.length, 0);
    assert.ok(h.state().githubStations[0].nurturePending);
  });

  await test("failed post-delete save keeps the confirmed ID and protects a same-name replacement on retry", async () => {
    const h = harness({ station: { companionRepos: [companionFixture("library-explorer", 101, { githubId: undefined })] } });
    h.failNextMutationWhen((next) => next.githubStations[0].companionRepos.length === 0);
    await assert.rejects(h.engine.remove(SLUG, "library-explorer"), /checkpoint save failure/);
    const pending = h.state().githubStations[0].companionRepos[0];
    assert.equal(pending.pendingDelete, true);
    assert.equal(pending.githubId, 101, "the identity must be persisted before the destructive request");
    assert.equal(h.remote.has("fixture/library-explorer"), false);
    h.remote.set("fixture/library-explorer", { id: 999, full_name: "fixture/library-explorer", default_branch: "main", private: false });
    await assert.rejects(h.engine.remove(SLUG, "library-explorer"), /ID repo đã thay đổi/);
    assert.equal(h.events.filter((event) => event.method === "delete").length, 1);
    assert.equal(h.remote.get("fixture/library-explorer")!.id, 999);
    assert.equal(h.state().githubStations[0].companionRepos[0].pendingDelete, true);
  });

  await test("an ambiguous pending fork without a confirmed ID remains blocked for operator recovery", async () => {
    const h = harness({ station: { nurturePending: { repo: "catalog-fork", operationId: "fixture-operation", kind: "fork", source: "upstream/catalog" } } });
    h.remote.set("fixture/catalog-fork", { id: 444, full_name: "fixture/catalog-fork", default_branch: "main", private: false, parent: { full_name: "upstream/catalog" } });
    const result = await h.engine.run();
    assert.equal(result.failed, 1);
    assert.equal(h.state().githubStations[0].companionRepos.length, 0);
    assert.ok(h.state().githubStations[0].nurturePending);
    assert.equal(h.plans.length, 0);
    assert.equal(h.mutations().length, 0);
  });

  await test("a successful delete with a failed register save is completed without an Ollama key", async () => {
    const h = harness({ station: { companionRepos: [companionFixture()] }, config: { apiKeys: [] } });
    h.failNextMutationWhen((next) => next.githubStations[0].companionRepos.length === 0);
    await assert.rejects(h.engine.remove(SLUG, "library-explorer"), /checkpoint save failure/);
    assert.equal(h.state().githubStations[0].companionRepos[0].pendingDelete, true);
    const resumed = await h.engine.run();
    assert.equal(resumed.failed, 0);
    assert.equal(h.state().githubStations[0].companionRepos.length, 0);
    assert.equal(h.events.filter((event) => event.method === "delete").length, 1);
    assert.equal(h.plans.length, 0);
  });

  await test("a previously requested pending deletion can finish before the no-key creation gate", async () => {
    const h = harness({ station: { companionRepos: [companionFixture("library-explorer", 101, { pendingDelete: true })] }, config: { apiKeys: [] } });
    const result = await h.engine.run();
    assert.equal(result.failed, 0);
    assert.equal(h.events.filter((event) => event.method === "delete").length, 1);
    assert.equal(h.state().githubStations[0].companionRepos.length, 0);
    assert.equal(h.plans.length, 0);
  });

  for (const [name, change] of [
    ["station disabled", (station: Station) => { station.enabled = false; }],
    ["daily work paused", (station: Station) => { station.dailyPushes = 0; }],
    ["target reduced to zero", (station: Station) => { station.companionCountOverride = 0; }],
  ] as const) {
    await test(`create respects ${name} while the model is planning`, async () => {
      const h = harness({ decisions: [decision("create")] });
      h.setPlanHook(() => h.update((state) => change(state.githubStations[0])));
      const result = await h.engine.run();
      assert.equal(result.failed, 0);
      assert.equal(h.counters.githubFactories, 0);
      assert.equal(h.mutations().length, 0);
      assert.equal(h.state().githubStations[0].companionRepos.length, 0);
    });
  }

  await test("fork permission disabled during model planning prevents all GitHub mutation", async () => {
    const h = harness({ station: { allowCompanionFork: true }, decisions: [decision("fork", "catalog-fork", { forkFrom: "upstream/catalog" })] });
    h.setPlanHook(() => h.update((state) => { state.githubStations[0].allowCompanionFork = false; }));
    const result = await h.engine.run();
    assert.equal(result.failed, 1);
    assert.equal(h.counters.githubFactories, 0);
    assert.equal(h.mutations().length, 0);
  });

  await test("model configuration edited during planning survives key-health checkpoint merges", async () => {
    const h = harness({ decisions: [decision("wait")] });
    h.setPlanHook((input) => {
      input.config.apiKeys[0].lastUsedAt = new Date().toISOString();
      h.update((state) => {
        state.githubNurture.model = "changed-model:fixture";
        state.githubNurture.contextWindow = 8192;
        state.githubNurture.apiKeys[0].disabled = true;
      });
    });
    const result = await h.engine.run();
    assert.equal(result.failed, 0);
    assert.equal(h.state().githubNurture.model, "changed-model:fixture");
    assert.equal(h.state().githubNurture.contextWindow, 8192);
    assert.equal(h.state().githubNurture.apiKeys[0].disabled, true);
    assert.equal(h.mutations().length, 0);
  });

  await test("maintenance refuses a companion removed from the register while the model plans", async () => {
    const h = harness({ station: { companionCountOverride: 1, companionRepos: [companionFixture()] }, decisions: [decision("commit")] });
    h.setPlanHook(() => h.update((state) => { state.githubStations[0].companionRepos = []; }));
    const result = await h.engine.run();
    assert.equal(result.failed, 1);
    assert.equal(h.mutations().length, 0);
    assert.ok(h.remote.has("fixture/library-explorer"));
  });

  await test("maintenance refuses a companion newly registered as another station primary during planning", async () => {
    const h = harness({ station: { companionCountOverride: 1, companionRepos: [companionFixture()] }, decisions: [decision("commit")] });
    h.setPlanHook(() => h.update((state) => { state.githubStations.push(stationFixture({ repo: "library-explorer" })); }));
    const result = await h.engine.run();
    assert.equal(result.failed, 1);
    assert.equal(h.mutations().length, 0);
    assert.match(result.results[0].note, /kho chính/);
  });

  await test("fork destination colliding with a registered primary is rejected before GitHub access", async () => {
    const h = harness({ station: { allowCompanionFork: true }, otherStations: [stationFixture({ repo: "reserved-catalog" })], decisions: [decision("fork", "reserved-catalog", { forkFrom: "upstream/catalog" })] });
    const result = await h.engine.run({ stationSlug: SLUG });
    assert.equal(result.failed, 1);
    assert.equal(h.counters.githubFactories, 0);
    assert.equal(h.mutations().length, 0);
  });

  await test("fork destination colliding with an unregistered remote only performs the existence lookup", async () => {
    const h = harness({ station: { allowCompanionFork: true }, decisions: [decision("fork", "catalog-fork", { forkFrom: "upstream/catalog" })] });
    h.remote.set("fixture/catalog-fork", { id: 987, full_name: "fixture/catalog-fork", default_branch: "main", private: false });
    const result = await h.engine.run();
    assert.equal(result.failed, 1);
    assert.deepEqual(h.events.map((event) => event.method), ["info"]);
    assert.equal(h.mutations().length, 0);
    assert.equal(h.remote.get("fixture/catalog-fork")!.id, 987);
  });

  await test("an invalid generated destination is rejected before GitHub access", async () => {
    const h = harness({ decisions: [decision("create", "../worker-main")] });
    const result = await h.engine.run();
    assert.equal(result.failed, 1);
    assert.equal(h.counters.githubFactories, 0);
    assert.equal(h.mutations().length, 0);
  });

  await test("lastRunAt advances the visited station so the next budget resumes older unvisited stations first", async () => {
    const h = harness({ station: { nurtureLastRunAt: "2002-01-01T00:00:00.000Z" }, otherStations: [
      stationFixture({ repo: "older-worker", nurtureLastRunAt: "2001-01-01T00:00:00.000Z" }),
      stationFixture({ repo: "never-visited" }),
    ], decisions: [decision("wait"), decision("wait"), decision("wait")] });
    const originalNow = Date.now;
    const started = originalNow();
    let fakeNow = started;
    Date.now = () => fakeNow;
    h.setPlanHook(() => { fakeNow += 20_000; });
    try {
      const bounded = await h.engine.run({ deadlineAt: started + 25_000 });
      assert.equal(bounded.failed, 0);
      assert.equal(bounded.skipped, 2);
      assert.deepEqual(h.plans.map((input) => input.station.repo), ["never-visited"]);
      const visited = h.state().githubStations.find((station) => station.repo === "never-visited")!;
      assert.ok(Date.parse(visited.nurtureLastRunAt!) >= started);
      assert.equal(h.state().githubStations[0].nurtureLastRunAt, "2002-01-01T00:00:00.000Z");
    } finally { Date.now = originalNow; h.setPlanHook(undefined); }
    const resumed = await h.engine.run();
    assert.equal(resumed.failed, 0);
    assert.deepEqual(h.plans.map((input) => input.station.repo), ["never-visited", "older-worker", "worker-main"]);
  });

  await test("all lifecycle scenarios remain offline", async () => { assert.equal(attemptedNetwork, 0); });
} finally {
  globalThis.fetch = previousFetch;
  if (previousEncryptionKey === undefined) delete process.env.ENCRYPTION_KEY;
  else process.env.ENCRYPTION_KEY = previousEncryptionKey;
  if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousDatabaseUrl;
}
console.log(`\n${passed} lifecycle scenarios passed; ${failed} failed. No real GitHub, Ollama, or database calls.`);
if (failed) process.exitCode = 1;
