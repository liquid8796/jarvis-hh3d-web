import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { configSchema, enforceMazeCapPolicy } from "../src/lib/services/configs";

const root = path.join(import.meta.dirname, "..");
const read = (relative: string) => readFileSync(path.join(root, relative), "utf8");

const uncapped = configSchema.parse({
  quests: { meCung: { enabled: true, capCheck: false } },
});

assert.equal(
  enforceMazeCapPolicy(uncapped, { isAdmin: false, workerPref: "mine" }),
  uncapped,
  "regular users keep capCheck=false on their own local worker",
);
for (const workerPref of ["sect", "any"] as const) {
  const guarded = enforceMazeCapPolicy(uncapped, { isAdmin: false, workerPref });
  assert.equal(guarded.quests.meCung.capCheck, true, `${workerPref} must protect shared sect seats`);
  assert.notEqual(guarded, uncapped);
}
assert.equal(
  enforceMazeCapPolicy(uncapped, { isAdmin: true, workerPref: "sect" }),
  uncapped,
  "admins retain the existing override",
);

const provider = read("src/app/dashboard/DashboardLiveProvider.tsx");
const panel = read("src/app/dashboard/ControlPanel.tsx");
const form = read("src/app/dashboard/ConfigForm.tsx");
const action = read("src/app/actions/automation.ts");
const workerRoute = read("src/app/api/worker/route.ts");

assert.match(provider, /DashboardWorkerPrefContext/);
assert.match(provider, /useDashboardWorkerPref/);
assert.match(panel, /useDashboardWorkerPref\(\)/);
assert.match(form, /const capEditable = isAdmin \|\| workerPref === "mine"/);
assert.match(form, /máy nhà — có thể bỏ tick để đánh hết lượt/);
assert.match(form, /const effectiveCapCheck = capEditable \? capCheck : true/);
assert.match(form, /checked=\{effectiveCapCheck\}/);
assert.match(action, /getStoredConfigForSnapshot\(user\.id\)/);
assert.match(action, /workerPref: current\.workerPref/);
assert.match(workerRoute, /workerPref: "sect"/);

console.log("PASS: regular users can uncap Maze only on local workers; sect/any remain protected.");