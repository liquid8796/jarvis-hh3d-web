import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dispatchGithubWorkflowManually } from "../src/lib/services/githubManualDispatch";

const station = {
  owner: "fixture-owner", repo: "fixture-repository",
  workflowFile: "custom-worker.yml", purpose: "worker" as const,
  enabled: true, primaryDeferred: false,
};
const now = Date.parse("2026-10-28T02:00:00.000Z");
const stale = { id: 44551, status: "queued", event: "workflow_dispatch", created_at: "2026-10-27T13:00:00.000Z" };
function client(runs: typeof stale[], state="active", status=204, visible=true) {
  const calls: Array<{method:string; path:string; body?:string}> = [];
  function fetcher(input: RequestInfo | URL, options?: RequestInit): Promise<Response> {
    const path = String(input);
    const method = options?.method ?? "GET";
    calls.push({method,path,body:options?.body?.toString()});
    assert.equal((options?.headers as Record<string,string>)?.authorization, "Bearer FAKE_PAT_ONLY", "token used only in server requests");
    const runList = path.includes("/runs?per_page=10");
    const isDispatch = method === "POST";
    const responseBody = path.includes("/actions/workflows/") && !runList && !isDispatch
      ? { state } : runList
        ? { workflow_runs: isDispatchVisible() ? [{ id: 44552, status: "queued", event: "workflow_dispatch", created_at: "2026-10-28T02:00:01.000Z" }, ...runs] : runs }
        : { default_branch: "main" };
    function isDispatchVisible() { return visible && calls.some(call => call.method==="POST"); }
    return Promise.resolve(new Response(isDispatch ? null : JSON.stringify(responseBody),
      {status: isDispatch?status:200}));
  }
  return { fetcher: fetcher as typeof fetch, calls };
}
{
  const mock = client([stale]);
  const result = await dispatchGithubWorkflowManually(station,"FAKE_PAT_ONLY",
    {fetcher:mock.fetcher,now:()=>now,wait:async()=>{}});
  assert.equal(result.ok,true);
  assert.equal(result.runId,44552);
  assert.match(result.runUrl??"",/actions\/runs\/44552$/);
  assert.equal(mock.calls.filter(c=>c.method==="POST").length,1,"old queued run must not block dispatch");
  assert.equal(mock.calls.find(c=>c.method==="POST")?.body,JSON.stringify({ref:"main"}));
  assert.doesNotMatch(JSON.stringify(result),/FAKE_PAT_ONLY/);
}
{
  const mock=client([{...stale,status:"in_progress"}]);
  const result=await dispatchGithubWorkflowManually(station,"FAKE_PAT_ONLY",
    {fetcher:mock.fetcher,now:()=>now,wait:async()=>{}});
  assert.equal(result.ok,false);
  assert.equal(mock.calls.some(c=>c.method==="POST"),false,"never double-dispatch an active runner");
}
{
  const mock=client([{...stale,created_at:"2026-10-28T01:59:40.000Z"}]);
  const result=await dispatchGithubWorkflowManually(station,"FAKE_PAT_ONLY",
    {fetcher:mock.fetcher,now:()=>now,wait:async()=>{}});
  assert.equal(result.ok,false);
  assert.equal(mock.calls.some(c=>c.method==="POST"),false,"60-second retry suppression");
}
{
  const mock=client([stale],"disabled_manually");
  const result=await dispatchGithubWorkflowManually(station,"FAKE_PAT_ONLY",
    {fetcher:mock.fetcher,now:()=>now,wait:async()=>{}});
  assert.equal(result.ok,false);
  assert.equal(mock.calls.some(c=>c.method==="POST"),false);
}
{
  const mock=client([stale],"active",403);
  const result=await dispatchGithubWorkflowManually(station,"FAKE_PAT_ONLY",
    {fetcher:mock.fetcher,now:()=>now,wait:async()=>{}});
  assert.equal(result.ok,false);
  assert.match(result.message,/403/);
}
{
  const mock=client([stale],"active",204,false);
  const result=await dispatchGithubWorkflowManually(station,"FAKE_PAT_ONLY",
    {fetcher:mock.fetcher,now:()=>now,wait:async()=>{}});
  assert.equal(result.ok,true);
  assert.equal(result.runId,undefined,"never invent a run ID when GitHub has not indexed the run");
  assert.match(result.runUrl??"",/actions\/workflows\/custom-worker.yml$/);
}
{
  const mock=client([stale]);
  const result=await dispatchGithubWorkflowManually({...station,primaryDeferred:true},"FAKE_PAT_ONLY",
    {fetcher:mock.fetcher});
  assert.equal(result.ok,false);
  assert.equal(mock.calls.length,0);
}
const action = readFileSync("src/app/actions/githubStations.ts","utf8");
const ui = readFileSync("src/app/admin/GithubStationPanel.tsx","utf8");
assert.match(action,/runGithubStationWorkflowAction[\s\S]*await requireStationManage\(\)/);
assert.match(action,/runGithubStationWorkflowAction[\s\S]*decryptSecret\(station.pat\)/);
assert.match(ui, /Run workflow/);
assert.match(ui, /action=\{runAction\}/);
assert.match(ui, /runState.runUrl/);
console.log("PASS: manual GitHub dispatch API, queue bypass, running/retry guards, secret boundary, UI");
