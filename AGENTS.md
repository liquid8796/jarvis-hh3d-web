# Release workflow

The user has authorized this workflow after every completed patch in this repository:

1. Run the checks relevant to the change, including application/scripts type checks and the production build. Fix failures before release.
2. Bump the patch version in `package.json` and the root entries of `package-lock.json`, and update both changelogs. Keep the user-facing release notes within `MAX_NOTES`; older history remains in `CHANGELOG.md` and Git. The backend refuses redeploying the current version by default.
3. Fetch `origin`, preserve remote work and unrelated local files, commit the requested changes, and push normally to `origin/master`. Do not force-push or ask again for routine release approval.
4. Deploy every configured application target: backend (`npm run deploy:backend`), Vercel proxies (`npm run deploy:proxy`), and registered GitHub worker repositories (`npm run vm -- npm run github:deploy`). `deploy:all` currently covers only the backend.
5. Install/reload changed systemd units using the active release, following `deploy/oracle/README.md`. Verify the deployed version, application health, proxy results, GitHub deployment results, and changed timer state.

Do not publish credentials or cancel active work to force a deployment. If a deployment fails, diagnose it, apply a safe fix when possible, and report the exact remaining blocker. Do not claim all targets deployed unless they were verified.
