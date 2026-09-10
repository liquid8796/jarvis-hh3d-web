# GitHub Primary Repository Provisioning Design

## Goal

Make the admin GitHub form create a complete primary worker repository with the same behavior as `new-github-khoiloi.bat`, while keeping both entry points on one provisioning implementation. The PAT determines the GitHub account. A pre-existing or ambiguously reachable repository always stops the operation before any mutation.

## User-facing behavior

The create form contains four inputs:

- GitHub PAT, required and masked.
- Repository name, optional. Blank generates one random software name.
- Workflow filename, optional. Blank uses `linh-su.yml`.
- Daily push limit for each companion repository, optional. Blank uses `5`; accepted values are integers from `0` through `24`.

There is no GitHub account input. The server calls authenticated `GET /user` and uses the returned login as the repository owner. `WORKER_ID` equals the resolved repository name and is not an input.

Submitting a new form says that it will create a public repository. While provisioning, the button shows a pending state. Success reports the resulting `owner/repo`; a post-registration warning must still be presented as success so the user does not submit the same repository again.

Editing remains a separate operation. The page displays the immutable station slug as text and sends a hidden slug. It does not accept an owner or repository replacement. A replacement PAT must resolve to the stored owner. Repositories provisioned by this system also keep their workflow filename immutable, because changing a database string without renaming the remote workflow would leave duplicate or unmonitored schedules. Existing legacy registrations may retain the current workflow correction path.

The batch launcher prompts, in order, for the hidden PAT, repository name, workflow filename, and daily push limit. Pressing Enter applies the same defaults as the UI. It remains ASCII-only and CRLF. The launcher validates a strict character whitelist before interpolating non-secret values into `cmd.exe`; Node validation remains authoritative. The PAT continues through `vmRun --env GITHUB_PAT` and never appears in argv or command history.

## Shared input contract

Create `src/lib/validation/githubProvisioning.ts` with a pure normalizer shared by the server action and CLI:

```ts
export type GithubProvisionInput = {
  pat: string;
  repo?: string;
  workflowFile?: string;
  dailyPushes?: string | number;
  dryRun?: boolean;
  ownerForDryRun?: string;
};

export type NormalizedGithubProvisionInput = {
  pat: string;
  repo: string;
  workflowFile: string;
  dailyPushes: number;
  workerId: string;
  generatedRepo: boolean;
};
```

Normalization trims once and applies these rules:

- A live run requires a non-empty PAT without whitespace.
- A blank repository calls `randomSoftwareName()` exactly once.
- `workerId` is always the final repository name.
- Workflow is a basename ending in `.yml` or `.yaml`, at most 100 characters, with no slash, backslash, `.` or `..` segments.
- Daily pushes uses the existing `MIN_DAILY_PUSHES` and `MAX_DAILY_PUSHES` constants.
- `reviewStationIdentity` remains the common GitHub name validator.
- A live PAT identity always wins. `--owner` survives only for an offline dry run without a PAT; a supplied owner that disagrees with an authenticated PAT is rejected.

CLI flags are `--repo`, `--workflow-file`, `--daily-pushes`, `--dry-run`, plus the legacy dry-run-only `--owner` escape hatch.

## Provisioning architecture

Create `src/lib/services/githubProvisioning.ts` as a Node-only asynchronous orchestrator:

```ts
export type GithubProvisionResult = {
  ok: boolean;
  stage: "preflight" | "create" | "publish" | "secret" | "register" | "complete" | "attention";
  slug?: string;
  message: string;
  warnings: string[];
};

export async function provisionGithubStation(
  input: GithubProvisionInput,
  dependencies?: GithubProvisionDependencies,
): Promise<GithubProvisionResult>;
```

The implementation uses async child processes and async network calls. It must not call `execFileSync`, `spawnSync`, or `Atomics.wait` in the active Next.js process. Git, npm, and GitHub CLI work runs through argument arrays without a shell. PAT is supplied only through the child environment; `WORKER_TOKEN` is supplied only through stdin to `gh secret set`.

Both entry points use this function:

- `provisionGithubStationAction` checks `github_station.manage`, parses `FormData`, calls the service, and revalidates `/admin` plus the detail page on success.
- `scripts/newGithubStation.mts` becomes a thin CLI adapter that parses flags, renders progress/result text, and assigns the result exit code.

`updateGithubStationAction` remains separate and can never fall through into creation. The existing `saveGithubStationAction` is split or retained as a compatibility wrapper only if tests prove that an old client cannot invoke the create path accidentally.

## Source and workflow construction

Production releases are created with `git archive HEAD` and contain no `.git` directory. `khoiloiPayload.mjs` therefore gains an explicit source adapter:

```ts
export type PayloadSource = {
  read(path: string): Buffer;
  list(prefix: string): string[];
};

buildKhoiloiPayload({
  source,
  repoRoot,
  workerId,
  webUrl,
  workflowFile,
  lockfile,
});
```

The CLI/deploy adapter reads committed Git HEAD. The UI adapter reads the immutable deployed release filesystem. Filesystem reads stay under the allowlisted payload paths, reject symlinks and path escapes, and preserve bytes.

Generating the minimal worker lockfile can take up to three minutes today. A prebuild step generates a versioned, secret-free lockfile artifact for UI provisioning. The service verifies its package version before using it. GitHub endpoint values and the worker token are rendered or installed only at request time and are never written to this artifact.

Workflow naming is parameterized end to end:

- `workflowTargetPath(workflowFile)` returns `.github/workflows/${workflowFile}`.
- The initial payload contains exactly that workflow path, not an additional default workflow.
- Initial dispatch uses the same filename.
- The station stores the same filename.
- `deployGithubKhoiloi.mts` builds each station payload with `station.workflowFile`, and future status/restart calls use that same value.
- Managed-file planning does not delete unrelated workflows.

