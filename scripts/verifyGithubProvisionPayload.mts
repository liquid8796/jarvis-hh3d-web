#!/usr/bin/env node
/** Contract checks for GitHub provisioning payload sources and workflow paths. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  WORKFLOW_TARGET_PATH,
  buildKhoiloiPayload,
  filesystemPayloadSource,
  gitHeadPayloadSource,
  renderPackageJsonForSource,
  stationKhoiloiPayload,
  workflowTargetPath,
} from "./khoiloiPayload.mjs";

const repoRoot = path.join(import.meta.dirname, "..");
const fixtureRoot = mkdtempSync(path.join(tmpdir(), "github-provision-payload-"));
const symlinkTarget = mkdtempSync(path.join(tmpdir(), "github-provision-symlink-"));
const gitFixtureRoot = mkdtempSync(path.join(tmpdir(), "github-provision-head-"));
const provisionOutputRoot = mkdtempSync(path.join(tmpdir(), "github-provision-output-"));
const filesystemOutputRoot = mkdtempSync(path.join(tmpdir(), "github-provision-filesystem-"));
const fixtureVersion = "9.8.7";
const fixtureLock = Buffer.from(
  JSON.stringify({
    name: "fixture",
    version: fixtureVersion,
    lockfileVersion: 3,
    packages: { "": { name: "fixture", version: fixtureVersion } },
  }),
  "utf8",
);
const binaryBytes = Buffer.from([0x00, 0xff, 0x80, 0x0d, 0x0a, 0x41]);

const write = (relPath: string, content: string | Buffer) => {
  const fullPath = path.join(fixtureRoot, ...relPath.split("/"));
  mkdirSync(path.dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, content);
};

try {
  write(
    "package.json",
    JSON.stringify({
      name: "fixture-release",
      version: fixtureVersion,
      dependencies: { "playwright-core": "^1.2.3" },
    }),
  );
  write(
    "deploy/github/linh-su.yml",
    [
      "name: fixture",
      "env:",
      "  WORKER_ID: fixture-worker",
      "  WEB_URL: ${{ vars.WEB_URL || 'https://old.example.invalid' }}",
      "  WORKER_FALLBACK_URL: ${{ vars.WORKER_FALLBACK_URL || 'https://fallback.example.invalid' }}",
      "  run: curl $GITHUB_API_URL/repos/$GITHUB_REPOSITORY/actions/workflows/linh-su.yml/dispatches",
      "",
    ].join("\n"),
  );
  write("scripts/worker.mjs", "export const worker = true;\n");
  write("src/lib/worker/controlFollow.mjs", "export const follow = true;\n");
  write("src/lib/worker/selfUpdate.mjs", "export const update = true;\n");
  write("src/lib/quest-engine/z-last.mjs", "export const z = true;\n");
  write("src/lib/quest-engine/a-first.mjs", "export const a = true;\n");
  write("src/lib/quest-engine/exact-bytes.bin", binaryBytes);
  execFileSync("git", ["init", "-q"], { cwd: fixtureRoot });
  execFileSync("git", ["config", "user.name", "fixture"], { cwd: fixtureRoot });
  execFileSync("git", ["config", "user.email", "fixture@example.invalid"], { cwd: fixtureRoot });
  execFileSync("git", ["add", "."], { cwd: fixtureRoot });
  execFileSync("git", ["commit", "-q", "-m", "fixture release"], { cwd: fixtureRoot });

  assert.equal(workflowTargetPath(), WORKFLOW_TARGET_PATH);
  assert.equal(workflowTargetPath("nightly.yaml"), ".github/workflows/nightly.yaml");

  const source = filesystemPayloadSource(fixtureRoot);
  assert.deepEqual(source.list("src/lib/quest-engine"), [
    "src/lib/quest-engine/a-first.mjs",
    "src/lib/quest-engine/exact-bytes.bin",
    "src/lib/quest-engine/z-last.mjs",
  ]);
  assert.deepEqual(source.read("src/lib/quest-engine/exact-bytes.bin"), binaryBytes);
  assert.throws(() => source.read("../outside.txt"), /outside|escape|allow|phạm vi/i);
  assert.throws(() => source.read(".env"), /allow|phạm vi|cho phép/i);
  assert.throws(() => source.list("."), /allow|escape|phạm vi|cho phép/i);

  const payload = buildKhoiloiPayload({
    source,
    repoRoot: fixtureRoot,
    workerId: "night-worker",
    webUrl: "https://backend.example.invalid",
    workflowFile: "nightly.yaml",
    lockfile: fixtureLock,
  });
  assert(payload.has(".github/workflows/nightly.yaml"));
  assert(!payload.has(".github/workflows/linh-su.yml"));
  const customWorkflow = payload.get(".github/workflows/nightly.yaml")!.toString("utf8");
  assert.match(customWorkflow, /\/actions\/workflows\/nightly\.yaml\/dispatches/);
  assert.doesNotMatch(customWorkflow, /\/actions\/workflows\/linh-su\.yml\/dispatches/);
  assert.deepEqual(payload.get("src/lib/quest-engine/exact-bytes.bin"), binaryBytes);

  const stationBase = buildKhoiloiPayload({
    source,
    repoRoot: fixtureRoot,
    workerId: "base-worker",
    webUrl: "https://base.example.invalid",
    lockfile: fixtureLock,
  });
  assert.match(
    stationBase.get(WORKFLOW_TARGET_PATH)!.toString("utf8"),
    /\/actions\/workflows\/linh-su\.yml\/dispatches/,
    "default workflow keeps its original self-dispatch endpoint",
  );
  const unrelatedWorkflow = Buffer.from("name: maintained elsewhere\n", "utf8");
  stationBase.set(".github/workflows/manual.yml", unrelatedWorkflow);
  const stationPayload = stationKhoiloiPayload({
    basePayload: stationBase,
    template: source.read("deploy/github/linh-su.yml").toString("utf8"),
    workerId: "night-worker",
    webUrl: "https://backend.example.invalid",
    workflowFile: "nightly.yaml",
  });
  assert(stationPayload.has(".github/workflows/nightly.yaml"));
  assert(!stationPayload.has(WORKFLOW_TARGET_PATH));
  assert.deepEqual(stationPayload.get(".github/workflows/manual.yml"), unrelatedWorkflow);
  const deployedWorkflow = stationPayload.get(".github/workflows/nightly.yaml")!.toString("utf8");
  assert.match(deployedWorkflow, /\/actions\/workflows\/nightly\.yaml\/dispatches/);
  assert.doesNotMatch(deployedWorkflow, /\/actions\/workflows\/linh-su\.yml\/dispatches/);

  write(
    "package.json",
    JSON.stringify({
      name: "dirty-working-tree",
      version: "99.99.99",
      dependencies: { "playwright-core": "^99.99.99" },
    }),
  );
  execFileSync(process.execPath, [path.join(repoRoot, "scripts", "githubProvisioningPayload.mjs")], {
    cwd: repoRoot,
    input: JSON.stringify({
      root: fixtureRoot,
      directory: provisionOutputRoot,
      workerId: "head-worker",
      workflowFile: "nightly.yaml",
      sourceMode: "git-head",
    }),
  });
  const stagedPackage = JSON.parse(readFileSync(path.join(provisionOutputRoot, "package.json"), "utf8"));
  const stagedLock = JSON.parse(readFileSync(path.join(provisionOutputRoot, "package-lock.json"), "utf8"));
  assert.equal(stagedPackage.version, fixtureVersion, "git-head helper stages the committed package without a prebuilt artifact");
  assert.equal(stagedPackage.dependencies["playwright-core"], "^1.2.3", "dirty dependency changes do not enter git-head payload");
  assert.equal(stagedLock.packages[""].version, fixtureVersion, "generated lock and package use the same committed version");
  assert.throws(
    () => execFileSync(process.execPath, [path.join(repoRoot, "scripts", "githubProvisioningPayload.mjs")], {
      cwd: repoRoot,
      input: JSON.stringify({
        root: fixtureRoot,
        directory: filesystemOutputRoot,
        workerId: "filesystem-worker",
        workflowFile: "linh-su.yml",
        sourceMode: "filesystem",
      }),
      stdio: ["pipe", "pipe", "pipe"],
    }),
    /Command failed/,
    "filesystem mode requires the prebuilt lock artifact instead of generating one during a request",
  );
  assert.deepEqual(readdirSync(filesystemOutputRoot), [], "missing filesystem artifact fails before staging any payload files");

  writeFileSync(path.join(symlinkTarget, "escaped.mjs"), "export const escaped = true;\n");
  symlinkSync(
    symlinkTarget,
    path.join(fixtureRoot, "src", "lib", "quest-engine", "linked"),
    "junction",
  );
  assert.throws(
    () => filesystemPayloadSource(fixtureRoot).list("src/lib/quest-engine"),
    /symbolic|symlink|liên kết/i,
  );

  const headSource = gitHeadPayloadSource(repoRoot);
  const headVersion = JSON.parse(headSource.read("package.json").toString("utf8")).version;
  const deployPayload = buildKhoiloiPayload({
    source: headSource,
    repoRoot,
    workerId: "deployed-night-worker",
    webUrl: "https://backend.example.invalid",
    workflowFile: "nightly.yaml",
    lockfile: Buffer.from(
      JSON.stringify({ version: headVersion, packages: { "": { version: headVersion } } }),
      "utf8",
    ),
  });
  assert(deployPayload.has(".github/workflows/nightly.yaml"));
  assert(!deployPayload.has(WORKFLOW_TARGET_PATH));

  writeFileSync(
    path.join(gitFixtureRoot, "package.json"),
    JSON.stringify({
      name: "head-fixture",
      version: "4.5.6",
      dependencies: { "playwright-core": "^1.2.3" },
    }),
  );
  execFileSync("git", ["init", "-q"], { cwd: gitFixtureRoot });
  execFileSync("git", ["config", "user.name", "fixture"], { cwd: gitFixtureRoot });
  execFileSync("git", ["config", "user.email", "fixture@example.invalid"], { cwd: gitFixtureRoot });
  execFileSync("git", ["add", "package.json"], { cwd: gitFixtureRoot });
  execFileSync("git", ["commit", "-q", "-m", "fixture HEAD"], { cwd: gitFixtureRoot });
  writeFileSync(
    path.join(gitFixtureRoot, "package.json"),
    JSON.stringify({
      name: "working-tree-fixture",
      version: "9.9.9",
      dependencies: { "playwright-core": "^9.9.9" },
    }),
  );
  const packageFromHead = JSON.parse(
    renderPackageJsonForSource(gitHeadPayloadSource(gitFixtureRoot)),
  );
  assert.equal(packageFromHead.version, "4.5.6");
  assert.equal(packageFromHead.dependencies["playwright-core"], "^1.2.3");

  console.log(
    "✔ GitHub provisioning payload: gitless source, exact bytes, path safety, and dynamic workflow passed.",
  );
} finally {
  for (const directory of [fixtureRoot, symlinkTarget, gitFixtureRoot, provisionOutputRoot, filesystemOutputRoot]) {
    const resolved = realpathSync(directory);
    assert.equal(path.dirname(resolved), realpathSync(tmpdir()));
    assert(path.basename(resolved).startsWith("github-provision-"));
    rmSync(resolved, { recursive: true, force: true });
  }
}
