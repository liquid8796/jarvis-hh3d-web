import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseBulkStopRounds, bulkStopMatches, MAX_STOP_ROUNDS } from "../src/lib/services/bulkStopJobs";
import { hasPermission } from "../src/lib/auth/permissions";

for (const invalid of [null,undefined,"","0","-1","1.1","1e3","0001"," 2 ","1000001","NaN",1,0,{},[]]) {
  assert.equal(parseBulkStopRounds(invalid), null, "Invalid threshold must be rejected: " + String(invalid));
}
for (const n of [1, 2, 10, 999, MAX_STOP_ROUNDS]) {
  assert.equal(parseBulkStopRounds(String(n)),n);
}
assert.equal(hasPermission({roles:["gia-chu"]},"job.force_stop"),true);
assert.equal(hasPermission({roles:["thai-thuong-truong-lao"]},"job.force_stop"),true);
assert.equal(hasPermission({roles:["chuong-mon"]},"job.force_stop"),false);
assert.equal(hasPermission({roles:["de-tu"]},"job.force_stop"),false);
for (const status of ["queued","running"]) {
  assert.equal(bulkStopMatches(status,10,10),true);
  assert.equal(bulkStopMatches(status,11,10),true);
  assert.equal(bulkStopMatches(status,9,10),false);
}
for (const status of ["stopping","stopped","done","failed"]) {
  assert.equal(bulkStopMatches(status,100,1),false);
}
const svc=readFileSync("src/lib/services/bulkStopJobs.ts","utf8");
const admin=readFileSync("src/app/actions/admin.ts","utf8");
const form=readFileSync("src/app/admin/GameDomainForm.tsx","utf8");
const ui=readFileSync("src/app/admin/BulkStopRoundsForm.tsx","utf8");
const page=readFileSync("src/app/admin/page.tsx","utf8");
assert.match(svc,/where status in \('queued', 'running'\) and attempts >= \$\{rounds\}/);
assert.match(svc,/when status = 'queued' then 'stopped'::job_status else 'stopping'::job_status end/);
assert.match(svc,/restart_after_stop = false/);
assert.match(svc,/insert into job_events \(job_id, level, message\)[\s\S]*from changed/);
assert.match(svc,/notifyDashboard\(\{ userId, topic: "job" \}\)/);
const action=admin.slice(admin.indexOf("export async function stopJobsByRoundsAction"),admin.indexOf("export async function saveDailyResetAction"));
assert.match(action,/await requireAdmin\(\)/);
assert.match(action,/hasPermission\(user, "job.force_stop"\)/);
assert.match(action,/parseBulkStopRounds\(formData.get\("rounds"\)\)/);
assert.match(action,/stopJobsByRoundThreshold\(rounds, user.displayName\)/);
assert.match(form,/<section className="card card-hairline p-6">[\s\S]*<form action=\{action\}>[\s\S]*<\/form>[\s\S]*<BulkStopRoundsForm \/>[\s\S]*<\/section>/);
assert.match(page,/canStopJobs=\{hasPermission\(viewer, "job.force_stop"\)\}/);
assert.match(ui,/window.confirm\(/);
assert.match(ui,/name="rounds"/);
assert.match(ui,/min=\{1\}/);
assert.match(ui,/role="status"/);
console.log("PASS: bulk stop threshold validation, scope, authority, atomic SQL, audit, UI confirmation");
