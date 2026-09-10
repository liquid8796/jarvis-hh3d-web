# GitHub Primary Repository Provisioning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the admin UI and Windows launcher create a complete primary GitHub worker repository through one owner-from-PAT provisioning service, with configurable/default repository name, workflow filename, and companion daily-push limit.

**Architecture:** A pure validator normalizes both entry points. A Node-only asynchronous service builds a byte-identical payload from either Git HEAD or the immutable deployed filesystem, uses GitHub/`gh` with injected adapters, registers the station atomically, and treats dispatch/ping/Ollama as recoverable post-registration work. Dynamic workflow filenames flow through creation and future deployments.

**Tech Stack:** Next.js 16 server actions, TypeScript/Node.js, Drizzle/PostgreSQL advisory locks, GitHub REST/CLI, existing `khoiloiPayload.mjs`, React 19, PowerShell/cmd batch launchers.

**Spec:** `docs/superpowers/specs/2026-09-10-github-primary-provisioning-design.md`

## Global Constraints

- Live owner identity comes only from authenticated GitHub `/user`; UI never accepts owner or worker ID.
- Existing repo `200` and every non-definitive state stop before mutation; only explicit `404` permits creation.
- Defaults are random repository name, `linh-su.yml`, and daily limit `5`; limits remain `0..24`.
- PAT stays out of argv/logs/database until successful registration; `WORKER_TOKEN` goes only to `gh secret set` stdin.
- UI/CLI use asynchronous child processes without a shell; no sync child or sleep runs in the Next process.
- Production payload construction works without `.git`; filesystem reads stay inside allowlisted release paths and reject symlinks.
- Custom workflow filenames are used by create, initial dispatch, status, restart, and all later deployments.
- `.bat` stays ASCII and CRLF.
- Preserve the unrelated untracked `force-github-khoiloi.bat --even-if-current.txt`.
- The complete feature is one release patch and one final commit because every pushed patch triggers all deployment targets.

---

### Task 1: Canonical input normalization

**Files:**
- Create: `src/lib/validation/githubProvisioning.ts`
- Create: `scripts/verifyGithubProvisioningInputs.mts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `DEFAULT_DAILY_PUSHES`, `MIN_DAILY_PUSHES`, `MAX_DAILY_PUSHES`, `DEFAULT_WORKFLOW_FILE`, `reviewStationIdentity`, and `randomSoftwareName` injected as `randomRepo`.
- Produces: `GithubProvisionInput`, `NormalizedGithubProvisionInput`, and `normalizeGithubProvisionInput(input, { randomRepo })`.

- [x] **Step 1: Write the failing pure input checks**

Create table-driven assertions equivalent to:

```ts
const defaults = normalizeGithubProvisionInput(
  { pat: "ghp_fixture_value", repo: "", workflowFile: "", dailyPushes: "" },
  { randomRepo: () => "amber-lake-0123456789abcdef" },
);
assert.deepEqual(defaults, {
  pat: "ghp_fixture_value",
  repo: "amber-lake-0123456789abcdef",
  workflowFile: "linh-su.yml",
  dailyPushes: 5,
  workerId: "amber-lake-0123456789abcdef",
  generatedRepo: true,
});
for (const good of ["0", "24"]) assert.doesNotThrow(() => normalize({ dailyPushes: good }));
for (const bad of ["-1", "25", "1.5", "five"]) assert.throws(() => normalize({ dailyPushes: bad }));
for (const bad of ["../x.yml", "dir/x.yml", "x.txt", ".yml"]) assert.throws(() => normalize({ workflowFile: bad }));
```

Also assert a supplied repo produces the same `workerId`, PAT whitespace fails, and `randomRepo` is called exactly once only for a blank repo.

- [x] **Step 2: Run the input verifier and observe the missing-module failure**

Run: `npx tsx scripts/verifyGithubProvisioningInputs.mts`

Expected: failure resolving `src/lib/validation/githubProvisioning.ts`.

- [x] **Step 3: Implement the pure normalizer**

Use these exact exported shapes:

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

Reject workflow path separators and require a safe `.yml`/`.yaml` basename. Validate owner/repo/workflow with `reviewStationIdentity` after the service resolves owner; expose `reviewNormalizedProvisionIdentity(owner, input)` for that second phase.

- [x] **Step 4: Run focused and TypeScript checks**

Run:

```powershell
npx tsx scripts/verifyGithubProvisioningInputs.mts
npx tsc --noEmit --incremental false --pretty false
```

Expected: all new input assertions and the app typecheck pass.

---

### Task 2: Gitless payload source and dynamic workflow filenames

**Files:**
- Modify: `scripts/khoiloiPayload.mjs`
- Modify: `scripts/buildWorkerBundle.mjs`
- Modify: `scripts/deployGithubKhoiloi.mts`
- Modify: `.gitignore`
- Modify: `scripts/verifyGithubDeploy.mts`
- Create: `scripts/verifyGithubProvisionPayload.mts`

**Interfaces:**
- Consumes: normalized `workflowFile`, current `COPIED_PATHS`, `WORKFLOW_TEMPLATE_PATH`, and one prebuilt minimal lockfile artifact.
- Produces: `workflowTargetPath(workflowFile)`, `gitHeadPayloadSource(repoRoot)`, `filesystemPayloadSource(repoRoot)`, and `buildKhoiloiPayload({ source, repoRoot, workerId, webUrl, workflowFile, lockfile })`.

- [x] **Step 1: Write failing payload tests**

Build a temporary fixture without `.git` and assert:

```ts
const payload = buildKhoiloiPayload({
  source: filesystemPayloadSource(fixtureRoot),
  repoRoot: fixtureRoot,
  workerId: "night-worker",
  webUrl: "https://backend.example.invalid",
  workflowFile: "nightly.yaml",
  lockfile: fixtureLock,
});
assert(payload.has(".github/workflows/nightly.yaml"));
assert(!payload.has(".github/workflows/linh-su.yml"));
```

Add cases proving symlinks/path escape fail, bytes remain unchanged, and a deploy payload for a station using `nightly.yaml` updates only that workflow path.

- [x] **Step 2: Run payload tests and observe the old fixed-path/git dependency failure**

Run: `npx tsx scripts/verifyGithubProvisionPayload.mts`

Expected: the old API cannot accept `source`/`workflowFile`, or the gitless fixture fails.

- [x] **Step 3: Add source adapters and dynamic workflow paths**

Keep `WORKFLOW_TARGET_PATH` as the default compatibility export, and add:

```js
export const workflowTargetPath = (workflowFile = "linh-su.yml") =>
  `.github/workflows/${workflowFile}`;
