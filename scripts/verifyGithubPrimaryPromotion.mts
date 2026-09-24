import assert from "node:assert/strict";
import { planGithubPromotionHistory, promoteGithubCompanionToPrimary, type GithubPrimaryPromotionDependencies, type GithubPrimaryPromotionRemote } from "../src/lib/services/githubPrimaryPromotion";
import { appSettingsSchema, type AppSettings } from "../src/lib/services/settings";

const owner = "sample-owner";
const oldRepo = "primary-repo";
const nextRepo = "weather-workbench";

function makeSettings(deferred = false): AppSettings {
  return appSettingsSchema.parse({
    githubStations: [{
      owner, repo: oldRepo, workflowFile: "linh-su.yml", workerId: "worker-sample", pat: "fixture",
      provisionedBy: "jarvis", primaryDeferred: deferred, githubId: deferred ? undefined : 101,
      enabled: true, dailyPushes: 5,
      companionRepos: [
        { repo: nextRepo, githubId: 202, actionsDisabled: true, lastNurtureDay: null, pushesToday: 0, lastPushAt: null, lastPushOk: null, lastPushNote: "" },
        { repo: "keep-repo", githubId: 303, lastNurtureDay: null, pushesToday: 0, lastPushAt: null, lastPushOk: null, lastPushNote: "" },
      ],
      lastPingAt: null, lastCommitAt: null, lastPingOk: null, lastPingNote: "", workflowState: "",
    }],
  });
}

function harness(options: { deferred?: boolean; targetId?: number; failMutation?: boolean; targetActions?: boolean } = {}) {
  let state = makeSettings(!!options.deferred);
  const events: string[] = [];
  const enabled = new Map([[oldRepo, true], [nextRepo, !!options.targetActions]]);
  const remote: GithubPrimaryPromotionRemote = {
    async info(_o, repo) {
      events.push("info:" + repo);
      if (repo === nextRepo) return { id: options.targetId ?? 202, full_name: owner + "/" + nextRepo, default_branch: "main", private: false };
      if (repo === oldRepo && !options.deferred) return { id: 101, full_name: owner + "/" + oldRepo, default_branch: "main", private: false };
      return null;
    },
    async actionsEnabled(_o, repo) { events.push("state:" + repo); return enabled.get(repo) ?? false; },
    async disableActions(_o, repo) { events.push("off:" + repo); enabled.set(repo, false); },
    async enableActions(_o, repo) { events.push("on:" + repo); enabled.set(repo, true); },
    async installPayload(_o, repo, files) { events.push("install:" + repo + ":" + files.size); return { sha: "f".repeat(40) }; },
    async setWorkerSecret(_o, repo) { events.push("secret:" + repo); },
    async dispatch(_o, repo) { events.push("dispatch:" + repo); },
  };
  const deps: GithubPrimaryPromotionDependencies = {
    now: () => Date.parse("2026-09-24T04:30:00.000Z"),
    read: async () => state,
    mutate: async (change) => {
      events.push("mutate");
      if (options.failMutation) throw new Error("fixture");
      const next = structuredClone(state); change(next); state = appSettingsSchema.parse(next);
    },
    acquireLease: async () => ({ assertHeld: async () => { events.push("held"); }, release: async () => { events.push("release"); } }),
    openPat: value => value,
    preparePayload: async () => ({ files: new Map([[".github/workflows/linh-su.yml", Buffer.from("x")]]), workerToken: "fixture", dispose: async () => { events.push("dispose"); } }),
    remote: () => remote,
  };
  return { deps, events, enabled, get state() { return state; } };
}

assert.deepEqual(planGithubPromotionHistory("default-sha", "main-sha"), {
  baseHead: "main-sha",
  parents: ["main-sha", "default-sha"],
});
assert.deepEqual(planGithubPromotionHistory("same-sha", "same-sha"), {
  baseHead: "same-sha",
  parents: ["same-sha"],
});
assert.deepEqual(planGithubPromotionHistory("default-only", null), {
  baseHead: "default-only",
  parents: ["default-only"],
});

{
  const h = harness();
  const result = await promoteGithubCompanionToPrimary(owner + "/" + oldRepo, nextRepo, h.deps);
  assert.equal(result.ok, true);
  assert.equal(result.newSlug, owner + "/" + nextRepo);
  const station = h.state.githubStations[0]!;
  assert.equal(station.repo, nextRepo);
  assert.equal(station.githubId, 202);
  assert.equal(station.initialCommitSha, "f".repeat(40));
  assert.deepEqual(station.companionRepos.map(item => item.repo).sort(), ["keep-repo", oldRepo].sort());
  assert.equal(station.companionRepos.find(item => item.repo === oldRepo)?.actionsDisabled, true);
  assert.equal(h.enabled.get(oldRepo), false);
  assert.equal(h.enabled.get(nextRepo), true);
  assert.ok(h.events.indexOf("off:" + oldRepo) < h.events.indexOf("on:" + nextRepo));
  assert.ok(h.events.indexOf("on:" + nextRepo) < h.events.indexOf("mutate"));
}

{
  const h = harness({ deferred: true });
  const result = await promoteGithubCompanionToPrimary(owner + "/" + oldRepo, nextRepo, h.deps);
  assert.equal(result.ok, true);
  assert.deepEqual(h.state.githubStations[0]!.companionRepos.map(item => item.repo), ["keep-repo"]);
  assert.equal(h.events.includes("info:" + oldRepo), false);
  assert.equal(h.events.includes("off:" + oldRepo), false);
}

{
  const h = harness({ targetId: 999 });
  const result = await promoteGithubCompanionToPrimary(owner + "/" + oldRepo, nextRepo, h.deps);
  assert.equal(result.ok, false);
  assert.equal(h.events.some(event => event.startsWith("install:")), false);
}

{
  const h = harness({ failMutation: true });
  const result = await promoteGithubCompanionToPrimary(owner + "/" + oldRepo, nextRepo, h.deps);
  assert.equal(result.ok, false);
  assert.equal(h.state.githubStations[0]!.repo, oldRepo);
  assert.equal(h.enabled.get(nextRepo), false);
  assert.equal(h.enabled.get(oldRepo), true);
}

{
  const h = harness({ targetActions: true });
  const result = await promoteGithubCompanionToPrimary(owner + "/" + oldRepo, nextRepo, h.deps);
  assert.equal(result.ok, true);
  assert.ok(h.events.indexOf("off:" + nextRepo) < h.events.indexOf("install:" + nextRepo + ":1"));
}

console.log("PASS: GitHub companion promotion swaps roles, handles deferred primary, checks identity, and restores the old primary on registry failure.");