## Preflight and mutation sequence

All preflight checks complete before repository creation:

1. Normalize the input.
2. Call GitHub `/user`, infer the owner, and validate the login.
3. Require a classic PAT whose `X-OAuth-Scopes` proves `repo`, `workflow`, and `delete_repo`. An opaque/fine-grained token is rejected because rollback permission cannot be proven before creation.
4. Verify `WORKER_TOKEN`, `ENCRYPTION_KEY`, database access, GitHub CLI, planned CLI flags, the payload source, and the prebuilt lockfile artifact.
5. Check current settings and the workers table for case-insensitive repository and worker-ID collisions.
6. Query the target repository. `200` means “repo already exists” and performs zero mutations. Only an explicit `404` permits creation. Authentication, authorization, rate-limit, network, 5xx, or unparseable responses fail closed as “cannot determine whether the repo exists.”
7. Acquire a cross-process PostgreSQL advisory lease for the normalized slug using a dedicated session, without holding a database transaction open across network work. Recheck the database and GitHub target after acquiring it.
8. Fully stage and locally commit the payload in a guarded temporary directory.
9. Create and push the public repository. A repository becomes a cleanup target only after an unambiguous successful create response.
10. Set `WORKER_TOKEN` and persist the remote GitHub repository ID and initial commit SHA.
11. Register the station with `companionRepos: []`, `companionCountOverride: null`, the chosen daily limit, `enabled: true`, and `provisionedBy: "jarvis"`. Registration uses a fresh row lock through `mutateGithubState` and rechecks all names.
12. Dispatch the selected workflow, ping the station, and attempt one companion nurture step. These are post-registration warnings and never roll back a durable repository/station.

The service has a 240-second work budget inside the admin page's 300-second budget. Each network/child operation has its own smaller deadline. A browser disconnect does not grant permission to abandon or delete an ambiguous remote result; after reconnecting, the user reloads the station list to inspect any durable registration or attention state.

## Failure handling and rollback

Failures are classified for UI and CLI:

- `preflight`: no repository or database mutation occurred.
- `create`/`publish`/`secret` with successful rollback: the confirmed repository created by this attempt was removed and the operation can be retried.
- `attention`: creation or deletion had an ambiguous outcome, identity/HEAD no longer matches, or cleanup failed. The message names the slug and tells the operator not to retry the same name until it is inspected.
- `register`: the remote repository exists but registration could not be made durable. Rollback is allowed only when the GitHub repository ID still matches, the current HEAD is still the exact initial SHA, and no station references the slug. Otherwise it becomes `attention`.
- `complete` with warnings: repository, secret, and station are durable; dispatch, ping, or Ollama will retry naturally through schedule/admin controls.

Repository creation is never retried after an ambiguous response. Reads, blob uploads, secret setting, and explicit 404 workflow-index waits may retry transient failures within the deadline. Dispatch is not blindly retried after an ambiguous response because doing so may enqueue the workflow twice.

Cleanup checks the exact GitHub repository ID and HEAD before delete. A same-name replacement is never deleted. Temporary directory cleanup resolves the path and verifies its expected prefix under the system temp directory.

No raw GitHub response body, PAT, `WORKER_TOKEN`, child environment, stdout, or stderr is returned to the browser. UI messages are fixed stage-specific text with a safe slug. Server logs redact known tokens and remain bounded.

## Schema and compatibility

New station metadata is optional so old settings remain readable:

```ts
provisionedBy?: "jarvis";
githubId?: number;
initialCommitSha?: string;
```

Existing rows and companion state are preserved. Creation no longer accepts manually supplied companion repository names; Ollama reconciles the configured target after registration. Existing companion repositories remain managed on their detail pages.

Legacy callers of `saveGithubStationAction` cannot create a station without going through the new provisioning preflight. Existing edit requests resolve the row by immutable slug and preserve runtime fields.

## Test plan

All mutation tests use injected GitHub, process, filesystem, clock, and database adapters.

Pure/input tests cover blank defaults; explicit values; daily limits `0` and `24`; rejected negative, decimal, text, and `25`; owner inferred from PAT; repo-derived worker ID; workflow basename validation; and PAT whitespace.

Payload tests cover a gitless filesystem fixture; byte-preserving source reads; symlink/path rejection; a custom `nightly.yaml` appearing only at `.github/workflows/nightly.yaml`; initial dispatch using `nightly.yaml`; and later `github:deploy` updating that path without adding `linh-su.yml`.

Provisioning tests inject failure after every phase. They prove existing `200`, unknown target state, and create-time `422` cause no cleanup mutation; ambiguous create is never adopted/deleted; confirmed publish or secret failure rolls back only the matching ID/HEAD; registration conflicts preserve concurrent settings; and post-registration dispatch/ping/Ollama failures retain the repository and station.

Concurrency tests cover two browser submissions, two blue/green processes, an external repo appearing between probes, a station/companion collision during publish, and a same-name replacement before cleanup.

UI tests cover owner-field absence, defaults, pending/result states, immutable edit identity, permission checks, and 390/1366-pixel layouts. Batch tests assert all prompts/defaults, shell-safe whitelist behavior, ASCII content, and CRLF. Existing `verify:github-deploy`, `verify:github-bundle`, `verify:github-stations`, `verify:bat-eol`, app/script type checks, and the production build must pass.

## Release behavior

Implementation completion follows `AGENTS.md`: bump the patch version and changelogs, fetch and preserve remote work, commit and push `origin/master`, then deploy and verify backend, configured Vercel proxies, registered GitHub workers, and any changed systemd unit. A provider quota failure is reported as an external deployment blocker without force-pushing or rewriting successful targets.
