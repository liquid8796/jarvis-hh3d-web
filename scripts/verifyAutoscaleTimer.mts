import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const install = readFileSync("deploy/oracle/install-autoscale-timer.sh", "utf8");
const manual = readFileSync("deploy/oracle/README.md", "utf8");
const timer = install.split("<<'TIMER'")[1]?.split("\nTIMER")[0] ?? "";
const service = install.split("<<'SERVICE'")[1]?.split("\nSERVICE")[0] ?? "";

assert.match(timer, /^OnCalendar=\*-\*-\* \*:\*:00$/m, "every minute, not every 10 minutes");
assert.match(timer, /^AccuracySec=5s$/m);
assert.match(timer, /^Persistent=true$/m);
assert.match(timer, /^Unit=jarvis-autoscale.service$/m);
assert.match(service, /^Type=oneshot$/m);
assert.match(service, /^User=jarvis$/m);
assert.match(service, /^ExecStart=\/usr\/local\/libexec\/jarvis-autoscale-reconcile.sh$/m);
assert.match(install, /systemctl daemon-reload[\s\S]*systemctl enable --now jarvis-autoscale.timer[\s\S]*systemctl restart jarvis-autoscale.timer/);
assert.match(install, /curl --fail-with-body --silent --show-error --max-time 150/);
assert.match(install, /api\/cron\/autoscale/);
assert.match(manual, /jarvis-autoscale.timer.*mỗi 1 phút/);
assert.doesNotMatch(timer, /00\/10:00|OnUnitActiveSec=10m/);
console.log("PASS: OCI autoscaler checks every minute and rearms an already-running timer.");
