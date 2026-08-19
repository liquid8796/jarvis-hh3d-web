#!/usr/bin/env node
/** Pure regression checks for the three-repository creation transaction. */
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  oauthScopesFromGhApiOutput,
  publishConfirmedRepository,
  repoProbeResultFromFailure,
  reviewBundlePatScopes,
} from "./githubBundleSafety.mjs";

let count = 0;
const check = (condition, message) => {
  count += 1;
  if (!condition) throw new Error(message);
  console.log(`✔ ${message}`);
};

const headers = "HTTP/2.0 200 OK\r\nX-OAuth-Scopes: repo, workflow, delete_repo\r\nContent-Type: application/json\r\n\r\n{}";
check(
  oauthScopesFromGhApiOutput(headers) === "repo, workflow, delete_repo",
  "scope parser reads case-insensitive gh --include headers",
);
check(oauthScopesFromGhApiOutput("{}") === null, "missing scope header remains unknown, never guessed as allowed");
check(reviewBundlePatScopes("repo, workflow, delete_repo").ok, "classic PAT with all three scopes can start a bundle");
check(
  !reviewBundlePatScopes("repo, workflow").ok && reviewBundlePatScopes("repo, workflow").missing.includes("delete_repo"),
  "PAT without delete_repo is rejected before mutation",
);
check(!reviewBundlePatScopes(null).ok, "fine-grained or opaque token is rejected when rollback cannot be proven");
check(!reviewBundlePatScopes("").ok, "empty classic scope header is rejected");
check(
  repoProbeResultFromFailure("GraphQL: Could not resolve to a Repository with the name 'owner/missing'.") === "no" &&
    repoProbeResultFromFailure("HTTP 404: Not Found") === "no",
  "only an explicit GitHub not-found response proves a repository is absent",
);
for (const failure of [
  "HTTP 401: Bad credentials",
  "HTTP 403: Resource not accessible by personal access token",
  "HTTP 503: Service unavailable",
  "spawn gh ENOENT",
]) {
  check(repoProbeResultFromFailure(failure) === "unknown", `${failure} leaves repository existence unknown`);
}

const repository = { slug: "owner/example" };
{
  const events = [];
  publishConfirmedRepository({
    repository,
    create: () => events.push("create"),
    remember: () => events.push("remember"),
    push: () => events.push("push"),
  });
  check(events.join(",") === "create,remember,push", "ownership is recorded only after create success and before push");
}

{
  const events = [];
  try {
    publishConfirmedRepository({
      repository,
      create: () => { events.push("create"); throw new Error("ambiguous network failure"); },
      remember: () => events.push("remember"),
      push: () => events.push("push"),
    });
  } catch {
    // Expected.
  }
  check(events.join(",") === "create", "ambiguous create failure is never remembered or pushed");
}

{
  const cleanupTargets = [];
  try {
    publishConfirmedRepository({
      repository,
      create: () => undefined,
      remember: (slug) => cleanupTargets.push(slug),
      push: () => { throw new Error("push failed"); },
    });
  } catch {
    // Expected.
  }
  check(
    cleanupTargets.join(",") === repository.slug,
    "push failure leaves a confirmed cleanup target because create already returned success",
  );
}

const repoRoot = path.join(import.meta.dirname, "..");
const creator = readFileSync(path.join(repoRoot, "scripts/newGithubKhoiloi.mjs"), "utf8");
check(
  !/\["repo",\s*"create"[^\]]*"--push"/s.test(creator),
  "repository create command cannot silently absorb push again",
);
check(
  !creator.includes('probeRepoExistence(repo.slug) === "yes"'),
  "creator contains no probe-then-delete ownership inference after create errors",
);
check(
  creator.includes("credential.https://github.com.helper=!gh auth git-credential") &&
    creator.includes('GIT_TERMINAL_PROMPT: "0"'),
  "split git push authenticates through gh without exposing PAT or opening an interactive prompt",
);
const rollbackCheckIndex = creator.indexOf("assertGhCanRollback();");
const stagingIndex = creator.indexOf("const stagingRoot = mkdtempSync");
check(
  rollbackCheckIndex >= 0 && stagingIndex >= 0 && rollbackCheckIndex < stagingIndex,
  "rollback permission preflight appears before staging and every GitHub mutation",
);

console.log(`\n✔ ${count} checks — bundle rollback ownership stays explicit.`);
