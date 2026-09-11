#!/usr/bin/env node
/** Pure contract checks for primary GitHub provisioning input normalization. */
import assert from "node:assert/strict";
import {
  normalizeGithubProvisionInput,
  reviewNormalizedProvisionIdentity,
} from "../src/lib/validation/githubProvisioning";

const fixturePat = "ghp_fixture_value";
const normalize = (input: Partial<Parameters<typeof normalizeGithubProvisionInput>[0]> = {}) =>
  normalizeGithubProvisionInput(
    { pat: fixturePat, repo: "given-worker", workflowFile: "worker.yml", dailyPushes: "5", ...input },
  );

const defaults = normalizeGithubProvisionInput(
  { pat: fixturePat, repo: "", workflowFile: "", dailyPushes: "" },
);
assert.deepEqual(defaults, {
  pat: fixturePat,
  repo: "",
  workflowFile: "linh-su.yml",
  dailyPushes: 5,
  workerId: "",
  generatedRepo: true,
});
assert.deepEqual(normalize({ repo: "  " }), { ...normalize(), repo: "", workerId: "", generatedRepo: true });

const supplied = normalizeGithubProvisionInput(
  { pat: fixturePat, repo: "  given-worker  ", workflowFile: "worker.yaml", dailyPushes: 24 },
);
assert.equal(supplied.repo, "given-worker", "explicit repository names are only trimmed");
assert.equal(supplied.workerId, "given-worker");
assert.equal(supplied.generatedRepo, false);

for (const good of ["0", "24"]) {
  assert.doesNotThrow(() => normalize({ dailyPushes: good }), `dailyPushes=${good} should be accepted`);
}
for (const bad of ["-1", "25", "1.5", "five"]) {
  assert.throws(() => normalize({ dailyPushes: bad }), `dailyPushes=${bad} should be rejected`);
}
for (const bad of ["../x.yml", "dir/x.yml", "x.txt", ".yml"]) {
  assert.throws(() => normalize({ workflowFile: bad }), `workflowFile=${bad} should be rejected`);
}
for (const bad of [" ghp_fixture_value", "ghp_fixture_value ", "ghp fixture value"]) {
  assert.throws(() => normalize({ pat: bad }), "PAT whitespace should be rejected");
}
assert.equal(reviewNormalizedProvisionIdentity("valid-owner", supplied), null);
assert.notEqual(reviewNormalizedProvisionIdentity("invalid owner", supplied), null);
assert.notEqual(
  reviewNormalizedProvisionIdentity("valid-owner", normalize({ repo: "invalid repo" })),
  null,
  "repository identity must be checked after the owner is resolved",
);

console.log("✔ GitHub provisioning input normalization: defaults, bounds, identity, and safety checks passed.");
