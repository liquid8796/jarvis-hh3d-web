import assert from "node:assert/strict";
import { mergeGithubBranch } from "../src/lib/validation/githubSettingsMerge";

const before = [{ owner: "o", repo: "main", enabled: true, companionRepos: [{ repo: "side", pushesToday: 0 }] }];
const worker = [{ ...before[0], companionRepos: [{ repo: "side", pushesToday: 1 }, { repo: "new", githubId: 2 }] }];
const admin = [{ ...before[0], enabled: false }];
assert.deepEqual(mergeGithubBranch(before, admin, worker), [{ ...worker[0], enabled: false }]);
assert.deepEqual(mergeGithubBranch(before, before, worker), worker);
assert.deepEqual(mergeGithubBranch(before, [], worker), []);
assert.deepEqual(mergeGithubBranch(before, admin, []), []);
const baseline = { model: "old", apiKeys: [{ id: "a", disabled: false, lastUsedAt: null }] };
const concurrent = { model: "old", apiKeys: [{ id: "a", disabled: false, lastUsedAt: "now" }, { id: "b", disabled: false }] };
assert.deepEqual(mergeGithubBranch(baseline, { ...baseline, model: "new" }, concurrent), { ...concurrent, model: "new" });
console.log("PASS settings merge preserves worker checkpoints, newly imported keys, explicit changes, and concurrent deletion");
