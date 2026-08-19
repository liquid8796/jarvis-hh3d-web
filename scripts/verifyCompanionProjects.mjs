#!/usr/bin/env node
/** Verify the two ordinary software repositories produced with each GitHub worker bundle. */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  buildCompanionProjects,
  COMPANION_REPO_COUNT,
  REVISION_LEDGER_PATH,
} from "./companionProject.mjs";
import { renderReadme } from "./khoiloiPayload.mjs";

let count = 0;
const check = (condition, message) => {
  count += 1;
  if (!condition) throw new Error(message);
  console.log(`✔ ${message}`);
};

const names = ["amber-relay-0123456789abcdef", "cobalt-bridge-fedcba9876543210"];
const now = new Date("2026-08-19T06:30:00.000Z");
const projects = buildCompanionProjects({ repoNames: names, now });

check(projects.length === COMPANION_REPO_COUNT, "generator returns exactly two companion projects");
check(new Set(projects.map((project) => project.repoName)).size === 2, "companion repository names are distinct");
check(new Set(projects.map((project) => project.theme.id)).size === 2, "one bundle selects two different life domains");

const readmeIsEnglish = (source) => {
  const text = source.toString("utf8");
  // Catch Vietnamese diacritics without rejecting ordinary English punctuation such as an em dash.
  const decomposed = text.normalize("NFD");
  return !/[\u0300\u0301\u0302\u0303\u0306\u0309\u031b\u0323]|[đĐ]/.test(decomposed) &&
    !/\b(?:khôi lỗi|tông môn|tiến trình|kho phụ|dựng kho)\b/i.test(text);
};

for (const project of projects) {
  console.log(`\n${project.repoName} (${project.theme.product})`);
  check(project.files.size >= 14, `${project.repoName} has a multi-module source tree`);
  check(readmeIsEnglish(project.files.get("README.md")), `${project.repoName} README is English-only`);
  check(project.files.has(REVISION_LEDGER_PATH), `${project.repoName} contains the revision ledger`);

  const ledger = project.files.get(REVISION_LEDGER_PATH).toString("utf8");
  check(/export type RevisionLedger = Readonly</.test(ledger), `${project.repoName} exports the typed ledger contract`);
  check(/day: "",\s*\n\s*ordinal: 0,/.test(ledger), `${project.repoName} ledger starts at an empty day and ordinal zero`);
  check(
    /signals: \{ confidence: 0, coverage: 0, entropy: 0 \}/.test(ledger),
    `${project.repoName} ledger has the three scheduler signals`,
  );

  const main = project.files.get("src/main.ts").toString("utf8");
  check(
    main.includes('import { revisionLedger } from "./generated/revision-ledger"'),
    `${project.repoName} application imports the maintained ledger`,
  );
  check(
    main.includes("revisionLedger.ordinal") && main.includes("revisionLedger.day"),
    `${project.repoName} application renders ledger values instead of a dead import`,
  );

  const sourceLines = [...project.files]
    .filter(([file]) => /^(src|test)\/.+\.(ts|css)$/.test(file))
    .reduce((sum, [, bytes]) => sum + bytes.toString("utf8").split("\n").length, 0);
  check(sourceLines > 400, `${project.repoName} contains more than 400 source lines (${sourceLines})`);

  // Resolve every local import against the generated file map. This catches renamed/missing
  // modules without installing dependencies or trusting Vite to fail much later.
  const missing = [];
  for (const [file, bytes] of project.files) {
    if (!/\.ts$/.test(file)) continue;
    const source = bytes.toString("utf8");
    for (const match of source.matchAll(/(?:\bfrom\s+|\bimport\s+)["'](\.[^"']+)["']/g)) {
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), match[1]));
      const candidates = [target, `${target}.ts`, `${target}.css`, `${target}/index.ts`];
      if (!candidates.some((candidate) => project.files.has(candidate))) missing.push(`${file} -> ${match[1]}`);
    }
  }
  check(missing.length === 0, `${project.repoName} local imports resolve (${missing.join(", ") || "all found"})`);
}

const workerReadme = Buffer.from(renderReadme({
  workerId: "amber-relay-0123456789abcdef",
  webUrl: "https://example.invalid",
}));
check(readmeIsEnglish(workerReadme), "worker repository README is English-only too");

if (process.argv.includes("--build")) {
  const root = mkdtempSync(path.join(tmpdir(), "verify-companion-projects-"));
  try {
    for (const [index, project] of projects.entries()) {
      const cwd = path.join(root, `project-${index + 1}`);
      mkdirSync(cwd, { recursive: true });
      for (const [file, bytes] of project.files) {
        const full = path.join(cwd, file);
        mkdirSync(path.dirname(full), { recursive: true });
        writeFileSync(full, bytes);
      }
      console.log(`\nBuilding and testing ${project.repoName}…`);
      const run = (args) => execFileSync("npm", args, {
        cwd,
        encoding: "utf8",
        shell: process.platform === "win32",
        stdio: ["ignore", "pipe", "inherit"],
        timeout: 240_000,
      });
      run(["install", "--no-audit", "--no-fund"]);
      run(["run", "build"]);
      run(["test"]);
      check(true, `${project.repoName} installs, type-checks, builds, and passes domain tests`);
    }
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}

console.log(`\n✔ ${count} checks — companion project bundles are ready.`);
