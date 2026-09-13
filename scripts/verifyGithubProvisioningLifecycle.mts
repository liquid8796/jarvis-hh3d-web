import assert from "node:assert/strict";
import { classifyGithubActionsCheckStatus, provisionGithubStation, productionGithubProvisionDependencies, shouldRetryGithubActionsCheck, GithubProvisionCollisionError, type GithubActionsCheckFailure, type GithubProvisioningDependencies } from "../src/lib/services/githubProvisioning";
import { parseGithubSettingsForMutation } from "../src/lib/services/settings";

assert.throws(() => parseGithubSettingsForMutation({ githubStations: [{ owner: "Owner", repo: "existing", pat: "encrypted", companionRepos: [{ repo: "owned-repo" }, null] }] }));
assert.throws(() => parseGithubSettingsForMutation({ githubStations: [{ owner: "Owner", repo: "existing", pat: "encrypted", workerId: 123 }] }));
assert.equal(parseGithubSettingsForMutation({}).githubStations.length, 0);

const input = { pat: "test-pat-never-echo", repo: "small-project", workflowFile: "custom.yaml", dailyPushes: 4 };
function fixture(failure = "") {
  const events: string[] = [];
  let registered = false, created = false, deleted = false, leased = false, probes = 0;
  const fail = (stage: string) => { if (failure === stage) throw new Error(`${input.pat} raw worker-secret stderr`); };
  const deps: GithubProvisioningDependencies = {
    generateRepoName: async () => { events.push("llm-name"); fail("llm-name"); return "generated-project"; },
    generateWorkerId: async () => { events.push("worker-id"); fail("worker-id"); return "worker-identity"; },
    listKhoiloiNames: async () => { events.push("khoiloi-names"); fail("khoiloi-names"); return ["sect-worker"]; },
    whoami: async () => { events.push("whoami"); fail("whoami"); return { login: "Owner", scopes: "repo, workflow, delete_repo" }; },
    checkScopes: async () => { events.push("scope"); fail("scope"); },
    localPreflight: async () => { events.push("local-preflight"); fail("local-preflight"); return { directory: "fake", encryptedPat: "encrypted", workerToken: "worker-secret" }; },
    checkSettings: async (_ctx, locked) => { if (!locked) events.push("settings-check"); fail(locked ? "locked-settings" : "settings-check"); if (registered) throw Error("collision"); },
    checkWorker: async (_ctx, locked) => { if (!locked) events.push("worker-check"); fail(locked ? "locked-worker" : "worker-check"); },
    probe: async () => { probes++; const status = failure === "existing" ? 200 : failure === "unknown" ? 403 : failure === "locked-existing" && probes > 1 ? 200 : 404; events.push(`repo-${status}`); return { status }; },
    acquireLease: async () => { events.push("lease"); if (leased) return null; leased = true; return { assertHeld: async () => { fail("lost-lease"); }, release: async () => { leased = false; } }; },
    stage: async () => { events.push("stage"); fail("stage"); return { initialCommitSha: "first-sha" }; },
    create: async () => { events.push("create"); if (failure === "ambiguous-create") throw Error("network secret"); if (failure === "create-422") return { status: 422 }; if (failure === "create-500") return { status: 500 }; if (failure === "create-no-id") return { status: 201 }; created = true; return { status: 201, githubId: 123 }; },
    push: async () => { events.push("push"); fail("push"); },
    checkActions: async () => { events.push("actions-check"); fail("actions"); return { ok: true }; },
    setSecret: async () => { events.push("secret"); fail("secret"); },
    register: async () => { events.push("register"); fail("register"); registered = true; if (failure === "ambiguous-register") throw Error("commit acknowledgement lost"); },
    cleanupSnapshot: async () => ({ referenced: registered || failure === "cleanup-reference", githubId: failure === "cleanup-id" ? 456 : 123, head: failure === "cleanup-head" ? "foreign-sha" : "first-sha" }),
    deleteRepo: async () => { events.push("delete"); fail("delete"); deleted = true; created = false; },
    dispatch: async () => { events.push("dispatch"); fail("dispatch"); },
    ping: async () => { events.push("ping"); fail("ping"); },
    nurture: async () => { events.push("nurture"); fail("nurture"); },
    dispose: async () => { fail("dispose"); },
  };
  return { deps, events, state: () => ({ registered, created, deleted, leased }) };
}