```

The filesystem adapter must use resolved paths, reject symbolic links, recursively sort files, and read only the exact `COPIED_PATHS`/template/package inputs. The Git adapter preserves `git show HEAD` behavior for CLI/deploy.

- [x] **Step 4: Generate a versioned minimal lockfile during prebuild**

Extend the existing prebuild flow to write a secret-free artifact under `public/linh-su/` containing the worker package version and generated minimal lockfile. Ignore the generated artifact in Git. The UI service later verifies its version equals the active release `package.json` before any GitHub call.

- [x] **Step 5: Make future deployment station-specific**

Change `payloadFor` to accept `workflowFile` and construct the dynamic workflow key for each station. Remove the global assertion that every station must equal `DEFAULT_WORKFLOW_FILE`; retain an assertion that the default maps to `.github/workflows/linh-su.yml`.

- [x] **Step 6: Verify payload and existing deployment behavior**

Run:

```powershell
npx tsx scripts/verifyGithubProvisionPayload.mts
npm run verify:github-deploy
npm run verify:github-bundle
npm run build
```

Expected: gitless/custom-workflow cases and all existing deployment checks pass.

---

### Task 3: Asynchronous shared provisioning service

**Files:**
- Create: `src/lib/services/githubProvisioning.ts`
- Create: `scripts/verifyGithubProvisioningLifecycle.mts`
- Modify: `src/lib/services/settings.ts`
- Modify: `src/lib/services/companionState.ts`

**Interfaces:**
- Consumes: Task 1 normalizer, Task 2 source adapters, `mutateGithubState`, `encryptSecret`, `pingStationBySlug`, and `runLlmCompanionNurture`.
- Produces: `GithubProvisionResult`, injectable `GithubProvisionDependencies`, and `provisionGithubStation(input, dependencies?)`.

- [x] **Step 1: Write a failing injected lifecycle harness**

Use fake GitHub/process/filesystem/database adapters and assert the ordered events:

```ts
assert.deepEqual(events, [
  "whoami", "scope", "local-preflight", "settings-check", "worker-check",
  "repo-404", "lease", "repo-404", "stage", "create", "push", "secret",
  "register", "dispatch", "ping", "nurture",
]);
```

Add failure cases for existing `200`, unknown repo state, create `422`, ambiguous create, push/secret failure, DB conflict, mismatched cleanup ID/HEAD, dispatch/ping/Ollama warnings, and double submission.

- [x] **Step 2: Run the lifecycle harness and observe the missing-service failure**

Run: `npx tsx scripts/verifyGithubProvisioningLifecycle.mts`

Expected: failure resolving `src/lib/services/githubProvisioning.ts`.

- [x] **Step 3: Implement the service with async adapters**

Export:

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
  dependencies: GithubProvisionDependencies = productionGithubProvisionDependencies,
): Promise<GithubProvisionResult>;
```

