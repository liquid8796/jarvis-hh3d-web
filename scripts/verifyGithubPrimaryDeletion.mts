#!/usr/bin/env node
/** Offline state-machine checks for account-wide primary deletion. No real DB, PAT, or network. */
import assert from "node:assert/strict";
import { appSettingsSchema, type AppSettings } from "../src/lib/services/settings";
import {
  deletePrimaryGithubAccountGroup,
  type GithubPrimaryDeletionDependencies,
} from "../src/lib/services/githubPrimaryDeletion";
import { githubPrimaryOwnerGroupFingerprint } from "../src/lib/validation/githubPrimaryDeletion";

type Station = AppSettings["githubStations"][number];
type RouteCall = { method: string; path: string; auth: string };

const station = (owner: string, repo: string, id: number, pat: string, companions: string[] = []): Station =>
  appSettingsSchema.parse({ githubStations: [{
    owner, repo, workerId: repo, githubId: id, provisionedBy: "jarvis", pat,
    companionRepos: companions.map((name) => ({ repo: name, managedBy: "ollama" })),
  }] }).githubStations[0];

function fixture(options: {
  stations?: Station[];
  identity?: Record<string, { status: number; login?: string; message?: string; scopes?: string }>;
  accountStatus?: number;
  accountMessage?: string;
  visibleByPat?: Record<string, string[]>;
  repoStatus?: Record<string, number>;
  deleteStatus?: Record<string, Record<string, number>>;
  keepAfterDelete?: string[];
  busy?: boolean;
  requestError?: (call: RouteCall) => boolean;
  beforeMutate?: (state: AppSettings, mutation: number) => void;
} = {}) {
  let state = appSettingsSchema.parse({ githubStations: options.stations ?? [
    station("Owner", "main-one", 101, "pat-a", ["companion-a", "companion-b"]),
    station("owner", "main-two", 102, "pat-b", ["companion-c"]),
    station("Other", "foreign", 201, "pat-other", ["foreign-companion"]),
  ] });
  const calls: RouteCall[] = [];
  let mutations = 0;
  const deleted = new Set<string>();
  const repos = new Map<string, { id: number; full_name: string; private: boolean }>();
  for (const item of state.githubStations) repos.set(`${item.owner}/${item.repo}`.toLowerCase(), {
    id: item.githubId ?? 1, full_name: `${item.owner}/${item.repo}`, private: false,
  });
  const identity = options.identity ?? {
    "pat-a": { status: 200, login: "Owner", scopes: "repo, workflow, delete_repo" },
    "pat-b": { status: 200, login: "Owner", scopes: "repo, workflow, delete_repo" },
    "pat-other": { status: 200, login: "Other", scopes: "repo, workflow, delete_repo" },
  };
  const visible = (pat: string, slug: string) => options.visibleByPat?.[pat]?.some((entry) => entry.toLowerCase() === slug) ?? true;
  const dependencies: GithubPrimaryDeletionDependencies = {
    deadlineAt: Date.now() + 60_000,
    read: async () => structuredClone(state),
    mutate: async (change) => {
      const next = structuredClone(state);
      options.beforeMutate?.(next, ++mutations);
      change(next);
      state = appSettingsSchema.parse(next);
    },
    acquireLease: async () => options.busy ? null : ({ assertHeld: async () => {}, release: async () => {} }),
    openPat: (value) => value,
    request: async (url, init) => {
      const parsed = new URL(url);
      const auth = new Headers(init.headers).get("authorization")?.replace(/^Bearer /, "") ?? "";
      const call = { method: String(init.method), path: parsed.pathname, auth };
      calls.push(call);
      if (options.requestError?.(call)) throw new Error("secret transport failure");
      if (parsed.pathname === "/user") {
        const reply = identity[auth] ?? { status: 401 };
        return new Response(JSON.stringify({ ...(reply.login ? { login: reply.login } : {}), ...(reply.message ? { message: reply.message } : {}) }), {
          status: reply.status, headers: reply.scopes ? { "x-oauth-scopes": reply.scopes } : undefined,
        });
      }
      if (parsed.pathname.toLowerCase() === "/users/owner") {
        return new Response(JSON.stringify(options.accountMessage ? { message: options.accountMessage } : { login: "Owner" }), { status: options.accountStatus ?? 200 });
      }
      const match = /^\/repos\/([^/]+)\/([^/]+)$/.exec(parsed.pathname);
      assert.ok(match, `unexpected GitHub path ${parsed.pathname}`);
      const slug = `${decodeURIComponent(match[1])}/${decodeURIComponent(match[2])}`.toLowerCase();
      const configured = options.repoStatus?.[slug];
      const existing = repos.get(slug);
      if (call.method === "GET") {
        if (deleted.has(slug) || configured === 451) return new Response("", { status: configured ?? 404 });
        if (!existing || configured === 404 || (auth && !visible(auth, slug))) return new Response("", { status: 404 });
        if (configured && configured !== 200) return new Response(JSON.stringify({ message: "provider detail" }), { status: configured });
        return new Response(JSON.stringify(existing), { status: 200 });
      }
      assert.equal(call.method, "DELETE");
      const status = options.deleteStatus?.[slug]?.[auth] ?? 204;
      if (status === 204 && !options.keepAfterDelete?.includes(slug)) deleted.add(slug);
      return new Response(status === 204 ? null : JSON.stringify({ message: "provider detail" }), { status });
    },
  };
  return { dependencies, calls, deleted, state: () => structuredClone(state), repos };
}

