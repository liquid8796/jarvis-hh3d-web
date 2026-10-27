import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { workerDrainIdsForSelection, isDrainingWorkerId } from "../src/lib/validation/workerAutoscale";

const stations = [
  { slug: "x/one", workerId: "gha-one" },
  { slug: "x/two", workerId: "gha-two" },
  { slug: "x/three", workerId: "gha-three" },
];
assert.deepEqual(workerDrainIdsForSelection(stations, ["x/one"]), ["gha-two", "gha-three"]);
assert.deepEqual(workerDrainIdsForSelection(stations, ["x/one", "x/two", "x/three"]), []);
assert.equal(isDrainingWorkerId(["gha-three"], "gha-three"), true);
assert.equal(isDrainingWorkerId(["gha-three"], "private-worker"), false);
assert.throws(() => workerDrainIdsForSelection([{slug:"x/a",workerId:"shared"},{slug:"x/b",workerId:"shared"}], ["x/a"]), /duplicate|trùng/i);
assert.throws(() => workerDrainIdsForSelection([{slug:"x/a",workerId:""}], []), /missing|thiếu/i);

const worker = readFileSync("scripts/worker.mjs", "utf8");
const endpoint = readFileSync("src/app/api/worker/route.ts", "utf8");
const dispatcher = readFileSync("src/lib/services/jobs.ts", "utf8");
const autoscale = readFileSync("src/lib/services/workerAutoscale.ts", "utf8");
assert.match(worker, /\bdrain\b/);
assert.match(worker, /beginDrain\(/);
assert.match(endpoint, /drain: true/);
assert.match(dispatcher, /isDrainingWorkerId/);
assert.match(autoscale, /workerDrainIdsForSelection/);
console.log("PASS graceful scale-in identity/dispatch/runtime protocol");
