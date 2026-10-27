import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, existsSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildWorkflowOnlyPayload, filesystemPayloadSource, renderWorkflow } from "./khoiloiPayload.mjs";

const root = path.resolve(import.meta.dirname, "..");
const source = filesystemPayloadSource(root);
const template = source.read("deploy/github/linh-su.yml").toString("utf8");
const dynamicToken = "/actions/workflows/$wf_file/dispatches";
assert.ok(template.includes(dynamicToken), "Live workflow template should self-dispatch using actual workflow ref");
for (const filename of ["linh-su.yml", "night-worker.yaml"]) {
  const workerId = "provision-smoke-fixture";
  const rendered = buildWorkflowOnlyPayload({
    source, workerId, workflowFile: filename,
    webUrl: "https://158.180.59.36.sslip.io", purpose: "worker",
  });
  assert.deepEqual([...rendered.keys()], [`.github/workflows/${filename}`]);
  const content = rendered.get(`.github/workflows/${filename}`)!.toString("utf8");
  assert.ok(content.includes(dynamicToken), "Self-dispatch must preserve dynamic workflow filename");
  assert.ok(content.includes("WORKER_ID: provision-smoke-fixture"));
  assert.ok(!content.includes("__PUBLIC_WORKFLOW_NAME__"));
}
// Backward compatibility with the old literal filename template.
const legacy = template.replace(dynamicToken, "/actions/workflows/linh-su.yml/dispatches");
assert.ok(renderWorkflow({
  template: legacy, workerId: "provision-smoke-fixture",
  workflowFile: "night-worker.yaml", webUrl: "https://158.180.59.36.sslip.io",
}).includes("/actions/workflows/night-worker.yaml/dispatches"));

const ambiguousTarget = template.replace(dynamicToken, dynamicToken + "\n  # /actions/workflows/linh-su.yml/dispatches");
assert.throws(() => renderWorkflow({
  template: ambiguousTarget, workerId: "provision-smoke-fixture",
  workflowFile: "night-worker.yaml", webUrl: "https://158.180.59.36.sslip.io",
}), /exactly one supported self-dispatch target/);
assert.throws(() => renderWorkflow({
  template: template.replace(dynamicToken, "no target"),
  workerId: "provision-smoke-fixture",
  workflowFile: "night-worker.yaml", webUrl: "https://158.180.59.36.sslip.io",
}), /exactly one supported self-dispatch target/);
const directory = mkdtempSync(path.join(tmpdir(), "github-provision-"));
try {
  execFileSync(process.execPath, [path.join(root, "scripts/githubProvisioningPayload.mjs")], {
    cwd: root,
    input: JSON.stringify({
      root, directory, workerId: "provision-smoke-fixture",
      workflowFile: "night-worker.yaml", purpose: "worker", sourceMode: "filesystem",
    }),
    timeout: 30_000,
    stdio: ["pipe", "pipe", "pipe"],
  });
  assert.deepEqual(readdirSync(directory), [".github"]);
  const staged = path.join(directory, ".github", "workflows", "night-worker.yaml");
  assert.ok(existsSync(staged));
  assert.ok(readFileSync(staged, "utf8").includes(dynamicToken));
  console.log("PASS: Production-style filesystem provisioning and legacy/current template parity");
} finally {
  rmSync(directory, { recursive: true, force: true });
}
