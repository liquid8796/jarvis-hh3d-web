#!/usr/bin/env node
/** Contract checks for the GitHub provisioning CLI and its Windows launcher. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { normalizeGithubProvisionInput } from "../src/lib/validation/githubProvisioning";
import {
  parseGithubProvisionArgs,
  runGithubProvisionCli,
  type GithubProvisionCliDependencies,
} from "./newGithubStation.mts";

const fixturePat = "ghp_fixture_value";
const fixtureRepo = "amber-lake-0123456789abcdef";
const silent = { log: (_message: string) => {}, error: (_message: string) => {} };

const blank = parseGithubProvisionArgs(
  ["--repo", "", "--workflow-file", "", "--daily-pushes", ""],
  { GITHUB_PAT: fixturePat },
);
const normalized = normalizeGithubProvisionInput(blank.input, { randomRepo: () => fixtureRepo });
assert.deepEqual(
  { repo: normalized.repo, workflowFile: normalized.workflowFile, dailyPushes: normalized.dailyPushes },
  { repo: fixtureRepo, workflowFile: "linh-su.yml", dailyPushes: 5 },
  "blank CLI fields must reach the shared defaults",
);

let provisionInput: Parameters<GithubProvisionCliDependencies["provision"]>[0] | undefined;
const successDeps: GithubProvisionCliDependencies = {
  provision: async input => {
    provisionInput = input;
    return { ok: true, stage: "complete", slug: "RealOwner/chosen-repo", message: "complete", warnings: ["later"] };
  },
  dryRun: async () => ({ ok: true, stage: "complete", slug: "DryOwner/dry-repo", message: "dry", warnings: [] }),
};
assert.equal(
  await runGithubProvisionCli(
    ["--repo", "chosen-repo", "--workflow-file", "nightly.yaml", "--daily-pushes", "24"],
    { GITHUB_PAT: fixturePat },
    successDeps,
    silent,
  ),
  0,
  "complete with warnings is still a successful CLI exit",
);
assert.deepEqual(provisionInput, {
  pat: fixturePat,
  repo: "chosen-repo",
  workflowFile: "nightly.yaml",
  dailyPushes: "24",
});
const explicit = normalizeGithubProvisionInput(provisionInput!, { randomRepo: () => fixtureRepo });
assert.equal(explicit.workerId, "chosen-repo", "an explicit repository must also be the worker ID");

let called = false;
await assert.rejects(
  () => runGithubProvisionCli(
    ["--owner", "OtherOwner"],
    { GITHUB_PAT: fixturePat },
    { ...successDeps, provision: async input => { called = true; return successDeps.provision(input); } },
    silent,
  ),
  /--owner.*PAT-less.*--dry-run/i,
  "an authenticated owner cannot be overridden",
);
assert.equal(called, false, "owner override rejection must happen before the service call");

let dryInput: Parameters<GithubProvisionCliDependencies["dryRun"]>[0] | undefined;
assert.equal(
  await runGithubProvisionCli(
    ["--dry-run", "--owner", "DryOwner", "--repo", "dry-repo"],
    {},
    { ...successDeps, dryRun: async input => { dryInput = input; return successDeps.dryRun(input); } },
    silent,
  ),
  0,
);
assert.deepEqual(dryInput, {
  pat: "",
  repo: "dry-repo",
  workflowFile: undefined,
  dailyPushes: undefined,
  dryRun: true,
  ownerForDryRun: "DryOwner",
});
await assert.rejects(
  () => runGithubProvisionCli([], {}, successDeps, silent),
  /GITHUB_PAT/i,
  "a live CLI run must require the PAT environment variable",
);

const failedDeps: GithubProvisionCliDependencies = {
  ...successDeps,
  provision: async () => ({ ok: false, stage: "attention", slug: "RealOwner/chosen-repo", message: "inspect", warnings: [] }),
};
assert.equal(await runGithubProvisionCli([], { GITHUB_PAT: fixturePat }, failedDeps, silent), 1);

const repoRoot = path.join(import.meta.dirname, "..");
const batBytes = readFileSync(path.join(repoRoot, "new-github-khoiloi.bat"));
assert.ok([...batBytes].every(byte => byte < 0x80), "batch launcher must remain ASCII-only");
const bat = batBytes.toString("ascii");
const repoPrompt = bat.indexOf("Repository [random]");
const workflowPrompt = bat.indexOf("Workflow [linh-su.yml]");
const dailyPrompt = bat.indexOf("Daily pushes [5]");
assert.ok(repoPrompt >= 0 && workflowPrompt > repoPrompt && dailyPrompt > workflowPrompt, "batch prompts for repo, workflow, then daily limit");
assert.match(bat, /set "WORKFLOW_FILE=linh-su\.yml"[\s\S]*set \/p "WORKFLOW_FILE=/i, "Enter keeps the workflow default");
assert.match(bat, /set "DAILY_PUSHES=5"[\s\S]*set \/p "DAILY_PUSHES=/i, "Enter keeps the daily default");
const runWithRepoLabel = bat.indexOf("\r\n:run_with_repo\r\n");
const afterRunLabel = bat.indexOf("\r\n:after_run\r\n");
const defaultCommand = bat.slice(bat.indexOf("if defined REPO_NAME goto :run_with_repo"), runWithRepoLabel);
const namedCommand = bat.slice(runWithRepoLabel, afterRunLabel);
assert.ok(defaultCommand.includes("npm run github:new") && !defaultCommand.includes("--repo"), "blank repository omits --repo");
assert.ok(namedCommand.includes('--repo "%REPO_NAME%"'), "a supplied repository is forwarded only in its validated branch");
assert.match(bat, /Read-Host -AsSecureString/, "PAT remains hidden at the prompt");
assert.match(bat, /npm run vm -- --env GITHUB_PAT -- npm run github:new/, "PAT remains environment-only through vmRun");
assert.ok(!/github:new[^\r\n]*%\*/i.test(bat), "raw launcher arguments are never forwarded to vmRun");

const lowLevel = readFileSync(path.join(repoRoot, "scripts", "newGithubKhoiloi.mjs"), "utf8");
assert.match(lowLevel, /buildKhoiloiPayload\(\{[^}]*workflowFile/s, "low-level payload uses the chosen workflow");
assert.match(lowLevel, /\["workflow", "run", workflowFile,/s, "low-level dispatch uses the chosen workflow");

console.log("✔ GitHub provisioning CLI: flags, defaults, owner authority, batch safety, and workflow routing passed.");
