# Admin Quest Scheduling Implementation Plan

> **For agentic workers:** execute the assigned ownership boundaries below; root integrates and reviews. Steps use checkboxes for progress.

**Goal:** administrators control daily quest availability, enforced even when a user enables auto.

**Architecture:** shared pure JavaScript policy, validated global JSONB branch, server-authoritative delivery and live worker gating, and a compact admin editor.

**Tech Stack:** existing Next.js 16, React 19, TypeScript, Zod, JavaScript worker, PostgreSQL/Drizzle.

**Spec:** docs/superpowers/specs/2026-11-21-admin-quest-schedules-design.md

## Global constraints
UTC+7 daily; start inclusive/end exclusive; overnight supported; equal times rejected; maximum eight windows and fifteen unique quests; no automatic enabling; no new dependency/table; preserve unrelated work and existing jobs; follow AGENTS release instructions.

## Review focus
- Closing while waiting for a quest slot or running a long repeat stops only that quest.
- Old or disconnected workers cannot retain an unlimited policy snapshot.
- Restricted quests are not marked daily-complete or held past next opening.
- Unprivileged callers and forged per-user settings cannot set global policy.
- Concurrent settings writers do not silently undo the admin schedule.

### Task 1: Shared model and settings (root)
Files: src/lib/quest-engine/questSchedules.mjs; src/lib/validation/questSchedules.ts; src/lib/services/settings.ts; scripts/verifyQuestSchedules.mts.
- [x] Add failing behavior tests for empty settings, window boundaries, overnight, variants, invalid input, disabled user choices and next opening.
- [x] Implement catalog, questScheduleState, applyQuestScheduleGates, secondsUntilNextQuestSchedule and live gate API. Add schema/parser and atomic saveQuestSchedules; protect concurrent whole-document writes.
- [x] Run offline model/settings tests until green.

### Task 2: Admin editor (quest_admin_audit)
Files: src/app/admin/QuestScheduleForm.tsx; src/app/actions/questSchedules.ts; src/app/admin/page.tsx; scripts/verifyQuestScheduleUi.mts.
Consumes QUEST_SCHEDULE_OPTIONS, MAX_QUEST_SCHEDULE_WINDOWS, QuestScheduleRule, parseQuestSchedules, saveQuestSchedules.
- [x] Verify meaningful admin interactions on the actual component with controlled server dependencies.
- [x] Add Quest tab and accessible editor with pending/invalid/success states; guarded branch save action.
- [x] Run browser checks at desktop/mobile widths without live database writes.

### Task 3: Runtime enforcement (quest_runtime_audit)
Files: worker API, worker protocol, runCycle, engine and focused runtime regressions as identified in audit.
Consumes shared schedule policy. Keep global schedule separate from untrusted user configuration.
- [x] Add failing integration regressions for claim enforcement, closure after waiting, closure in active quest, live policy updates, preserving other quests, and next-opening wake.
- [x] Implement authoritative policy delivery, freshness/legacy handling and scoped safe-point stops.
- [x] Run focused and existing related offline engine/protocol tests.

### Task 4: Integrate and release (root)
- [x] Review diff and independent code review; resolve material findings.
- [x] Run application/scripts typechecks, relevant offline regression checks and production build.
- [ ] Bump patch version and both changelogs with <=50 UI notes; fetch/reconcile origin; normal commit/push.
- [ ] Deploy backend and registered worker repositories without canceling active work; verify live version/health and report exact blockers.

## Execution record
2026-11-21: source master clean at dafb20f, version 1.3.259; task authorized by user and existing AGENTS release policy. Existing clean checkout retained for the established release workflow. Independent agents own separate files; root owns shared interfaces and integration.

## Review decisions and verification
- Shared model: 16 behavior groups passed, including default legacy configuration, all 29 concrete quest variants, midnight/overlapping windows, monotonic clock, network uncertainty and freshness.
- Admin editor: real Chromium fixture passed authorization, invalid input, draft retention, pending lock, successful save and safe rollout/storage errors.
- Settings and server: seven storage cases, nine API cases, and six transition cases passed offline against real Drizzle SQL generation.
- Independent review identified mixed-quest wake metadata loss and daily-reset starvation; both require regressions and are fixed before release. A fixed heartbeat deadline shortening a healthy click was corrected with a failing-then-passing regression; the runtime suite now has 12 passing cases.
- Ruling: previously deployed private executables cannot be retroactively constrained while disconnected. Preserve active work and explicitly document retirement/update requirement; inspect live versions during release instead of adding a permanent block based on historical failures.
- Deferred existing availability risk: a post-claim DB failure can still orphan a lease, as before this feature; no broad worker-transaction refactor is included.

- Final visual QA at 1440px and 390px used the app CSS: selected Quest tab is visible, standard input borders render, native time glyphs fit, and no document/control overflow occurs.
- Final release checks: verify:quest-schedules (16 model groups, 12 runtime cases, 9 API cases, 7 settings cases, 6 job transitions), Chromium UI checks, application/scripts typechecks, changelog validation and production build passed. Existing related timer, fishing, self-update, version, bundle, daily-mark, Bi Canh, challenge and Turnstile checks also passed.
- Extended smoke verification: the original whole invocation reached its 900-second limit with 378 passes and 11 obsolete baseline assertions. Corrected only fixtures/assertions to match existing HEAD quest order/schema, check-in receipts and Bi Canh behavior. Original selected Chromium groups then passed 317/317; the continuation completed Luyen Dan and all remaining groups, revealing two additional obsolete lane/ledger assertions, whose corrected blocks passed 290/290 with shared setup. Counts overlap; no full-suite exit-zero claim is made. All remaining groups and repaired assertions are covered.
- Release prepared as 1.3.260; origin fetched and HEAD...origin/master reported 0/0 divergence before commit. Deployment status is recorded in the session after publication.
