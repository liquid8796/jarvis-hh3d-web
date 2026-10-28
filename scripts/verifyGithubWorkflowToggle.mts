import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setGithubWorkflowEnabledManually } from "../src/lib/services/githubManualDispatch";
import { autoscaleEligibleStations, workerAutoscaleSchema, workerDrainIdsForSelection } from "../src/lib/validation/workerAutoscale";

const station = {
  owner:"testowner", repo:"testrepo", workflowFile:"worker.yaml",
  purpose:"worker" as const, enabled:true, primaryDeferred:false,
};
function client(state: string, http = 204) {
  const requests: Array<{path: string, method: string}> = [];
  const fetcher = async (url: RequestInfo | URL, opts?: RequestInit): Promise<Response> => {
    const path=String(url);
    const method=opts?.method ?? "GET";
    requests.push({path,method});
    assert.equal((opts?.headers as Record<string,string>).authorization, "Bearer TEST_PLACEHOLDER_ONLY");
    return method === "GET" ?
      new Response(JSON.stringify({state}),{status:200}) :
      new Response(null,{status:http});
  };
  return {fetcher:fetcher as typeof fetch, requests};
}
for(const mode of [false,true]) {
  const initial=mode?"disabled_manually":"active";
  const mock=client(initial);
  const output=await setGithubWorkflowEnabledManually(station,"TEST_PLACEHOLDER_ONLY",mode,mock.fetcher);
  assert.equal(output.ok,true);
  assert.equal(mock.requests.filter(r=>r.method==="PUT").length,1);
  assert.ok(mock.requests[1]?.path.endsWith(mode?"/enable":"/disable"));
  assert.doesNotMatch(JSON.stringify(output),/TEST_PLACEHOLDER_ONLY/);
  assert.equal(mock.requests.some(r=>/cancel|force-cancel/.test(r.path)),false,"must never cancel active runs");
}
{
 const mock=client("active");
 const output=await setGithubWorkflowEnabledManually(station,"TEST_PLACEHOLDER_ONLY",true,mock.fetcher);
 assert.equal(output.ok,true);
 assert.deepEqual(mock.requests.map(r=>r.method),["GET"],"idempotent enable");
}
{
 const mock=client("disabled_manually");
 const output=await setGithubWorkflowEnabledManually(station,"TEST_PLACEHOLDER_ONLY",false,mock.fetcher);
 assert.equal(output.ok,true);
 assert.deepEqual(mock.requests.map(r=>r.method),["GET"],"idempotent disable");
}
{
 const mock=client("active",403);
 const output=await setGithubWorkflowEnabledManually(station,"TEST_PLACEHOLDER_ONLY",false,mock.fetcher);
 assert.equal(output.ok,false);
 assert.match(output.message,/403/);
}
{
 const mock=client("unexpected");
 const output=await setGithubWorkflowEnabledManually(station,"TEST_PLACEHOLDER_ONLY",false,mock.fetcher);
 assert.equal(output.ok,false);
 assert.deepEqual(mock.requests.map(r=>r.method),["GET"]);
}
{
 const mock=client("active");
 const output=await setGithubWorkflowEnabledManually({...station,primaryDeferred:true},"TEST_PLACEHOLDER_ONLY",false,mock.fetcher);
 assert.equal(output.ok,false);
 assert.equal(mock.requests.length,0);
}
const settings=workerAutoscaleSchema.parse({manualDisabledSlugs:["testowner/testrepo"],minWorkers:2});
assert.deepEqual(settings.manualDisabledSlugs,["testowner/testrepo"]);
assert.deepEqual(autoscaleEligibleStations([{owner:"testowner",repo:"testrepo"},{owner:"other",repo:"worker"}],settings.manualDisabledSlugs),[{owner:"other",repo:"worker"}]);
assert.deepEqual(autoscaleEligibleStations([{owner:"testowner",repo:"testrepo"}],settings.manualDisabledSlugs),[],"manual pause overrides minWorkers");
assert.deepEqual(workerDrainIdsForSelection([{slug:"testowner/testrepo",workerId:"worker-a"},{slug:"other/worker",workerId:"worker-b"}],["other/worker"]),["worker-a"]);
const action=readFileSync("src/app/actions/githubStations.ts","utf8");
const ui=readFileSync("src/app/admin/GithubStationPanel.tsx","utf8");
const autoscale=readFileSync("src/lib/services/workerAutoscale.ts","utf8");
const route=readFileSync("src/app/api/worker/route.ts","utf8");
const jobs=readFileSync("src/lib/services/jobs.ts","utf8");
const settingsAction=readFileSync("src/app/actions/workerAutoscale.ts","utf8");
assert.match(action,/toggleGithubStationWorkflowAction[\s\S]*requireStationManage\(\)/);
assert.match(action,/toggleGithubStationWorkflowAction[\s\S]*acquireGithubAutoscaleLease/);
assert.match(action,/setGithubWorkflowEnabledManually\(station, pat, enable\)/);
assert.match(action,/current\.workerAutoscale\.manualDisabledSlugs = \[\.\.\.paused\]/);
assert.match(action,/current\.workerAutoscale\.drainingWorkerIds = \[\.\.\.draining\]/);
assert.match(ui, /Tắt workflow/);
assert.match(ui, /Bật workflow/);
assert.match(ui, /action=\{toggleAction\}/);
assert.match(autoscale,/autoscaleEligibleStations\(registered, config\.manualDisabledSlugs\)/);
assert.match(autoscale,/registered\.map\(s => \(\{ slug: stationSlug\(s\)/);
assert.doesNotMatch(route,/state\.enabled && isDrainingWorkerId/);
assert.doesNotMatch(jobs,/settings\.workerAutoscale\.enabled[\s\S]{0,60}isDrainingWorkerId/);
assert.match(settingsAction,/manualDisabledSlugs\.includes/);
console.log("PASS GitHub workflow toggle: permissions, GitHub API, manual pause, autoscaler and graceful drain");
