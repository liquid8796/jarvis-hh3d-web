import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  activeManualWorkflowHolds,
  chooseWorkflowTransitions,
  chooseWorkflowTransitionsWithPriority,
  workerAutoscaleSchema,
  autoscaleEligibleStations,
} from "../src/lib/validation/workerAutoscale";
import { setGithubWorkflowEnabledManually } from "../src/lib/services/githubManualDispatch";

const now=Date.parse("2026-10-28T03:20:00.000Z");
const holds=workerAutoscaleSchema.parse({manualRunHoldUntil:{
  "alpha/worker":new Date(now+6*60*60_000).toISOString(),
  "beta/worker":new Date(now-1000).toISOString(),
}}).manualRunHoldUntil;
assert.deepEqual(activeManualWorkflowHolds(holds,now),["alpha/worker"]);
assert.deepEqual(activeManualWorkflowHolds({"alpha/worker":"invalid"},now),[]);

const active=["a/runner","b/runner"];
const inactive=["c/runner","d/runner"];
assert.deepEqual(chooseWorkflowTransitionsWithPriority(active,inactive,3,["c/runner"]),{
 selected:["c/runner","a/runner","b/runner"],enable:["c/runner"],disable:[],
},"manual run must not sacrifice existing scheduled workers");
assert.deepEqual(chooseWorkflowTransitionsWithPriority(active,inactive,2,["a/runner"]),{
 selected:["a/runner","b/runner"],enable:[],disable:[],
},"already-selected priority must not generate an extra worker");
assert.deepEqual(chooseWorkflowTransitionsWithPriority(active,inactive,2,["c/runner"]),{
 selected:["c/runner","a/runner"],enable:["c/runner"],disable:["b/runner"],
},"priority honored at fixed target");
assert.deepEqual(chooseWorkflowTransitionsWithPriority(active,inactive,3,["absent/repo"]),{
 selected:["a/runner","b/runner","c/runner"],enable:["c/runner"],disable:[],
},"unknown priority never dispatched");

const all=[{owner:"a",repo:"runner"},{owner:"b",repo:"runner"},{owner:"c",repo:"runner"}];
assert.deepEqual(autoscaleEligibleStations(all,["c/runner"]),all.slice(0,2),"user pause is not a priority override");

const station={owner:"example",repo:"fixture",workflowFile:"worker.yml",
 purpose:"worker" as const,enabled:true,primaryDeferred:false};
const calls:string[]=[];
const fakeFetch=(async (input:RequestInfo|URL,opts?:RequestInit)=>{
 const url=String(input);
 calls.push((opts?.method||"GET")+" "+url);
 if(opts?.method==="PUT") return new Response(null,{status:204});
 return new Response(JSON.stringify({state:"disabled_manually"}),{status:200});
}) as typeof fetch;
const enabled=await setGithubWorkflowEnabledManually(station,"DUMMY_TEST_TOKEN",true,fakeFetch);
assert.equal(enabled.ok,true);
assert.ok(calls.some(url=>url.endsWith("/enable")),"disabled workflow can be enabled");

const ui=readFileSync("src/app/admin/GithubStationPanel.tsx","utf8");
const actions=readFileSync("src/app/actions/githubStations.ts","utf8");
const auto=readFileSync("src/lib/services/workerAutoscale.ts","utf8");
assert.ok(ui.includes('"Bật & chạy"'),"render one-click Run even on scheduler-disabled workflow");
const runDisabled=ui.match(/disabled=\{running \|\| deleting[^\n]+\}/)?.[0]??"";
assert.ok(runDisabled.includes("station.manuallyPaused"),"explicit pause remains blocked");
assert.ok(!runDisabled.includes('workflowState.startsWith'),"scheduler-disabled workflows may be run manually");
assert.match(ui,/station\.manuallyPaused \|\| station\.workflowState\.startsWith\("disabled_"\) \? "enable" : "disable"/,
 "toggle must display enable for scheduler-disabled station");
const body=actions.slice(actions.indexOf("export async function runGithubStationWorkflowAction"),
 actions.indexOf("export async function toggleGithubStationWorkflowAction"));
assert.ok(body.indexOf("acquireGithubAutoscaleLease")>=0);
assert.ok(body.indexOf("setGithubWorkflowEnabledManually") < body.indexOf("dispatchGithubWorkflowManually"),"enable before dispatch");
assert.ok(body.includes("manualDisabledSlugs.includes(slug)"),"explicit user pause takes precedence");
assert.ok(body.includes("manualRunHoldUntil[slug]"),"persist manual dispatch priority");
assert.ok(body.includes("drainingWorkerIds.filter"),"manual run removes drain flag");
assert.ok(auto.includes("activeManualWorkflowHolds(config.manualRunHoldUntil"));
assert.ok(auto.includes("const extra = priority.filter(slug => !baseline.includes(slug)).length"));
console.log("PASS: scheduler-disabled workflow can be enabled and run, manual holds do not overprovision, paused workflows remain protected");