Use async `spawn`/`execFile` wrappers without `shell`. Cap stdout/stderr and convert them to fixed stage messages; never return raw output. Use a dedicated PostgreSQL client for `pg_try_advisory_lock(hashtext(slug))` and release it in `finally`, without an open transaction.

- [x] **Step 4: Implement preflight and exact fail-closed existence semantics**

Authenticate `/user`, inspect `X-OAuth-Scopes`, validate all local prerequisites, check settings/workers, and interpret only `404` as absent. Repeat collision and repo checks after acquiring the lease. Never retry the create command after an ambiguous response.

- [x] **Step 5: Implement confirmed-create rollback and durable registration**

Track `githubId` and `initialCommitSha` in memory and optional station schema fields:

```ts
provisionedBy: z.literal("jarvis").optional(),
githubId: z.number().int().positive().optional(),
initialCommitSha: z.string().max(100).optional(),
```

Rollback only if ID, initial HEAD, and settings references still match. After registration, dispatch/ping/nurture errors append warnings and return `ok: true, stage: "complete"`.

- [x] **Step 6: Verify lifecycle and concurrency behavior**

Run:

```powershell
npx tsx scripts/verifyGithubProvisioningLifecycle.mts
npm run verify:github-settings-merge
npm run verify:companion-lifecycle
npx tsc --noEmit --incremental false --pretty false
```

Expected: every injected failure leaves the exact tested state; app typecheck passes.

---

### Task 4: CLI and batch adapters

**Files:**
- Modify: `scripts/newGithubStation.mts`
- Modify: `scripts/newGithubKhoiloi.mjs` or remove its duplicate orchestration after callers migrate
- Modify: `new-github-khoiloi.bat`
- Modify: `scripts/verifyGithubBundleSafety.mjs`
- Create: `scripts/verifyGithubProvisionCli.mts`

**Interfaces:**
- Consumes: `provisionGithubStation` and its canonical result from Task 3.
- Produces: CLI flags `--repo`, `--workflow-file`, `--daily-pushes`, `--dry-run`; the batch prompt flow.

- [x] **Step 1: Write failing CLI/default/static batch checks**

Assert CLI parsing maps blank fields to Task 1 defaults, authenticated owner cannot be overridden, explicit repo becomes worker ID, and low-level dispatch uses the chosen workflow. Static BAT checks must find prompts for repository/workflow/daily limit, contain only ASCII, and prove Enter keeps `linh-su.yml`/`5` while blank repository omits `--repo`.

- [x] **Step 2: Run checks and observe missing flags/prompts**

Run:

```powershell
npx tsx scripts/verifyGithubProvisionCli.mts
npm run verify:bat-eol
```

Expected: new CLI/prompt assertions fail before implementation; existing EOL check remains green.

- [x] **Step 3: Convert the CLI into a thin service adapter**

Parse flags without mutating global PAT state, call the shared service, print safe stage/result messages, and set exit code `0` for complete (including warnings) or nonzero for failed/attention. Preserve `--owner` only for a PAT-less `--dry-run`; reject a mismatch when PAT is present.

- [x] **Step 4: Add safe BAT prompts**

Keep delayed expansion disabled. Read PAT through `Read-Host -AsSecureString`. Prompt for the three requested values; initialize workflow/daily defaults before `set /p`. Validate repo/workflow/daily through PowerShell reading environment variables before constructing the fixed npm command. Forward PAT through `vmRun --env GITHUB_PAT`; interpolate only already-whitelisted non-secret values.

- [x] **Step 5: Verify CLI and batch behavior**

Run:

```powershell
npx tsx scripts/verifyGithubProvisionCli.mts
npm run verify:github-bundle
npm run verify:bat-eol
npm run typecheck:scripts -- --pretty false
```

Expected: CLI, rollback, ASCII, CRLF, and scripts type checks pass.

---

### Task 5: Admin creation and edit flows

**Files:**
- Modify: `src/app/actions/githubStations.ts`
- Modify: `src/app/admin/GithubStationPanel.tsx`
- Modify: `src/app/admin/page.tsx` only if duration/render data changes
- Modify: `scripts/verifyGithubNurtureUi.mts`
- Create: `scripts/verifyGithubProvisionActions.mts`

