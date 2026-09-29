import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.join(import.meta.dirname, "..");
const read = (relative: string) => readFileSync(path.join(root, relative), "utf8");

const batchBytes = readFileSync(path.join(root, "promote-github-primary.bat"));
const batch = batchBytes.toString("ascii");
const cli = read("scripts/promoteGithubPrimary.mts");
const service = read("src/lib/services/githubPrimaryPromotion.ts");
const action = read("src/app/actions/githubNurture.ts");
const ui = read("src/app/admin/github/[owner]/[repo]/GithubCompanionDetail.tsx");

assert.ok([...batchBytes].every(byte => byte < 128), "portable BAT must remain ASCII-only");
assert.equal(batch.replace(/\r\n/g, "").includes("\n"), false, "portable BAT must use CRLF on Windows");
assert.match(batch, /--station/);
assert.match(batch, /--repo/);
assert.match(batch, /--visibility/);
assert.match(batch, /keep\^\|public\^\|private|keep\/public\/private/);
assert.match(batch, /--ssh-key/);
assert.match(batch, /--host/);
assert.match(batch, /--dry-run/);
assert.match(batch, /--yes/);
assert.match(batch, /\/opt\/jarvis\/ops-repo/);
assert.match(batch, /\/opt\/jarvis\/shared\/\.env/);
assert.match(batch, /git pull --ff-only -q \|\| exit 1/);
assert.match(batch, /npm run github:promote/);
assert.doesNotMatch(batch, /cd \/d "%~dp0"/i, "portable BAT must not depend on its own folder");
assert.doesNotMatch(batch, /npm run vm/i, "portable BAT must connect to OCI directly");

assert.match(cli, /previewGithubCompanionPromotion/);
assert.match(cli, /promoteGithubCompanionToPrimary/);
assert.match(cli, /--station/);
assert.match(cli, /--visibility/);
assert.match(cli, /source dự án\s+: GIỮ NGUYÊN/);
assert.match(cli, /--dry-run: chưa thay đổi GitHub hoặc sổ station/);

assert.match(service, /GITHUB_REPOSITORY_VISIBILITIES = \["keep", "public", "private"\]/);
assert.match(service, /setVisibility\(owner: string, repo: string/);
assert.match(service, /repository-visibility-not-verified/);
assert.match(service, /targetVisibilityChanged && targetOriginalVisibility/);
assert.match(service, /previewGithubCompanionPromotion/);
assert.match(action, /parseGithubRepositoryVisibility\(formData\.get\("visibility"\)/);
assert.match(action, /promoteGithubCompanionToPrimary\(slug, repo, \{ visibility \}\)/);
assert.match(ui, /name="visibility"/);
assert.match(ui, /value="keep"/);
assert.match(ui, /value="public"/);
assert.match(ui, /value="private"/);
assert.match(ui, /Repo được promote sẽ chuyển sang private/);

console.log("PASS: portable promotion BAT, OCI CLI, web UI visibility, and rollback contract are wired together.");
