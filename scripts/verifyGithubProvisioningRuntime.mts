/** Exercise the production payload/process adapters without GitHub or database mutations. */
import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, realpath, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { productionGithubProvisionDependencies as production, resolveGithubProvisioningTemp } from "../src/lib/services/githubProvisioning";

const root = process.cwd();
const release = await mkdtemp(path.join(await realpath(tmpdir()), "gitless-provision-test-"));
let prepared: Awaited<ReturnType<typeof production.localPreflight>> | undefined;
try {
  for (const relative of ["scripts/githubProvisioningPayload.mjs", "scripts/githubPublicIdentity.mjs", "scripts/khoiloiPayload.mjs", "scripts/khoiloiNaming.mjs", "scripts/worker.mjs", "src/lib/quest-engine", "src/lib/worker/controlFollow.mjs", "src/lib/worker/selfUpdate.mjs", "deploy/github/linh-su.yml", "package.json", "public/linh-su/github-provisioning-lock.json"]) {
    await mkdir(path.dirname(path.join(release, relative)), { recursive: true });
    await cp(path.join(root, relative), path.join(release, relative), { recursive: true });
  }
  process.env.ENCRYPTION_KEY = "ab".repeat(32);
  process.env.WORKER_TOKEN = "fixture-worker-token";
  process.env.DATABASE_URL = "postgresql://unused.invalid/fixture";
  process.chdir(release);
  const ctx = { pat: "fixture-pat", repo: "fixture-project", workerId: "fixture-worker", owner: "Fixture", slug: "Fixture/fixture-project", workflowFile: "custom.yaml", dailyPushes: 4, generatedRepo: false, now: Date.now, deadlineAt: Date.now() + 210_000 };
  prepared = await production.localPreflight(ctx);
  const tempRoot = await realpath(tmpdir());
  for (const rejected of [tempRoot, root, release, path.join(root, "github-provision-Outside"), path.join(tempRoot, "github-provision-x", "nested"), "github-provision-relative"]) await assert.rejects(resolveGithubProvisioningTemp(rejected));
  assert.equal(await resolveGithubProvisioningTemp(prepared.directory), await realpath(prepared.directory));
  const link = path.join(tempRoot, `github-provision-Link${Date.now()}`);
  try { await symlink(release, link, "junction"); await assert.rejects(resolveGithubProvisioningTemp(link)); } finally { await unlink(link); }
  assert.ok(prepared.encryptedPat.startsWith("v1."));
  const proof = await production.stage(ctx, prepared);
  assert.match(proof.initialCommitSha, /^[a-f0-9]{40}$/);
  const workflow = await readFile(path.join(prepared.directory, ".github/workflows/custom.yaml"), "utf8");
  assert.ok(workflow.includes("WORKER_ID: fixture-worker"));
  assert.ok(workflow.includes("/actions/workflows/custom.yaml/dispatches"));
  assert.ok(!workflow.includes("/actions/workflows/linh-su.yml/dispatches"));
  assert.ok(!workflow.includes("__PUBLIC_WORKFLOW_NAME__") && !workflow.includes("__PUBLIC_JOB_NAME__"));
  assert.match(workflow, /^jobs:\r?\n  linh-su:\r?\n    name: "[A-Za-z0-9 '&-]+"$/m);
  const packageJson = JSON.parse(await readFile(path.join(prepared.directory, "package.json"), "utf8"));
  const lock = JSON.parse(await readFile(path.join(prepared.directory, "package-lock.json"), "utf8"));
  assert.equal(packageJson.version, lock.packages[""].version);
  assert.ok(!workflow.includes(ctx.pat));
  assert.ok(!workflow.includes(process.env.WORKER_TOKEN));
  await writeFile(path.join(release, "public/linh-su/github-provisioning-lock.json"), JSON.stringify({ schemaVersion: 1, packageVersion: "0.0.0" }));
  await assert.rejects(production.localPreflight(ctx));
  console.log("PASS: gitless production staging, custom self-dispatch, lock version, secret boundary and guarded cleanup; no GitHub/DB calls.");
} finally {
  process.chdir(root);
  if (prepared) await production.dispose(prepared);
  const resolved = await realpath(release);
  assert.equal(path.dirname(resolved), await realpath(tmpdir()));
  assert.ok(path.basename(resolved).startsWith("gitless-provision-test-"));
  await rm(resolved, { recursive: true, force: true });
}