const remove = (f: ReturnType<typeof fixture>, selectedSlug = "Owner/main-one", expectedGroup?: string) => {
  const owner = selectedSlug.split("/")[0] ?? "";
  return deletePrimaryGithubAccountGroup(
    selectedSlug,
    expectedGroup ?? githubPrimaryOwnerGroupFingerprint(f.state().githubStations, owner),
    f.dependencies,
  );
};

let passed = 0;
async function check(name: string, run: () => Promise<void>) {
  await run();
  console.log(`ok ${++passed} - ${name}`);
}

await check("selected row deletes every same-owner primary and never requests companion or other-owner repos", async () => {
  const f = fixture();
  const result = await remove(f, "OWNER/main-one");
  assert.equal(result.ok, true);
  assert.equal(result.matched, 2);
  assert.equal(result.deleted, 2);
  assert.deepEqual(f.state().githubStations.map((item) => `${item.owner}/${item.repo}`), ["Other/foreign"]);
  assert.deepEqual([...f.deleted].sort(), ["owner/main-one", "owner/main-two"]);
  const paths = f.calls.map((call) => call.path.toLowerCase());
  for (const forbidden of ["companion-a", "companion-b", "companion-c", "foreign", "foreign-companion"]) {
    assert.ok(!paths.some((path) => path.includes(forbidden)), `${forbidden} must never reach the selected account request plan`);
  }
  assert.match(result.message, /3 repo phụ không nhận yêu cầu xóa/);
});

await check("missing, duplicate and primary-companion collision registers stop before GitHub", async () => {
  for (const stations of [
    [station("Owner", "one", 1, "pat")],
    [station("Owner", "one", 1, "pat"), station("owner", "ONE", 2, "pat")],
    [station("Owner", "one", 1, "pat", ["two"]), station("owner", "two", 2, "pat")],
  ]) {
    const f = fixture({ stations });
    const selected = stations.length === 1 ? "Owner/missing" : "Owner/one";
    const result = await remove(f, selected);
    assert.equal(result.ok, false);
    assert.equal(f.calls.length, 0);
    assert.equal(f.state().githubStations.length, stations.length);
  }
});

await check("a stale browser confirmation cannot adopt a primary added in another tab", async () => {
  const f = fixture();
  const result = await remove(f, "Owner/main-one", "owner/main-one");
  assert.equal(result.ok, false);
  assert.match(result.message, /Danh sách repo chính.*thay đổi/);
  assert.equal(f.calls.length, 0);
  assert.equal(f.state().githubStations.length, 3);
});

