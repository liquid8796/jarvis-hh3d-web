/**
 * One workflow source of truth for every GitHub sect worker entry path.
 *
 * The UI create flow, UI promote flow, direct CLI creator, and fleet deployer must all stage the
 * exact workflow rendered by buildWorkflowOnlyPayload. Project source is intentionally outside
 * this contract: promoted repositories keep and nurture their own code while Jarvis owns only the
 * configured workflow file.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  buildWorkflowOnlyPayload,
  filesystemPayloadSource,
  workflowTargetPath,
} from "./khoiloiPayload.mjs";

const repoRoot = path.join(import.meta.dirname, "..");
const read = (relative: string) => readFileSync(path.join(repoRoot, relative), "utf8");

const helper = read("scripts/githubProvisioningPayload.mjs");
const provision = read("src/lib/services/githubProvisioning.ts");
const promote = read("src/lib/services/githubPrimaryPromotion.ts");
const deploy = read("scripts/deployGithubKhoiloi.mts");
const creator = read("scripts/newGithubKhoiloi.mjs");
const workflow = read("deploy/github/linh-su.yml");

assert(helper.includes("buildWorkflowOnlyPayload"));
assert(!helper.includes("buildKhoiloiPayload"));
assert(provision.includes('githubProvisioningPayload.mjs'));
assert(provision.includes('productionLocalPreflight(ctx, "filesystem")'));
assert(promote.includes('githubProvisioningPayload.mjs'));
assert(promote.includes('promotion-payload-must-be-workflow-only'));
assert(deploy.includes("buildWorkflowOnlyPayload"));
assert(creator.includes("buildWorkflowOnlyPayload"));

for (const required of [
  'WORKER_SELF_UPDATE: "1"',
  'LINH_SU_EXIT=$ma',
  'if [ "$ma" -eq 90 ]',
  'if [ "${LINH_SU_EXIT:-}" = "90" ]',
] as const) {
  assert(workflow.includes(required), `workflow is missing ${required}`);
}
const workerId = "parity-worker";
const workflowFile = "parity-worker.yml";
const target = workflowTargetPath(workflowFile);
const expected = buildWorkflowOnlyPayload({
  source: filesystemPayloadSource(repoRoot),
  workerId,
  workflowFile,
  webUrl: "https://158.180.59.36.sslip.io",
});
assert.deepEqual([...expected.keys()], [target]);

const output = mkdtempSync(path.join(realpathSync(tmpdir()), "github-workflow-parity-"));
try {
  execFileSync(process.execPath, [path.join(repoRoot, "scripts", "githubProvisioningPayload.mjs")], {
    cwd: repoRoot,
    input: JSON.stringify({ root: repoRoot, directory: output, workerId, workflowFile, sourceMode: "filesystem" }),
    stdio: ["pipe", "pipe", "pipe"],
  });
  const staged = readFileSync(path.join(output, target));
  assert.deepEqual(staged, expected.get(target));
} finally {
  const resolved = realpathSync(output);
  assert.equal(path.dirname(resolved), realpathSync(tmpdir()));
  assert(path.basename(resolved).startsWith("github-workflow-parity-"));
  rmSync(resolved, { recursive: true, force: true });
}

console.log("OK: create, promote, CLI, and fleet deploy share one workflow-only source structure (worker).");