const happy = fixture();
for (const kind of ["station", "worker"] as const) {
  const conflict = fixture();
  conflict.deps.checkSettings = async () => { throw new GithubProvisionCollisionError(kind); };
  const result = await provisionGithubStation(input, conflict.deps);
  assert.equal(result.ok, false);
  assert.match(result.message, kind === "station" ? /đã có trong sổ/ : /đang được một khôi lỗi sử dụng/);
  assert.equal(conflict.events.includes("create"), false);
  assert.equal(result.slug, "Owner/small-project");
}
assert.deepEqual(await provisionGithubStation(input, happy.deps), {
  ok: true, stage: "complete", slug: "Owner/small-project", message: "Đã tạo và đăng ký kho GitHub.", warnings: [],
});
assert.deepEqual(happy.events, ["whoami", "scope", "khoiloi-names", "worker-id", "local-preflight", "settings-check", "worker-check", "repo-404", "lease", "repo-404", "stage", "create", "push", "actions-check", "secret", "register", "dispatch", "ping", "nurture"]);
assert.deepEqual(happy.state(), { registered: true, created: true, deleted: false, leased: false });
assert.ok(!happy.events.includes("llm-name"), "explicit repo never calls the model");
for (const chosen of ["Prism", "notes_engine", "garden.v2"]) {
  const f = fixture(); let received: Parameters<GithubProvisioningDependencies["create"]>[0] | undefined;
  f.deps.generateRepoName = async (owner, budget) => {
    f.events.push("llm-name");
    assert.equal(owner, "Owner");
    assert.ok(budget.deadlineAt > budget.now() && budget.deadlineAt - budget.now() <= 45_000);
    return chosen;
  };
  const originalCreate = f.deps.create;
  f.deps.create = async ctx => { received = ctx; return originalCreate(ctx); };
  const result = await provisionGithubStation({ ...input, repo: "  " }, f.deps);
  assert.equal(result.ok, true);
  assert.equal(result.slug, `Owner/${chosen}`);
  assert.equal(received?.repo, chosen);
  assert.equal(received?.workerId, "worker-identity");
  assert.equal(received?.generatedRepo, true);
  assert.deepEqual(f.events.slice(0, 6), ["whoami", "scope", "khoiloi-names", "llm-name", "worker-id", "local-preflight"]);
  assert.equal(f.events.filter(e => e === "llm-name").length, 1);
}
{
  const f = fixture();
  f.deps.listKhoiloiNames = async () => { f.events.push("khoiloi-names"); return ["small-project"]; };
  const result = await provisionGithubStation(input, f.deps);
  assert.equal(result.ok, false);
  assert.match(result.message, /trùng tên khôi lỗi/);
  assert.deepEqual(f.events, ["whoami", "scope", "khoiloi-names"]);
}
{
  const f = fixture();
  f.deps.listKhoiloiNames = async () => { f.events.push("khoiloi-names"); return ["generated-project"]; };
  const result = await provisionGithubStation({ ...input, repo: "" }, f.deps);
  assert.equal(result.ok, false);
  assert.match(result.message, /Ollama.*chưa tạo repo/);
  assert.ok(!f.events.includes("worker-id") && !f.events.includes("local-preflight"));
}
{
  const f = fixture();
  f.deps.generateWorkerId = async () => { f.events.push("worker-id"); return "small-project"; };
  const result = await provisionGithubStation(input, f.deps);
  assert.equal(result.ok, false);
  assert.ok(!f.events.includes("local-preflight"));
}
for (const failure of ["whoami", "scope", "llm-name"]) {
  const f = fixture(failure);
  const result = await provisionGithubStation({ ...input, repo: "" }, f.deps);
  assert.equal(result.ok, false);
  assert.ok(!f.events.includes("create") && !f.events.includes("delete") && !f.events.includes("local-preflight"));
  if (failure !== "llm-name") assert.ok(!f.events.includes("llm-name"));
  else assert.match(result.message, /Ollama.*chưa tạo repo/);
  assert.ok(!JSON.stringify(result).includes(input.pat));
}
for (const invalid of ["", ".", "..", "bad/name", "bad name", "a".repeat(101)]) {
  const f = fixture(); f.deps.generateRepoName = async () => invalid;
  const result = await provisionGithubStation({ ...input, repo: "" }, f.deps);
  assert.equal(result.ok, false);
  assert.match(result.message, /Ollama/);
  assert.ok(!f.events.includes("create") && !f.events.includes("local-preflight"));
}
{
  const f = fixture("existing");
  const result = await provisionGithubStation({ ...input, repo: "" }, f.deps);
  assert.equal(result.ok, false);
  assert.match(result.message, /đã tồn tại/);
  assert.equal(f.events.filter(e => e === "llm-name").length, 1, "collision stops instead of adding a generated suffix");
  assert.ok(!f.events.includes("create"));
}
for (const failure of ["whoami", "scope", "khoiloi-names", "worker-id", "local-preflight", "settings-check", "worker-check", "existing", "unknown", "locked-existing", "locked-settings", "locked-worker", "lost-lease", "stage", "create-422", "create-500", "create-no-id", "ambiguous-create"]) {
  const f = fixture(failure), result = await provisionGithubStation(input, f.deps);
  assert.equal(result.ok, false, failure);
  assert.equal(f.state().registered, false, failure);
  assert.equal(f.state().deleted, false, failure);
  assert.equal(f.state().leased, false, failure);
  assert.ok(f.events.filter(e => e === "create").length <= 1);
  if (!["create-422", "create-500", "create-no-id", "ambiguous-create"].includes(failure)) assert.ok(!f.events.includes("create"), failure);
  if (failure === "ambiguous-create") assert.equal(result.stage, "attention");
  assert.ok(!JSON.stringify(result).includes(input.pat));
}
for (const failure of ["push", "actions", "secret", "register"]) {
  const f = fixture(failure), result = await provisionGithubStation(input, f.deps);
  assert.equal(result.ok, false, failure);
  assert.equal(f.state().deleted, true, failure);
  assert.equal(f.state().registered, false, failure);
  assert.equal(f.state().leased, false, failure);
  if (failure === "actions") assert.ok(!f.events.includes("secret") && !f.events.includes("register"));
  assert.ok(!JSON.stringify(result).includes("worker-secret"));
  assert.ok(!JSON.stringify(result).includes(input.pat));
}
for (const [reason, message] of [
  ["account-disabled", /đã tắt Actions.*tài khoản/],
  ["permission", /quyền chạy Actions/],
  ["workflow", /chưa tìm thấy workflow/],
  ["validation", /nhánh main hoặc input/],
  ["unavailable", /tạm thời không khả dụng/],
  ["rejected", /từ chối lượt kiểm tra/],
] as const satisfies readonly (readonly [GithubActionsCheckFailure, RegExp])[]) {
  const f = fixture();
  f.deps.checkActions = async () => { f.events.push("actions-check"); return { ok: false, reason }; };
  const result = await provisionGithubStation(input, f.deps);
  assert.equal(result.ok, false, reason);
  assert.equal(result.stage, "actions", reason);
  assert.match(result.message, message, reason);
  assert.equal(f.state().deleted, true, reason);
  assert.ok(!f.events.includes("secret") && !f.events.includes("register"), reason);
}
for (const [status, providerMessage, expected] of [
  [204, null, "ok"],
  [401, null, "permission"],
  [403, null, "permission"],
  [404, null, "workflow"],
  [422, null, "validation"],
  [422, "Actions has been disabled for this user.", "account-disabled"],
  [422, "actions HAS been disabled for THIS user", "account-disabled"],
  [422, "Actions has been disabled for this user today", "validation"],
  [429, null, "unavailable"],
  [503, null, "unavailable"],
  [409, null, "rejected"],
] as const) {
  const classified = classifyGithubActionsCheckStatus(status, providerMessage);
  assert.equal(classified.ok ? "ok" : classified.reason, expected, String(status));
  assert.equal(shouldRetryGithubActionsCheck(classified), expected === "workflow" || expected === "unavailable", `retry ${status}/${expected}`);
}
{
  const savedFetch = globalThis.fetch;
  const pat = "github-actions-check-pat-never-echo";
  let calls = 0;
  try {
    globalThis.fetch = (async (url, init) => {
      calls += 1;
      assert.ok(!String(url).includes(pat));
      assert.equal(new Headers(init?.headers).get("authorization"), `Bearer ${pat}`);
      assert.deepEqual(JSON.parse(String(init?.body)), { ref: "main", inputs: { provision_check: "true" } });
      return new Response(JSON.stringify({ message: "Actions has been disabled for this user." }), { status: 422, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    const result = await productionGithubProvisionDependencies.checkActions({
      ...input, pat, owner: "Owner", workerId: "worker-identity", generatedRepo: false,
      slug: "Owner/small-project", now: Date.now, deadlineAt: Date.now() + 10_000,
    });
    assert.deepEqual(result, { ok: false, reason: "account-disabled" });
    assert.equal(calls, 1, "account-disabled is permanent and must not be retried");
    assert.ok(!JSON.stringify(result).includes(pat));
  } finally {
    globalThis.fetch = savedFetch;
  }
}
for (const failure of ["cleanup-id", "cleanup-head", "cleanup-reference", "delete"]) {
  const f = fixture(failure);
  f.deps.setSecret = async () => { throw Error("secret failure"); };
  const result = await provisionGithubStation(input, f.deps);
  assert.equal(result.stage, "attention", failure);
  assert.equal(f.state().deleted, false, failure);
  assert.equal(f.state().created, true, failure);
}
const ambiguousRegister = fixture("ambiguous-register");
assert.equal((await provisionGithubStation(input, ambiguousRegister.deps)).stage, "attention");
assert.equal(ambiguousRegister.state().deleted, false);
for (const failure of ["dispatch", "ping", "nurture", "dispose"]) {
  const f = fixture(failure), result = await provisionGithubStation(input, f.deps);
  assert.equal(result.ok, true, failure);
  assert.equal(result.stage, "complete", failure);
  assert.equal(result.warnings.length, 1, failure);
  assert.equal(f.state().deleted, false, failure);
  assert.ok(f.events.includes("nurture"), failure);
}
const twice = fixture();
const results = await Promise.all([provisionGithubStation(input, twice.deps), provisionGithubStation(input, twice.deps)]);
assert.equal(results.filter(r => r.ok).length, 1);
assert.equal(twice.events.filter(e => e === "create").length, 1);
assert.equal(twice.state().leased, false);
for (const scope of [null, "", "repo, workflow", "public_repo, workflow, delete_repo"]) {
  await assert.rejects(productionGithubProvisionDependencies.checkScopes(scope));
}
await productionGithubProvisionDependencies.checkScopes("repo, workflow, delete_repo");
const owner = fixture();
let receivedOwner = "";
owner.deps.create = async ctx => { receivedOwner = ctx.owner; return { status: 201, githubId: 123 }; };
await provisionGithubStation({ ...input, ownerForDryRun: "SomeoneElse" }, owner.deps);
assert.equal(receivedOwner, "Owner");
const offline = fixture();
assert.equal((await provisionGithubStation({ ...input, dryRun: true }, offline.deps)).ok, false);
assert.deepEqual(offline.events, []);
// Review regression: one shared budget reserves the final 30 seconds for cleanup.
for (const expiresAt of ["stage", "push", "actions", "register", "dispatch"]) {
  const f = fixture(); let now = 1_000;
  f.deps.now = () => now;
  const key = expiresAt === "actions" ? "checkActions" : expiresAt;
  const mutable = f.deps as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;
  const original = mutable[key];
  mutable[key] = async (...args: unknown[]) => { const result = await original(...args); now = 211_001; return result; };
  const result = await provisionGithubStation(input, f.deps);
  if (expiresAt === "stage") { assert.equal(result.ok, false); assert.ok(!f.events.includes("create")); }
  if (expiresAt === "push") { assert.equal(result.ok, false); assert.ok(!f.events.includes("secret")); assert.equal(f.state().deleted, true); }
  if (expiresAt === "actions") { assert.equal(result.ok, false); assert.ok(!f.events.includes("secret")); assert.equal(f.state().deleted, true); }
  if (expiresAt === "register" || expiresAt === "dispatch") { assert.equal(result.ok, true); assert.ok(!f.events.includes("nurture")); }
}
const forwarded = fixture(); let clock = 1_000; let nurtureDeadline = 0;
forwarded.deps.now = () => clock;
forwarded.deps.whoami = async (_pat, budget) => { assert.equal(budget.deadlineAt, 211_000); return { login: "Owner", scopes: "repo, workflow, delete_repo" }; };
forwarded.deps.nurture = async ctx => { nurtureDeadline = ctx.deadlineAt; assert.equal(ctx.deadlineAt - ctx.now(), 111_000); };
const dispatch = forwarded.deps.dispatch;
forwarded.deps.dispatch = async ctx => { await dispatch(ctx); clock = 100_000; };
assert.equal((await provisionGithubStation(input, forwarded.deps)).ok, true);
assert.equal(nurtureDeadline, 211_000);
const exhausted = fixture(); exhausted.deps.now = () => 1_000; exhausted.deps.deadlineAt = 30_999;
assert.equal((await provisionGithubStation(input, exhausted.deps)).ok, false);
assert.deepEqual(exhausted.events, []);
const hung = fixture(); hung.deps.deadlineAt = Date.now() + 30_020;
hung.deps.whoami = () => new Promise(() => {});
const beforeHung = Date.now();
assert.equal((await provisionGithubStation(input, hung.deps)).ok, false);
assert.ok(Date.now() - beforeHung < 1_000, "hung adapter must obey the shared timeout");
const hungName = fixture(); hungName.deps.deadlineAt = Date.now() + 30_020;
hungName.deps.generateRepoName = () => new Promise(() => {});
const beforeHungName = Date.now();
const timedOutName = await provisionGithubStation({ ...input, repo: "" }, hungName.deps);
assert.equal(timedOutName.ok, false);
assert.match(timedOutName.message, /Ollama/);
assert.ok(Date.now() - beforeHungName < 1_000);
assert.ok(!hungName.events.includes("create") && !hungName.events.includes("local-preflight"));
for (const finalStatus of [404, 200, "error"] as const) {
  const f = fixture("secret"); const probe = f.deps.probe;
  f.deps.probe = async ctx => {
    if (f.state().deleted) { if (finalStatus === "error") throw Error("raw token error"); return { status: finalStatus }; }
    return probe(ctx);
  };
  const result = await provisionGithubStation(input, f.deps);
  assert.equal(result.stage, finalStatus === 404 ? "secret" : "attention");
  assert.equal(f.events.filter(event => event === "delete").length, 1);
}
for (const locked of [false, true]) {
  for (const status of [200, 403, "error"] as const) {
    const f = fixture(); let probes = 0;
    f.deps.probe = async () => { if (locked && probes++ === 0) return { status: 404 }; if (status === "error") throw Error("raw secret"); return { status }; };
    const result = await provisionGithubStation(input, f.deps);
    assert.equal(result.message, status === 200 ? "Kho GitHub đã tồn tại. Không có thay đổi nào được thực hiện." : "Không xác định được kho GitHub có tồn tại hay không. Không có thay đổi nào được thực hiện.");
    assert.ok(!f.events.includes("create"));
  }
}
console.log("PASS: GitHub provisioning lifecycle, shared deadline/reserved cleanup, verified rollback, distinct repo states, warnings and double submission (no external calls).");