**Interfaces:**
- Consumes: `provisionGithubStation`, `GithubProvisionResult`, immutable station slug, and existing `StationResult` rendering.
- Produces: `provisionGithubStationAction(previous, formData)` and `updateGithubStationAction(previous, formData)`.

- [x] **Step 1: Write server-action and UI fixture checks**

Mock the service and assert creation FormData has no `owner`/`workerId`, blank values reach the shared defaults, permissions are required, existing-repo failure renders its slug, and edit looks the row up by hidden slug. Add Playwright assertions for pending/success/warning/error states at 390 and 1366 pixels.

- [x] **Step 2: Verify the registration-only form is replaced**

Run:

```powershell
npx tsx scripts/verifyGithubProvisionActions.mts
npm run verify:github-nurture-ui
```

Expected: the old form still exposes owner/worker ID and calls registration instead of provisioning.

- [x] **Step 3: Split create and update actions**

`provisionGithubStationAction` accepts PAT/repo/workflow/daily values only and delegates all defaults/identity/mutation to the service. `updateGithubStationAction` takes a hidden slug, reloads the current row, validates any replacement PAT against the stored owner, preserves provisioning/runtime metadata, and never creates a repository.

- [x] **Step 4: Update the form**

Creation heading/button become “Tạo kho GitHub mới” and “Tạo repo + workflow”. Repository and workflow inputs are optional with explicit default hints; PAT remains required. Remove owner, worker ID, and manual companion-list inputs from creation. Editing displays the slug as text, keeps identity immutable, and sends only the hidden slug plus editable operational fields.

- [x] **Step 5: Verify UI and permissions**

Run:

```powershell
npx tsx scripts/verifyGithubProvisionActions.mts
npm run verify:github-nurture-ui
npm run verify:permissions
npx tsc --noEmit --incremental false --pretty false
```

Expected: all action, responsive UI, and permission checks pass.

---

### Task 6: Documentation, release checks, and one final release

**Files:**
- Modify: `deploy/github-actions.md`
- Modify: `README.md` if its launcher instructions expose old prompts
- Modify: `CHANGELOG.md`
- Modify: `src/lib/changelog.ts`
- Modify: `package.json`
- Modify: `package-lock.json`
- Update: this plan's checkboxes as tasks finish

**Interfaces:**
- Consumes: all completed tasks and `AGENTS.md` release workflow.
- Produces: version `1.3.72`, user-facing release note, committed/pushed source, and verified deployments.

- [x] **Step 1: Document exact UI/BAT behavior and recovery**

Document owner inference, the three defaults, classic PAT scopes, existing-repo refusal, custom workflow propagation, complete-with-warning semantics, and recovery for an `attention` result. Do not place endpoint or secret values in public examples.

- [x] **Step 2: Run the full relevant verification set**

Run:

```powershell
npm run verify:github-provisioning-inputs
npm run verify:github-provisioning-payload
npm run verify:github-provisioning-lifecycle
npm run verify:github-provisioning-cli
npm run verify:github-provisioning-bat
npm run verify:github-provisioning-runtime
npm run verify:github-provision-actions
npm run verify:github-deploy
npm run verify:github-bundle
npm run verify:github-stations
npm run verify:companion-lifecycle
npm run verify:bat-eol
npm run verify:permissions
npm run verify:changelog
npm run typecheck:scripts -- --pretty false
npx tsc --noEmit --incremental false --pretty false
npm run build
```

Expected: every command exits `0`.

- [x] **Step 3: Bump version and update changelogs**

Change package and root lock versions from `1.3.71` to `1.3.72`, prepend a user-facing release note within `MAX_NOTES`, and add the technical `CHANGELOG.md` entry. Re-run `verify:changelog` and build after the bump.

- [ ] **Step 4: Review and commit the complete patch**

Fetch `origin`, verify `HEAD...origin/master` has no unexpected remote commits, inspect the full diff, preserve unrelated files, then create one conventional commit:

```powershell
git commit -m "feat(github): provision primary repositories from admin"
git push origin master
```

- [ ] **Step 5: Deploy and verify all configured targets**

Run backend, all Vercel proxies, and registered GitHub worker deployment according to `AGENTS.md`. Install changed systemd units only if this patch changes them. Verify active version/health, each successful proxy, GitHub deployment summaries, and remote `master` SHA. If `auto-hh3d-4` remains fair-use blocked, report the exact external 402 blocker while retaining successful targets.
