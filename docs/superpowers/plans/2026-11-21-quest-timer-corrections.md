# Quest timer correction implementation plan

## Goal
Always show 24-hour clocks and exempt admin owners and personal worker runs from Admin Quest windows while preserving personal timers.

## Ownership and progress
- [x] Confirm clean master 2740f43 (1.3.260), inspect timer controls and trusted worker/role boundaries; fetch origin (0/0 divergence).
- [x] Write scope amendment in docs/superpowers/specs/2026-11-21-quest-timer-corrections-design.md.
- [x] UI agent: shared 24-hour control; Admin Quest and Auto Scaling, Dashboard Auto seconds preservation; Chromium save/mobile checks.
- [x] Server agent: authoritative exempt policies, scoped legacy claim/activation handling, safe legacy demotion requeue and marked-wait reconsideration; focused regressions.
- [x] Runtime reviewer: independent read-only audit of per-job gates, role changes, lease metadata and stop precedence; review final diff.
- [x] Root: integrate, run focused regressions and application/scripts typechecks, validate changelogs and production build.
- [ ] Root: commit/push patch version 1.3.261; deploy backend and registered GitHub worker workflows; verify actual health/version/bundle and record exact rollout state.

## Constraints
Use explicit repo working directories without changing the selected Jarvis workspace. Shared file ownership is separated; root owns this record and version/changelogs. No live settings/game mutations for verification, no active work cancellation, no force push. No full engine smoke rerun absent a concrete new engine risk.

## Decisions
Native browser time input does not guarantee the requested display. Explicit digit controls preserve HH:mm data independently of locale. Authenticated personal scope and current admin roles provide exemptions; worker roster ownership is mutable and cannot prove a historical lease scope. A fresh empty policy preserves the existing freshness contract for exempt jobs. A private policy-requeue mark preserves explicit user-stop priority without changing other stop APIs.

## Verification record
- Fresh root run: model16, runtime12, API14, settings8 and job transitions12; actual en-US Chromium UI for all three timer panels; user timers; fishing access; account worker preferences; worker self-update51; changelog1214. All passed.
- App and scripts TypeScript checks and production build passed. Two UI fixture Window assertions required an explicit unknown cast; no runtime change.
- Independent review fixed a moving synthetic due timestamp that prevented home workers escaping old operator affinity. Stable last_heartbeat + 30 seconds now preserves dispatch grace. Review found no remaining material issue.
- The existing maintenance integration command reached an old Neon configuration lacking users.tag_expirations before changing maintenance. Its finally restored settings and a read-only check confirmed zero temporary users. The DB integration commands were rerun against disposable native PostgreSQL databases with isolated peer authentication and current migrations; no production configuration or database was used.
- Isolated native PostgreSQL: maintenance and worker-pref exited0. Continuous exposed an old fixture that asked a new worker to bypass the dispatcher affinity window; its final dirty-progress setup now ages the job beyond canonical TURN_GRACE_MS while preserving the assertion. The corrected continuous suite and scripts typecheck exited0. Both temporary databases/source directories were confirmed removed.
- Staged whitespace check passed and origin was re-fetched with 0/0 divergence before publication. Version1.3.261 is ready for the authorized release workflow.
