#!/usr/bin/env node
/** Isolated real action/route/render tests. Infrastructure fixtures never touch live users or jobs. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";
import * as configs from "../src/lib/services/configs";
import * as permissions from "../src/lib/auth/permissions";
import * as fishingAccess from "../src/lib/quest-engine/fishingAccess.mjs";
import * as cookies from "../src/lib/quest-engine/cookies.mjs";
import * as pillBagCaps from "../src/lib/validation/pillBagCaps";
import * as workerAutoscale from "../src/lib/validation/workerAutoscale";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
const read = (path: string) => readFileSync(new URL("../" + path, import.meta.url), "utf8");
const require = createRequire(import.meta.url);
type User = { id: string; roles: string[]; tags: string[]; tagExpirations?: Record<string, string | null>; status: string };
const makeUser = (roles: string[], tags: string[]): User => ({ id: "fixture-owner", roles, tags, status: "active" });
let currentUser: User | null = makeUser([], []);
let scope: { kind: "user"; userId: string } | { kind: "operator" } | null = { kind: "user", userId: "fixture-owner" };
let saved: configs.UserConfig | null = null;
const enabled = configs.configSchema.parse({ quests: { cauCa: { enabled: true, sellBelow: 8 } } });
let snapshot: unknown = enabled;
const dependencies: Record<string, unknown> = {
  "next/cache": { revalidatePath() {} },
  "next/server": { NextResponse: { json: (data: unknown, init?: ResponseInit) => Response.json(data, init) }, after() {} },
  "@/lib/auth/permissions": permissions,
  "@/lib/quest-engine/fishingAccess.mjs": fishingAccess,
  "@/lib/quest-engine/cookies.mjs": cookies,
  "@/lib/auth/guards": { requireActiveUser: async () => {
    assert.ok(currentUser && currentUser.status === "active"); return currentUser;
  } },
  "@/lib/auth/worker": { authorizeWorker: async () => scope },
  "@/lib/services/configs": { ...configs,
    getStoredConfigForSnapshot: async () => configs.configSchema.parse({}),
    saveConfig: async (id: string, config: configs.UserConfig) => {
      assert.equal(id, currentUser?.id, "save uses the authenticated identity");
      saved = structuredClone(config);
    },
  },
  "@/lib/services/accounts": {},
  "@/lib/services/jobs": {
    claimNextJob: async (workerId: string, suppliedScope: typeof scope) => {
      assert.equal(workerId, "fixture-worker");
      assert.deepEqual(suppliedScope, scope, "claim preserves the authenticated worker scope");
      if (suppliedScope?.kind === "user") assert.equal(suppliedScope.userId, "fixture-owner");
      return { id: "fixture-job", userId: "fixture-owner", configSnapshot: snapshot, dailyDone: {} };
    },
    dailyQuotaPlan: () => ({}),
    jobBelongsTo: async (_id: string, suppliedScope: typeof scope) => suppliedScope !== null,
    heartbeat: async () => ({ status: "running", workerId: "fixture-worker", userId: "fixture-owner" }),
  },
  "@/lib/services/workers": { recordWorkerSeen: async () => {} },
  "@/lib/services/users": { findById: async (id: string) => {
    assert.equal(id, "fixture-owner", "claim checks the job owner"); return currentUser;
  } },
  "@/lib/services/settings": { getAppSettings: async () => ({
    game: { baseUrl: "https://example.invalid" }, workerAutoscale: { drainingWorkerIds: [] },
  }) },
  "@/lib/validation/pillBagCaps": pillBagCaps,
  "@/lib/validation/workerAutoscale": workerAutoscale,
  "@/lib/validation/accountWorkerPref": {},
  "@/lib/crypto/secretBox": { isEncrypted: () => false },
  "../../../../package.json": { version: "test" },
};
function load<T>(path: string, overrides: Record<string, unknown> = {}): T {
  const output = ts.transpileModule(read(path), { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  }, fileName: path }).outputText;
  const module = { exports: {} };
  new Function("require", "module", "exports", output)((id: string) => {
    if (Object.hasOwn(overrides, id)) return overrides[id];
    if (Object.hasOwn(dependencies, id)) return dependencies[id];
    if (["react", "react/jsx-runtime", "zod"].includes(id)) return require(id);
    throw new Error("Unexpected fixture dependency: " + id);
  }, module, module.exports);
  return module.exports as T;
}
const actions = load<{ saveConfigAction(prev: null, data: FormData): Promise<{ ok: boolean; message: string }> }>("src/app/actions/automation.ts");
const route = load<{ POST(request: Request): Promise<Response> }>("src/app/api/worker/route.ts");
function forgedForm() {
  const data = new FormData();
  for (const [key, value] of Object.entries({
    cauCaEnabled: "on", cauCaSellBelow: "8", meCungCapCheck: "on", q_diemDanh: "on",
    userId: "other-user", isAdmin: "true", canFish: "true", tags: "VIP", accountTier: "vip",
  })) data.set(key, value);
  data.append("cauCaSpot", "sen");
  data.append("cauCaSpot", "cau");
  return data;
}
async function saveAs(user: User, expected: boolean) {
  currentUser = user; saved = null;
  const result = await actions.saveConfigAction(null, forgedForm());
  assert.equal(result.ok, true, result.message);
  assert.ok(saved, "valid form is saved");
  const config = saved as configs.UserConfig;
  assert.equal(config.quests.cauCa.enabled, expected, "save access for " + JSON.stringify(user));
  assert.equal(config.quests.cauCa.sellBelow, 8, "other fishing settings survive");
  assert.deepEqual(config.quests.cauCa.spot, ["sen", "cau"], "real server action persists every selected spot");
  assert.equal(config.quests.diemDanh.enabled, true, "other quests survive");
  return result;
}
for (const role of permissions.ADMIN_ROLE_CODES) await saveAs(makeUser([role], []), true);
await saveAs(makeUser([], ["VIP"]), true);
await saveAs(makeUser(["de-tu"], [" vip "]), true);
await saveAs(makeUser([], ["Thánh nữ", "Vip"]), true);
for (const tags of [[], ["VIPER"], ["SVIP"], ["VIP 2"]]) {
  const result = await saveAs(makeUser(["de-tu"], tags), false);
  assert.match(result.message, /Câu Cá/, "denied fishing explains the actual restriction");
  assert.doesNotMatch(result.message, /Mê Cung/, "unchanged Maze settings are not blamed");
}
const mutable = makeUser(["de-tu"], []);
await saveAs(mutable, false);
mutable.tags = ["VIP"]; await saveAs(mutable, true);
mutable.tags = []; await saveAs(mutable, false);
await saveAs({ ...makeUser([], ["VIP"]), tagExpirations: { vip: "2000-01-01T00:00:00.000Z" } }, false);
await saveAs({ ...makeUser([], ["VIP"]), tagExpirations: { vip: "2099-01-01T00:00:00.000Z" } }, true);
console.log("PASS server action: admins, VIP tags, expiry, tag changes and forged form fields");
async function claimAs(user: User | null, kind: "user" | "operator", expected: boolean) {
  currentUser = user; scope = kind === "operator" ? { kind } : { kind, userId: "fixture-owner" };
  snapshot = { ...enabled, accountTier: "vip", isAdmin: true, tags: ["VIP"], canFish: true };
  const response = await route.POST(new Request("http://localhost/api/worker", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ op: "claim", workerId: "fixture-worker", userId: "admin", isAdmin: true, tags: ["VIP"], canFish: true }),
  }));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.job.config.quests.cauCa.enabled, expected, kind + " access for " + JSON.stringify(user));
  assert.equal(body.job.config.quests.cauCa.sellBelow, 8);
  assert.equal(body.job.fishingAccess.allowed, expected, "claim supplies authoritative live capability");
  assert.equal(enabled.quests.cauCa.enabled, true, "source snapshots stay unchanged");
}
for (const kind of ["user", "operator"] as const) {
  for (const role of permissions.ADMIN_ROLE_CODES) await claimAs(makeUser([role], []), kind, true);
  const owner = makeUser(["de-tu"], ["VIP"]);
  await claimAs(owner, kind, true);
  owner.tags = []; await claimAs(owner, kind, false);
  owner.tags = ["vip"]; await claimAs(owner, kind, true);
  await claimAs(makeUser(["de-tu"], ["VIPER"]), kind, false);
  await claimAs(null, kind, false);
  await claimAs({ ...makeUser([], ["VIP"]), tagExpirations: { vip: "2000-01-01T00:00:00.000Z" } }, kind, false);
  await claimAs({ ...makeUser([], ["VIP"]), tagExpirations: { vip: "2099-01-01T00:00:00.000Z" } }, kind, true);
}
scope = null;
assert.equal((await route.POST(new Request("http://localhost/api/worker", { method: "POST" }))).status, 401);
console.log("PASS worker POST: both scopes, current tags, stale/forged snapshots, missing owner and unauthenticated request");
for (const kind of ["user", "operator"] as const) {
  scope = kind === "operator" ? { kind } : { kind, userId: "fixture-owner" };
  for (const [expiry, expected] of [["2000-01-01T00:00:00.000Z", false], ["2099-01-01T00:00:00.000Z", true]] as const) {
    currentUser = { ...makeUser([], ["VIP"]), tagExpirations: { vip: expiry } };
    const response = await route.POST(new Request("http://localhost/api/worker", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ op: "heartbeat", jobId: "00000000-0000-4000-8000-000000000001" }),
    }));
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.status, "running", "expiry does not stop unrelated automation");
    assert.deepEqual(body.fishingAccess, { allowed: expected, expiresAt: expected ? expiry : null });
  }
}
console.log("PASS worker heartbeat: both scopes refresh current owner expiry during active jobs");
const { ConfigForm } = load<{ ConfigForm: (props: { config: configs.UserConfig; isAdmin: boolean; canFish: boolean }) => ReturnType<typeof createElement> }>(
  "src/app/dashboard/ConfigForm.tsx", {
    "@/app/actions/automation": { saveConfigAction: async () => ({ ok: true, message: "" }) },
    "./AccountManager": { AccountManager: () => null },
    "./PillBagCapacitySummary": { PillBagCapacitySummary: () => null },
    "./FishingSpotOptions": load("src/app/dashboard/FishingSpotOptions.tsx"),
    "./DashboardLiveProvider": {
      useDashboardAccountLive: () => ({ accounts: [] }), useDashboardWorkerPref: () => ({ workerPref: "any" }),
    },
  });
for (const access of [{ isAdmin: true, canFish: true }, { isAdmin: false, canFish: true }, { isAdmin: false, canFish: false }]) {
  const html = renderToStaticMarkup(createElement(ConfigForm, { config: enabled, ...access }));
  const checkbox = html.match(/<input[^>]*name="cauCaEnabled"[^>]*>/)?.[0];
  assert.ok(checkbox);
  assert.equal(/disabled=""/.test(checkbox), !access.canFish);
  assert.equal(/checked=""/.test(checkbox), access.canFish);
  const fields = [...html.matchAll(/<(?:input|select)[^>]*name="cauCa[^"]*"[^>]*>/g)];
  assert.equal(fields.length, 10, "four spot checkboxes replace one select");
  for (const [field] of fields) assert.equal(/disabled=""/.test(field), !access.canFish, field);
  assert.ok(html.includes("Chỉ dành cho các user VIP"));
  assert.ok(!html.includes("VIP + thường"));
}
const pageDependencies = {
  "@/components/SiteHeader": { SiteHeader: () => null, SHELL_WIDTH: "" },
  "@/lib/services/accounts": { listAccounts: async () => [] },
  "@/lib/services/configs": { getEditableConfig: async () => enabled },
  "@/lib/services/jobs": { getActiveJobs: async () => [] },
  "@/lib/services/workers": { hasWorkerToken: async () => false },
  "@/lib/questTimers": { QUEST_TIMER_KEYS: [], isTimerQuestEnabled: () => false },
  "./ConfigForm": { ConfigForm },
  "./ControlPanel": { ControlPanel: () => null },
  "./DashboardLiveProvider": { DashboardLiveProvider: ({ children }: { children: ReturnType<typeof createElement> }) => children },
  "./LinhSuPanel": { LinhSuPanel: () => null },
  "./QuestTimerPanel": { QuestTimerPanel: () => null },
};
const { default: DashboardPage } = load<{ default: () => Promise<ReturnType<typeof createElement>> }>("src/app/dashboard/page.tsx", pageDependencies);
for (const [user, allowed] of [
  [makeUser(["gia-chu"], []), true], [makeUser([], ["VIP"]), true], [makeUser([], []), false],
] as const) {
  currentUser = user;
  const html = renderToStaticMarkup(await DashboardPage());
  const checkbox = html.match(/<input[^>]*name="cauCaEnabled"[^>]*>/)?.[0];
  assert.ok(checkbox);
  assert.equal(/disabled=""/.test(checkbox), !allowed, "dashboard derives access from authenticated user");
}
console.log("PASS UI: admin/VIP unlocked, ordinary member unchecked/disabled, exact label and authenticated capability");

