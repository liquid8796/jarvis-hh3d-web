# Quest timer 24-hour controls and exemptions

## User correction (2026-11-21)
The user requests 24-hour timer displays in Admin Quest and Auto, and exemption from the administrator quest schedule for admin accounts and ordinary users running personal/home workers. This amendment replaces the original global-to-everyone scope in the 1.3.260 design.

## Implementation decisions
- Reuse the existing React forms and HH:mm storage. Replace locale-dependent native time controls with explicit zero-padded hour 00-23 and minute 00-59 selects, including Admin Auto Scaling. Preserve Dashboard Auto's second precision and personal timer behavior.
- The authoritative restriction applies only to an authenticated operator worker serving an owner who currently lacks admin.panel permission. All roles recognized by isAdminUser/ADMIN_ROLE_CODES are admin for this purpose. An authenticated personal worker is exempt for its own jobs.
- Claim and heartbeat deliver a fresh empty policy for exempt jobs, never a missing policy. Ordinary operator jobs retain the existing time windows and 20-second policy freshness bound. Keep job gates isolated.
- Determine exemption from server authentication and current database roles, never workerPref, user settings, arbitrary request role fields or mutable worker roster ownership.
- Store actual scope in server-owned lease metadata at claim. Strip all reserved metadata whenever untrusted configs or previous snapshots are copied. Old unsupported unmarked leases drain once; current capable leases remain compatible.
- Legacy operator candidates must be filtered before limits and rechecked under the existing shared policy lock in final claim. Current admin candidates and authenticated personal requests remain eligible under active schedules.
- A legacy operator lease whose owner loses admin permission under active schedules receives a cooperative stop through heartbeat, with a private per-lease requeue marker. Completion requeues only while the database status remains running; an explicit user stop wins. Do not reuse or change daily-reset restart_after_stop behavior.
- Previously schedule-held jobs may be reconsidered for an exempt candidate after the normal 30-second floor. Preserve ordinary cooldowns, personal timers, user enable switches, daily quota and fishing access.
- Admin form copy states the scope. No dependency, table or arbitrary live schedule is added.

## Verification and release
Use Chromium under en-US at desktop/mobile widths for actual form save paths and preserved seconds. Extend existing offline API, storage and job-transition tests for the role/scope matrix, forged metadata, legacy claims, activation and explicit-stop races. Run focused suites, both TypeScript checks, changelog validation, production build and independent review. Release normally per AGENTS.md without cancelling active work.
