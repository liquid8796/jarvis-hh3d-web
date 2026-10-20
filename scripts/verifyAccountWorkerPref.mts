#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pickDispatch } from "../src/lib/services/dispatch";
import { assignQueueSlots } from "../src/lib/services/queue";
import { effectiveWorkerPref, resolveAccountWorkerPref } from "../src/lib/validation/accountWorkerPref";

assert.equal(resolveAccountWorkerPref("default"),"default");
assert.equal(resolveAccountWorkerPref("sect"),"sect");
assert.equal(resolveAccountWorkerPref("mine"),"mine");
assert.equal(resolveAccountWorkerPref("any"),null);
assert.equal(resolveAccountWorkerPref("__proto__"),null);
assert.equal(effectiveWorkerPref("default","any"),"any");
assert.equal(effectiveWorkerPref("default","mine"),"mine");
assert.equal(effectiveWorkerPref("default","sect"),"sect");
assert.equal(effectiveWorkerPref(null,"sect"),"sect");
assert.equal(effectiveWorkerPref("mine","sect"),"mine");
assert.equal(effectiveWorkerPref("sect","mine"),"sect");

const now=1800000000000;
const runners=[
 {id:"sect-worker",userId:null,lastSeen:now,lastAssignedAt:null,maxJobs:5,running:0},
 {id:"home-worker",userId:"owner",lastSeen:now,lastAssignedAt:null,maxJobs:5,running:0}
];
const job=(id:string,choice:"default"|"sect"|"mine",global:"any"|"sect"|"mine")=>({
 id,userId:"owner",dueAt:now-60000,lastRunner:null,
 ownerPref:effectiveWorkerPref(choice,global)
});
const jobs=[
 job("sect-only","sect","any"),
 job("home-only","mine","any"),
 job("inherited","default","any")
];
assert.equal(pickDispatch({askedBy:"sect-worker",runners,jobs:[jobs[1]],now}).jobId,null);
assert.equal(pickDispatch({askedBy:"home-worker",runners,jobs:[jobs[0]],now}).jobId,null);
assert.equal(pickDispatch({askedBy:"sect-worker",runners,jobs,now}).jobId,"sect-only");
assert.equal(pickDispatch({askedBy:"home-worker",runners,jobs:[jobs[1],jobs[2]],now}).jobId,"home-only");
assert.equal(pickDispatch({askedBy:"sect-worker",runners,jobs:[jobs[2]],now}).jobId,"inherited");
const slots=assignQueueSlots(jobs.map(j=>({
 userId:j.userId,ownerPref:j.ownerPref,ownerWorkerOnline:true,queued:true
})),true);
assert.deepEqual(slots.map(s=>s.pool),["sect","own","sect"]);
assert.deepEqual(slots.map(s=>s.position),[1,1,2]);
// Both read paths MUST select account override before global pref, live from DB,
// never from an old config_snapshot, so UI queue and scheduler cannot disagree.
for(const name of ["jobs","queue"]){
 const source=readFileSync(new URL("../src/lib/services/"+name+".ts",import.meta.url),"utf8");
 const ownerPref=source.slice(source.indexOf("select acc.worker_pref_override from game_accounts"));
 assert(ownerPref.includes("acc.id = job.account_id and acc.user_id = job.user_id"));
 assert(ownerPref.indexOf("acc.worker_pref_override") < ownerPref.indexOf("uc.config->>'workerPref'"));
}
console.log("PASS: account override inheritance, validation, two accounts/two worker pools, live SQL precedence.");