await check("busy lease and changed target identity retain every row before deletion", async () => {
  const busy = fixture({ busy: true });
  assert.equal((await remove(busy)).ok, false);
  assert.equal(busy.calls.length, 0);
  const changed = fixture({ beforeMutate: (state, mutation) => { if (mutation === 3) state.githubStations[0].githubId = 999; } });
  const result = await remove(changed);
  assert.equal(result.ok, false);
  assert.equal(result.stage, "register");
  assert.equal(changed.state().githubStations.length, 3);
  assert.equal(changed.deleted.size, 2, "remote completion stays visible for an idempotent retry");
});

await check("ID or full-name mismatch stops the whole group before the first DELETE", async () => {
  for (const mutate of [(repo: { id: number; full_name: string }) => { repo.id = 999; }, (repo: { id: number; full_name: string }) => { repo.full_name = "Owner/replacement"; }]) {
    const f = fixture();
    mutate(f.repos.get("owner/main-two")!);
    const result = await remove(f);
    assert.equal(result.ok, false);
    assert.ok(!f.calls.some((call) => call.method === "DELETE"));
    assert.equal(f.state().githubStations.length, 3);
  }
  const legacy = station("Owner", "legacy", 101, "pat-a");
  delete legacy.githubId;
  legacy.primaryDeleteVerifiedGithubId = 101;
  const replaced = fixture({ stations: [legacy] });
  replaced.repos.get("owner/legacy")!.id = 999;
  const result = await remove(replaced, "Owner/legacy");
  assert.equal(result.ok, false, "a durable checkpoint must protect a same-name replacement");
  assert.ok(!replaced.calls.some((call) => call.method === "DELETE"));
});

await check("a restricted first PAT does not block a later owner PAT with delete permission", async () => {
  const f = fixture({ deleteStatus: { "owner/main-one": { "pat-a": 403, "pat-b": 204 } } });
  const result = await remove(f);
  assert.equal(result.ok, true);
  const deletes = f.calls.filter((call) => call.method === "DELETE" && call.path.toLowerCase().endsWith("/main-one"));
  assert.deepEqual(deletes.map((call) => call.auth), ["pat-a", "pat-b"]);
});

await check("a PAT restricted from one repo falls through to another matching owner PAT", async () => {
  const f = fixture({ visibleByPat: { "pat-a": ["owner/main-one"], "pat-b": ["owner/main-one", "owner/main-two"] } });
  const result = await remove(f);
  assert.equal(result.ok, true);
  const secondDeletes = f.calls.filter((call) => call.method === "DELETE" && call.path.toLowerCase().endsWith("/main-two"));
  assert.deepEqual(secondDeletes.map((call) => call.auth), ["pat-b"]);
});

await check("explicit suspended or legally unavailable accounts detach locally without repository DELETE", async () => {
  for (const setup of [
    { identity: { "pat-a": { status: 403, message: "Your account has been suspended." }, "pat-b": { status: 401 } }, accountStatus: 200 },
    { identity: { "pat-a": { status: 451 }, "pat-b": { status: 401 } }, accountStatus: 200 },
    { identity: { "pat-a": { status: 401 }, "pat-b": { status: 401 } }, accountStatus: 404 },
  ]) {
    const f = fixture(setup);
    const result = await remove(f);
    assert.equal(result.ok, true);
    assert.equal(result.localOnly, true);
    assert.equal(f.state().githubStations.length, 1);
    assert.ok(!f.calls.some((call) => call.method === "DELETE"));
  }
});

await check("a legal block reported during DELETE switches the remaining owner group to local-only removal", async () => {
  const f = fixture({ deleteStatus: { "owner/main-one": { "pat-a": 451 } } });
  const result = await remove(f);
  assert.equal(result.ok, true);
  assert.equal(result.localOnly, true);
  assert.equal(f.state().githubStations.length, 1);
  assert.equal(f.calls.filter((call) => call.method === "DELETE").length, 1);
});

