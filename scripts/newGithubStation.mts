#!/usr/bin/env node
/** Thin CLI adapter for the shared primary GitHub provisioning service. */
import { spawn } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  normalizeGithubProvisionInput,
  reviewNormalizedProvisionIdentity,
  type GithubProvisionInput,
} from "../src/lib/validation/githubProvisioning";
import {
  provisionGithubStation,
  githubProvisioningDependenciesForPayloadSource,
  productionGithubProvisionDependencies,
  type GithubProvisionResult,
} from "../src/lib/services/githubProvisioning";
import { loadEnv } from "./loadEnv.mjs";

export type GithubProvisionCliOptions = {
  input: GithubProvisionInput;
};

export type GithubProvisionCliDependencies = {
  provision: (input: GithubProvisionInput) => Promise<GithubProvisionResult>;
  dryRun: (input: GithubProvisionInput) => Promise<GithubProvisionResult>;
};

type GithubProvisionCliIo = {
  log: (message: string) => void;
  error: (message: string) => void;
};

const valueFlags = new Map([
  ["--repo", "repo"],
  ["--workflow-file", "workflowFile"],
  ["--daily-pushes", "dailyPushes"],
  ["--owner", "ownerForDryRun"],
] as const);

/** Parse only the documented CLI surface. Blank values remain blank for the shared normalizer. */
export function parseGithubProvisionArgs(
  argv: string[],
  env: NodeJS.ProcessEnv = process.env,
): GithubProvisionCliOptions {
  const values: Partial<Record<"repo" | "workflowFile" | "dailyPushes" | "ownerForDryRun", string>> = {};
  let dryRun = false;

  for (let at = 0; at < argv.length; at += 1) {
    const token = argv[at];
    if (token === "--dry-run") {
      dryRun = true;
      continue;
    }
    // Kept as a harmless compatibility flag for direct launcher invocations.
    if (token === "--no-pause") continue;

    const field = valueFlags.get(token as "--repo" | "--workflow-file" | "--daily-pushes" | "--owner");
    if (!field) throw new Error("Unknown option. Use --repo, --workflow-file, --daily-pushes, --dry-run, or PAT-less --owner.");
    const value = argv[at + 1];
    if (value === undefined || (value.startsWith("--") && value.length > 0)) {
      throw new Error(`${token} requires a value.`);
    }
    values[field] = value;
    at += 1;
  }

  const pat = env.GITHUB_PAT ?? "";
  const ownerForDryRun = values.ownerForDryRun?.trim() || undefined;
  if (ownerForDryRun && (pat.length > 0 || !dryRun)) {
    throw new Error("--owner is available only for a PAT-less --dry-run; live ownership comes from the PAT.");
  }
  if (!pat && !dryRun) {
    throw new Error("GITHUB_PAT is required for a live provisioning run.");
  }
  if (!pat && dryRun && !ownerForDryRun) {
    throw new Error("A PAT-less --dry-run requires --owner <GitHub account>.");
  }

  return {
    input: {
      pat,
      repo: values.repo?.trim() || undefined,
      workflowFile: values.workflowFile?.trim() || undefined,
      dailyPushes: values.dailyPushes?.trim() || undefined,
      ...(dryRun ? { dryRun: true } : {}),
      ...(ownerForDryRun ? { ownerForDryRun } : {}),
    },
  };
}

type GithubProvisionDryRunDependencies = Pick<typeof productionGithubProvisionDependencies, "whoami" | "checkScopes"> & {
  checkPayload: (args: string[]) => Promise<boolean>;
};

async function checkDryRunPayload(args: string[]): Promise<boolean> {
  const childEnv = { ...process.env };
  delete childEnv.GITHUB_PAT;
  delete childEnv.GH_TOKEN;
  return new Promise(resolve => {
    const child = spawn(process.execPath, args, {
      cwd: path.join(import.meta.dirname, ".."),
      env: childEnv,
      shell: false,
      windowsHide: true,
      stdio: "inherit",
    });
    child.on("error", () => resolve(false));
    child.on("close", code => resolve(code === 0));
  });
}

/** Preview payload bytes without invoking Ollama or updating API key health in the database. */
export async function runGithubProvisionDryRun(
  input: GithubProvisionInput,
  dependencies: GithubProvisionDryRunDependencies = {
    whoami: productionGithubProvisionDependencies.whoami,
    checkScopes: productionGithubProvisionDependencies.checkScopes,
    checkPayload: checkDryRunPayload,
  },
): Promise<GithubProvisionResult> {
  const now = Date.now;
  const budget = { now, deadlineAt: now() + 60_000 };
  let owner = input.ownerForDryRun ?? "";
  if (input.pat) {
    const identity = await dependencies.whoami(input.pat, budget);
    owner = identity.login;
    await dependencies.checkScopes(identity.scopes);
  }

  const normalized = normalizeGithubProvisionInput({ ...input, pat: input.pat || "offline-dry-run" });
  const previewOnly = normalized.generatedRepo;
  if (previewOnly) {
    normalized.repo = "preview-only";
    normalized.workerId = normalized.repo;
  }
  if (!owner || reviewNormalizedProvisionIdentity(owner, normalized)) {
    throw new Error("The dry-run owner, repository, or workflow identity is invalid.");
  }

  const args = [
    path.join(import.meta.dirname, "newGithubKhoiloi.mjs"),
    "--dry-run",
    "--owner",
    owner,
    "--repo",
    normalized.repo,
    "--workflow-file",
    normalized.workflowFile,
  ];
  const ok = await dependencies.checkPayload(args);
  return ok
    ? {
      ok: true, stage: "complete", ...(!previewOnly ? { slug: `${owner}/${normalized.repo}` } : {}),
      message: `Dry-run payload check completed with daily limit ${normalized.dailyPushes}. ` +
        (previewOnly ? "preview-only is a payload placeholder; Ollama will choose the actual repository name only on live creation. " : "") +
        "No Ollama calls, GitHub changes, or database changes were made.", warnings: [],
    }
    : { ok: false, stage: "preflight", message: "Dry-run payload check failed. No GitHub or database changes were made.", warnings: [] };
}

const productionDependencies: GithubProvisionCliDependencies = {
  provision: input => provisionGithubStation(input, githubProvisioningDependenciesForPayloadSource("git-head")),
  dryRun: runGithubProvisionDryRun,
};

function printResult(result: GithubProvisionResult, io: GithubProvisionCliIo): void {
  const write = result.ok ? io.log : io.error;
  const slug = result.slug ? ` (${result.slug})` : "";
  write(`${result.ok ? "OK" : "FAILED"} [${result.stage}]${slug}: ${result.message}`);
  for (const warning of result.warnings) io.log(`WARNING: ${warning}`);
}

export async function runGithubProvisionCli(
  argv: string[],
  env: NodeJS.ProcessEnv = process.env,
  dependencies: GithubProvisionCliDependencies = productionDependencies,
  io: GithubProvisionCliIo = console,
): Promise<number> {
  const { input } = parseGithubProvisionArgs(argv, env);
  const result = input.dryRun ? await dependencies.dryRun(input) : await dependencies.provision(input);
  printResult(result, io);
  return result.ok && result.stage === "complete" ? 0 : 1;
}

async function main(): Promise<void> {
  loadEnv();
  try {
    process.exitCode = await runGithubProvisionCli(process.argv.slice(2));
  } catch (error) {
    console.error(`FAILED [preflight]: ${error instanceof Error ? error.message : "Invalid CLI input."}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
