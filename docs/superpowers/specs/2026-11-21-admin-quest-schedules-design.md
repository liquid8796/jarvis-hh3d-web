# Admin quest availability windows

## Intent
Add a Quest tab to /admin. Administrators define daily allowed windows per logical quest; a user's enabled quest cannot bypass this global policy.

## Decisions
- Use the existing Next/React admin, JSONB app_settings, and JavaScript worker engine. No new database table/dependency.
- Persist questSchedules as [{questKey, enabled, windows:[{start,end}]}]. Times are HH:MM in Asia/Ho_Chi_Minh (UTC+7). Start inclusive, end exclusive. End before start crosses midnight; equal endpoints are rejected. Up to eight windows per quest and one rule for each of the 15 logical quests.
- Missing/disabled rule means unrestricted by this feature. Defaults remain empty so deployment does not change existing automation. The rule covers VIP/free variants together, including fishing and secret realm.
- Global availability and user choices intersect: opening never enables a user's disabled quest. User timers, access limits, and daily quotas still apply.
- Server injects authoritative policy for every operator/personal worker. Recheck policy/time after queue waits and throughout interpreter safe points; closing a quest is a skip, never a stop for the whole auto job or a daily quota mark. Refresh policy through worker heartbeat, and bound stale policy use.
- Queue the next opening without falsely marking blocked quests completed for the day. Already-running external browser commands cannot be undone; stop at the next existing safe checkpoint.
- Save only the settings branch atomically. General settings saves preserve concurrent schedule updates. Admin authentication precedes parse/write.

## Approaches considered
A UI-only schedule cannot enforce the requested restriction. Claim-time-only filtering can run a quest after the window closes while a worker waits or loops. Shared server/worker policy with live safe-point gating handles both cases, and is selected for implementation.

## Validation
Offline model/schema boundary tests, actual interpreter/worker integration tests with controlled HTTP/time, admin browser interactions on fixtures (no live settings changes), related regression commands, both TypeScript checks, production build, code review, then normal release/deployment per AGENTS.md.

## Operational limits and rollout
A policy edit reaches an active supported worker at the next heartbeat (normally five seconds); known clock boundaries remain locally enforced, and a policy snapshot expires after twenty seconds without refresh. An action already dispatched to the game cannot be undone.

The activation guard rejects known running/stopping legacy leases. A previously shipped private worker that has lost control-plane connectivity may continue playing even after the server reaps its database lease; the upgraded server cannot retroactively add the new expiry guard to that executable. Before relying on first activation, legacy private processes must finish and update or be retired. Release never cancels their work.

The normal deployment publishes the backend and registered GitHub worker payloads, including the downloadable personal-worker bundle. Personal processes update through their existing updater and may remain on an older version until their current work drains.