await check("revoked PAT for an existing account and ambiguous account failures retain the register", async () => {
  const cases = [
    { identity: { "pat-a": { status: 401 }, "pat-b": { status: 401 } }, accountStatus: 200 },
    { identity: { "pat-a": { status: 403, message: "API rate limit exceeded" }, "pat-b": { status: 401 } }, accountStatus: 404 },
    { identity: { "pat-a": { status: 500 }, "pat-b": { status: 401 } }, accountStatus: 404 },
  ];
  for (const setup of cases) {
    const f = fixture(setup);
    const result = await remove(f);
    assert.equal(result.ok, false);
    assert.equal(f.state().githubStations.length, 3);
    assert.ok(!f.calls.some((call) => call.method === "DELETE"));
  }
  const mixed = fixture({ identity: {
    "pat-a": { status: 403, message: "Your account has been suspended." },
    "pat-b": { status: 500 },
  }, accountStatus: 404 });
  const mixedResult = await remove(mixed);
  assert.equal(mixedResult.ok, false, "ambiguous credentials must win over one suspension-looking response");
  assert.equal(mixed.state().githubStations.length, 3);
});

await check("ambiguous repo reads cannot be converted to absence by a public 404", async () => {
  const f = fixture({ repoStatus: { "owner/main-two": 500 } });
  const result = await remove(f);
  assert.equal(result.ok, false);
  assert.ok(!f.calls.some((call) => call.method === "DELETE"));
  assert.equal(f.state().githubStations.length, 3);
});

await check("full-scope owner PAT can clear an already absent primary, while opaque restricted access cannot", async () => {
  const absent = fixture({ repoStatus: { "owner/main-two": 404 } });
  const result = await remove(absent);
  assert.equal(result.ok, true);
  assert.equal(result.alreadyAbsent, 1);
  const opaque = fixture({
    identity: { "pat-a": { status: 200, login: "Owner" }, "pat-b": { status: 200, login: "Owner" } },
    repoStatus: { "owner/main-two": 404 },
  });
  assert.equal((await remove(opaque)).ok, false);
  assert.ok(!opaque.calls.some((call) => call.method === "DELETE"));
});

await check("DELETE success must be followed by proof that the exact repository disappeared", async () => {
  const f = fixture({ keepAfterDelete: ["owner/main-two"] });
  const result = await remove(f);
  assert.equal(result.ok, false);
  assert.equal(result.deleted, 1);
  assert.match(result.message, /đã xác nhận 1 repo bị xóa/);
  assert.equal(f.state().githubStations.length, 3);
  assert.equal(f.state().githubStations[0].primaryDeleteVerifiedGithubId, 101);

  const retry = fixture({
    stations: f.state().githubStations,
    identity: { "pat-a": { status: 200, login: "Owner" }, "pat-b": { status: 200, login: "Owner" }, "pat-other": { status: 200, login: "Other" } },
    repoStatus: { "owner/main-one": 404 },
  });
  const resumed = await remove(retry);
  assert.equal(resumed.ok, true, "durable ID checkpoint must let a fine-grained PAT resume after partial deletion");
  assert.equal(resumed.alreadyAbsent, 1);
  assert.deepEqual(retry.state().githubStations.map((item) => item.owner), ["Other"]);
});

await check("transport failures and provider details remain private and keep the register", async () => {
  const secret = "ghp_fixture_secret_must_not_escape";
  const f = fixture({ requestError: (call) => call.path === "/user" && ["pat-a", "pat-b"].includes(call.auth) });
  const result = await remove(f);
  assert.equal(result.ok, false);
  assert.ok(!JSON.stringify(result).includes(secret));
  assert.ok(!JSON.stringify(result).includes("transport failure"));
  assert.equal(f.state().githubStations.length, 3);
});

console.log(`Verified ${passed} account-wide primary GitHub deletion cases; all requests and state are injected.`);
