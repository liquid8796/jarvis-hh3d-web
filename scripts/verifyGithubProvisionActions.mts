import assert from "node:assert/strict";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { provisionGithubStation, type GithubProvisionDependencies, type GithubProvisionContext } from "../src/lib/services/githubProvisioning";
import type { AppSettings } from "../src/lib/services/settings";
import type { GithubStationFormDependencies, GithubStationFormResult } from "../src/lib/services/githubStationForms";

// Execute the real exported Next actions and form boundary, replacing only external effects.
const root = process.cwd();
const mocks: Record<string, string> = {
  "next/cache": "export const revalidatePath = path => globalThis.__stationFixture.events.push('invalidate:' + path);",
  "@/lib/auth/guards": "export const requireAdmin = async () => { globalThis.__stationFixture.events.push('auth'); return {}; };",
  "@/lib/auth/permissions": "export const hasPermission = (_user, permission) => { if(permission !== 'github_station.manage') throw Error('wrong permission'); globalThis.__stationFixture.events.push('permission'); return globalThis.__stationFixture.allowed; };",
  "@/lib/crypto/secretBox": "export const encryptSecret = pat => globalThis.__stationFixture.deps.encrypt(pat); export const isEncrypted = pat => globalThis.__stationFixture.deps.isEncrypted(pat); export const decryptSecret = () => {throw Error('not used');};",
  "@/lib/services/settings": "export const getAppSettings = () => globalThis.__stationFixture.deps.getSettings();",
  "@/lib/services/companionState": "export const mutateGithubState = change => globalThis.__stationFixture.deps.mutate(change);",
  "@/lib/services/githubProvisioning": "export const provisionGithubStation = input => globalThis.__stationFixture.deps.provision(input); export const productionGithubProvisionDependencies = { whoami: (pat,budget) => globalThis.__stationFixture.deps.whoami(pat,budget) };",
  "@/lib/services/githubPrimaryDeletion": "export const deletePrimaryGithubAccountGroup = (slug,expectedGroup) => globalThis.__stationFixture.deps.deletePrimary(slug,expectedGroup);",
  "@/lib/services/githubStations": "export const pingStationBySlug = slug => globalThis.__stationFixture.deps.ping(slug); export const runCompanionNurture = async () => ({}); export const runKeepalive = async () => ({});",
};
const bundle = await build({ entryPoints: [resolve(root, "src/app/actions/githubStations.ts")], bundle: true, write: false, platform: "node", format: "cjs", plugins: [{
  name: "offline-action-effects",
  setup(builder) {
    builder.onResolve({ filter: /^(?:@\/|next\/)/ }, ({ path }) => path in mocks
      ? { path, namespace: "mock" }
      : { path: resolve(root, "src", path.slice(2)) + ".ts" });
    builder.onLoad({ filter: /.*/, namespace: "mock" }, ({ path }) => ({ contents: mocks[path], loader: "js" }));
  },
}] });
type ActionResult = GithubStationFormResult & { deletedPrimaries?: number; retainedCompanions?: number; detached?: boolean };
type Action = (previous: GithubStationFormResult | null, form: FormData) => Promise<ActionResult>;
const module = { exports: {} as Record<"provisionGithubStationAction" | "updateGithubStationAction" | "saveGithubStationAction" | "deleteGithubStationAction", Action> };
new Function("require", "module", "exports", bundle.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const actions = module.exports;
const pat = "offline-fixture-pat-never-log";
function form(values: Record<string, string | undefined>) { const data = new FormData(); for (const [key, value] of Object.entries(values)) if (value !== undefined) data.set(key, value); return data; }
function station(provisionedBy?: "jarvis"): AppSettings["githubStations"][number] {
  return { owner: "FixtureOwner", repo: "existing-repo", workflowFile: "linh-su.yml", workerId: "existing-repo", pat: "encrypted:old",
    provisionedBy, githubId: provisionedBy ? 42 : undefined, initialCommitSha: provisionedBy ? "initial-sha" : undefined,
    enabled: true, dailyPushes: 7, lastPingAt: null, lastCommitAt: "2026-09-01T00:00:00Z", lastPingOk: null, lastPingNote: "old", workflowState: "active",
    companionRepos: [{ repo: "software-one", lastNurtureDay: "2026-09-11", pushesToday: 2, lastPushAt: null, lastPushOk: true, lastPushNote: "saved", managedBy: "ollama", topic: "kept" }],
    companionCountOverride: 3, allowCompanionFork: true, allowCompanionDelete: false, nurtureNextAt: "2026-09-12T00:00:00Z", nurtureLastNote: "runtime", nurturePending: undefined,
  };
}
function fixture(provisionedBy?: "jarvis") {
  const events: string[] = [];
  const f = {
    allowed: true, events, settings: { githubStations: [station(provisionedBy)] } as AppSettings,
    beforeMutation: () => {}, normalized: undefined as GithubProvisionContext | undefined, submitted: undefined as Parameters<GithubStationFormDependencies["provision"]>[0] | undefined,
    probeStatus: 404, warning: false,
    deps: {} as GithubStationFormDependencies,
  };
  const lifecycle: GithubProvisionDependencies = {
    generateRepoName: async () => { events.push("llm-name"); return "random-project"; },
    generateWorkerId: async () => { events.push("worker-id"); return "worker-identity"; },
    listKhoiloiNames: async () => { events.push("khoiloi-names"); return ["sect-worker"]; },
    whoami: async () => { events.push("whoami-create"); return { login: "FixtureOwner", scopes: "repo,workflow,delete_repo" }; },
    checkScopes: async () => {}, localPreflight: async (ctx) => { f.normalized = ctx; return { directory: "offline", encryptedPat: "encrypted:new", workerToken: "fixture-worker-token" }; },
    checkSettings: async () => {}, checkWorker: async () => {}, probe: async () => ({ status: f.probeStatus }),
    acquireLease: async () => ({ assertHeld: async () => {}, release: async () => {} }),
    stage: async () => ({ initialCommitSha: "test-sha" }), create: async () => { events.push("create"); return { status: 201, githubId: 123 }; },
    push: async () => {}, checkActions: async () => { events.push("actions-check"); return { ok: true }; }, setSecret: async () => {}, register: async () => { events.push("register"); },
    cleanupSnapshot: async () => ({ githubId: 123, head: "test-sha", referenced: false }), deleteRepo: async () => { events.push("delete"); },
    dispatch: async () => { if (f.warning) throw Error(pat + " child stderr"); }, ping: async () => {}, nurture: async () => {}, dispose: async () => {},
  };
  f.deps = {
    requireManage: async () => {},
    provision: async (input) => { events.push("provision"); f.submitted = input; return provisionGithubStation(input, lifecycle); },
    getSettings: async () => { events.push("read"); return structuredClone(f.settings); },
    mutate: async (change) => { events.push("mutate"); f.beforeMutation(); const draft = structuredClone(f.settings); change(draft); f.settings = draft; },
    whoami: async (_pat, budget) => { events.push("whoami-update"); assert.ok(budget.deadlineAt > budget.now()); return { login: "fixtureowner" }; },
    encrypt: () => { events.push("encrypt"); return "encrypted:new"; }, isEncrypted: (value) => value.startsWith("encrypted:"),
    ping: async () => { events.push("ping"); return { ok: true }; }, invalidate: () => {},
  };
  (f.deps as GithubStationFormDependencies & { deletePrimary: (slug: string, expectedGroup: string) => Promise<ActionResult> }).deletePrimary = async (slug, expectedGroup) => {
    events.push(`delete-primary:${slug}:${expectedGroup}`);
    return { ok: true, message: "Đã xoá nhóm repo chính.", deletedPrimaries: 2, retainedCompanions: 5 };
  };
  (globalThis as typeof globalThis & { __stationFixture?: typeof f }).__stationFixture = f;
  return f;
}

for (const name of ["provisionGithubStationAction", "updateGithubStationAction", "saveGithubStationAction"] as const) {
  const f = fixture(); f.allowed = false;
  assert.equal((await actions[name](null, form({ pat, slug: "FixtureOwner/existing-repo" }))).ok, false);
  assert.deepEqual(f.events, ["auth", "permission"], `${name} must authorize before any external call`);
}
{
  const f = fixture(); f.allowed = false;
  await assert.rejects(() => actions.deleteGithubStationAction(null, form({ slug: "FixtureOwner/existing-repo" })));
  assert.deepEqual(f.events, ["auth", "permission"], "delete must authorize before calling the account deletion service");
}
{
  const f = fixture();
  const result = await actions.deleteGithubStationAction(null, form({ slug: "FixtureOwner/existing-repo", expectedGroup: "fixtureowner/existing-repo#42" }));
  assert.deepEqual(result, { ok: true, message: "Đã xoá nhóm repo chính.", deletedPrimaries: 2, retainedCompanions: 5 });
  assert.deepEqual(f.events, [
    "auth", "permission", "delete-primary:FixtureOwner/existing-repo:fixtureowner/existing-repo#42",
    "invalidate:/admin", "invalidate:/admin/github/[owner]/[repo]",
  ]);
}
{
  const f = fixture();
  const result = await actions.provisionGithubStationAction(null, form({ pat, repo: "", workflowFile: "", dailyPushes: "", owner: "forged-owner", workerId: "forged-worker", companionRepos: "forged-companion" }));
  assert.equal(result.ok, true);
  assert.equal(result.slug, "FixtureOwner/random-project");
  assert.deepEqual(f.submitted, { pat, repo: "", workflowFile: "", dailyPushes: "" });
  assert.equal(f.normalized?.dailyPushes, 5); assert.equal(f.normalized?.workflowFile, "linh-su.yml"); assert.equal(f.normalized?.workerId, "worker-identity");
  assert.equal(f.events.filter(event => event === "llm-name").length, 1);
  assert.deepEqual(f.events.slice(0, 7), ["auth", "permission", "provision", "whoami-create", "khoiloi-names", "llm-name", "worker-id"]);
}
{
  const f = fixture(); f.probeStatus = 200;
  const result = await actions.provisionGithubStationAction(null, form({ pat, repo: "already-exists", workflowFile: "custom.yaml", dailyPushes: "0" }));
  assert.equal(result.ok, false); assert.match(result.message, /đã tồn tại/); assert.equal(result.slug, "FixtureOwner/already-exists");
  assert.ok(!f.events.includes("create") && !f.events.includes("register"));
}
{
  const f = fixture(); f.warning = true;
  const result = await actions.provisionGithubStationAction(null, form({ pat, repo: "new-project" }));
  assert.equal(result.ok, true); assert.ok(result.warnings?.length); assert.equal(result.slug, "FixtureOwner/new-project");
  assert.ok(!f.events.includes("llm-name"), "explicit form name bypasses Ollama");
  assert.ok(!JSON.stringify(result).includes(pat) && !JSON.stringify(result).includes("child stderr"));
}
{
  const f = fixture();
  const result = await actions.provisionGithubStationAction(null, form({ pat, repo: "sect-worker" }));
  assert.equal(result.ok, false);
  assert.match(result.message, /trùng tên khôi lỗi/);
  assert.ok(!f.events.includes("create") && !f.events.includes("local-preflight"));
}
{
  const f = fixture(); f.deps.provision = async () => { throw Error(pat + " raw child stderr"); };
  const result = await actions.provisionGithubStationAction(null, form({ pat }));
  assert.equal(result.ok, false); assert.equal(result.stage, "attention"); assert.ok(!JSON.stringify(result).includes(pat)); assert.ok(!JSON.stringify(result).includes("stderr"));
}
for (const values of [{ pat: "" }, { pat: "has whitespace" }, { pat, dailyPushes: "25" }, { pat, workflowFile: "../bad.yml" }]) {
  const f = fixture();
  assert.equal((await actions.provisionGithubStationAction(null, form(values))).ok, false);
  assert.ok(!f.events.includes("whoami-create") && !f.events.includes("create"));
}
{
  const f = fixture("jarvis");
  f.beforeMutation = () => {
    const row = f.settings.githubStations[0]; row.lastPingNote = "fresh runtime"; row.companionRepos[0].pushesToday = 4;
    row.dailyPushes = 9; row.enabled = false; row.nurtureLastNote = "fresh nurture";
  };
  const result = await actions.updateGithubStationAction(null, form({ slug: "FixtureOwner/existing-repo", owner: "forged", repo: "forged", companionRepos: "forged", pat }));
  assert.equal(result.ok, true);
  const row = f.settings.githubStations[0];
  assert.equal(row.owner, "FixtureOwner"); assert.equal(row.repo, "existing-repo"); assert.equal(row.pat, "encrypted:new");
  assert.equal(row.dailyPushes, 9); assert.equal(row.enabled, false); assert.equal(row.lastPingNote, "fresh runtime"); assert.equal(row.companionRepos[0].pushesToday, 4);
  assert.equal(row.companionRepos[0].repo, "software-one"); assert.equal(row.provisionedBy, "jarvis"); assert.equal(row.githubId, 42); assert.equal(row.initialCommitSha, "initial-sha"); assert.equal(row.nurtureLastNote, "fresh nurture");
  assert.ok(f.events.indexOf("whoami-update") < f.events.indexOf("encrypt")); assert.ok(!f.events.includes("provision"));
}
for (const change of [{ workerId: "forged-worker" }, { workflowFile: "different.yaml" }]) {
  const f = fixture("jarvis");
  assert.equal((await actions.updateGithubStationAction(null, form({ slug: "FixtureOwner/existing-repo", ...change }))).ok, false);
  assert.ok(!f.events.includes("mutate") && !f.events.includes("provision"));
}
{
  const f = fixture(); f.deps.whoami = async () => ({ login: "DifferentOwner" });
  const result = await actions.updateGithubStationAction(null, form({ slug: "FixtureOwner/existing-repo", pat }));
  assert.equal(result.ok, false); assert.match(result.message, /không thuộc/); assert.ok(!f.events.includes("encrypt") && !f.events.includes("mutate"));
}
{
  const f = fixture(); f.deps.whoami = async () => { throw Error(pat + " raw HTTP output"); };
  const result = await actions.updateGithubStationAction(null, form({ slug: "FixtureOwner/existing-repo", pat }));
  assert.equal(result.ok, false); assert.ok(!JSON.stringify(result).includes(pat)); assert.ok(!f.events.includes("mutate"));
}
{
  const f = fixture();
  const result = await actions.updateGithubStationAction(null, form({ slug: "FixtureOwner/existing-repo", workflowFile: "corrected.yaml", workerId: "correct-worker", dailyPushes: "0", enabledPresent: "1" }));
  assert.equal(result.ok, true); assert.equal(f.settings.githubStations[0].workflowFile, "corrected.yaml"); assert.equal(f.settings.githubStations[0].workerId, "correct-worker");
  assert.equal(f.settings.githubStations[0].dailyPushes, 0); assert.equal(f.settings.githubStations[0].enabled, false); assert.equal(f.settings.githubStations[0].pat, "encrypted:old");
  assert.ok(!f.events.includes("whoami-update") && !f.events.includes("provision"));
}
{
  const f = fixture(); f.beforeMutation = () => { f.settings.githubStations = []; };
  assert.equal((await actions.updateGithubStationAction(null, form({ slug: "FixtureOwner/existing-repo" }))).ok, false);
  assert.equal(f.settings.githubStations.length, 0); assert.ok(!f.events.includes("ping"));
}
{
  const f = fixture();
  assert.equal((await actions.saveGithubStationAction(null, form({ owner: "FixtureOwner", repo: "existing-repo", dailyPushes: "12" }))).ok, true);
  assert.equal(f.settings.githubStations[0].dailyPushes, 12);
  assert.equal((await actions.saveGithubStationAction(null, form({ owner: "FixtureOwner", repo: "not-registered", pat }))).ok, false);
  assert.equal(f.settings.githubStations.length, 1); assert.ok(!f.events.includes("provision"));
}
delete (globalThis as typeof globalThis & { __stationFixture?: unknown }).__stationFixture;
console.log("PASS: real guarded actions, account-wide primary deletion passthrough, four-field provisioning/defaults, owner inference, existing refusal, safe errors/warnings, immutable managed edits, legacy updates, fresh metadata and PAT owner validation (offline).");
