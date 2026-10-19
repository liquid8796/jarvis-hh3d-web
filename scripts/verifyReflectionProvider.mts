import assert from "node:assert/strict";
import { encryptSecret } from "../src/lib/crypto/secretBox";
import { planCompanion } from "../src/lib/services/ollamaCompanion";
import { planPrimaryRepoName } from "../src/lib/services/ollamaRepoNaming";
import { parseOllamaKeyImport } from "../src/lib/validation/githubNurture";
import { createReflectionChatClient } from "../src/lib/services/reflectionChat";
import type { AppSettings } from "../src/lib/services/settings";
process.env.ENCRYPTION_KEY = "5".repeat(64);
type Config = AppSettings["githubNurture"];
const key = (id: string) => ({id, label:"Reflection test",secret:encryptSecret("local-fixture-"+id),
  disabled:false,cooldownUntil:null as string|null,lastUsedAt:null as string|null,lastError:""});
const config = (): Config => ({
  defaultCompanionCount:3,provider:"reflection",model:"gemma4:31b-cloud",
  reflectionModel:"Beam-1.0-501B-A23B",contextWindow:32768,
  apiKeys:[key("ollama-key")],reflectionApiKeys:[key("reflection-a"),key("reflection-b")],
  webSearchEnabled:false
});
const body = (content: string | null, tools?: unknown[]) => new Response(JSON.stringify({
  choices:[{message:{role:"assistant",content,reasoning_content:"not for output",
    ...(tools?{tool_calls:tools}:{})},finish_reason:"stop"}]
}),{status:200,headers:{"Content-Type":"application/json"}});
let tested=0;
{
  const longKey="a".repeat(768);
  assert.throws(() => parseOllamaKeyImport(longKey));
  assert.deepEqual(parseOllamaKeyImport(longKey,4096),[longKey]);
  assert.deepEqual(parseOllamaKeyImport(JSON.stringify({keys:[{key:longKey}]}),4096),[longKey]);
  tested++;
}
{
 const c=config(); let captured:any;
 const client=createReflectionChatClient({config:c,deadlineAt:Date.now()+10000,
   fetch:async (url,init)=>{captured={url,init,body:JSON.parse(String(init?.body))};return body('{"ok":true}');}});
 const result=await client.request([{role:"user",content:"JSON test"}],{format:"json",think:false});
 assert.equal(result.content,'{"ok":true}');
 assert.equal(captured.url,"https://api.reflection.ai/openai/v1/chat/completions");
 assert.equal(captured.body.model,"Beam-1.0-501B-A23B");
 assert.deepEqual(captured.body.response_format,{type:"json_object"});
 assert.equal(captured.body.stream,false);
 assert.equal(captured.body.think,undefined);
 assert.equal(captured.body.format,undefined);
 assert(!JSON.stringify(captured.body).includes("local-fixture"));
 assert(String(new Headers(captured.init.headers).get("Authorization")).includes("local-fixture-reflection-a"));
 assert(!String(new Headers(captured.init.headers).get("Authorization")).includes("ollama-key"));
 tested++;
}

{
 const c=config(); let captured:any;
 const client=createReflectionChatClient({config:c,deadlineAt:Date.now()+10000,
   fetch:async (_url,init)=>{captured=JSON.parse(String(init?.body));return body(null,[
     {id:"call_456",type:"function",function:{name:"WebSearch",arguments:'{"query":"Java virtual threads"}'}}
   ]);}});
 const result=await client.request([{role:"user",content:"Research"}],{tools:[{type:"function",function:{
    name:"WebSearch",parameters:{type:"object",properties:{query:{type:"string"}}}
 }}]});
 assert.equal((result.tool_calls?.[0] as any)?.id,"call_456");
 assert.equal(captured.tools.length,1);
 await client.request([
   {role:"assistant",content:"",reasoning_content:"previous reasoning",tool_calls:[
      {id:"call_456",function:{name:"WebSearch",arguments:{query:"Java virtual threads"}}}
   ]},
   {role:"tool",tool_name:"WebSearch",tool_call_id:"call_456",content:"Document result"}
 ],{format:"json"});
 assert.equal(captured.messages[0].tool_calls[0].id,"call_456");
 assert.equal(captured.messages[0].reasoning_content,"previous reasoning");
 assert.equal(captured.messages[1].tool_call_id,"call_456");
 tested++;
}
{
 const c=config(); let number=0;
 const client=createReflectionChatClient({config:c,deadlineAt:Date.now()+10000,
   fetch:async ()=>++number===1 ? new Response(null,{status:429,headers:{"Retry-After":"60"}})
     : body('{"ok":true}')});
 const result=await client.request([{role:"user",content:"Retry"}],{format:"json"});
 assert.equal(result.content,'{"ok":true}');
 assert.equal(number,2);
 assert(c.reflectionApiKeys?.[0].cooldownUntil);
 assert.equal(c.apiKeys[0].cooldownUntil,null);
 tested++;
}
{
 const c=config();c.reflectionApiKeys=[key("auth")];
 const client=createReflectionChatClient({config:c,deadlineAt:Date.now()+10000,fetch:async ()=>new Response(null,{status:401})});
 await assert.rejects(()=>client.request([{role:"user",content:"auth"}]),/Reflection/);
 assert.equal(c.reflectionApiKeys[0].disabled,true);
 assert.equal(c.apiKeys[0].disabled,false);
 tested++;
}
{
 const fetchOriginal=globalThis.fetch;
 const responses = [
   {action:"wait",repo:"sample-utility",description:"",reason:"Wait before creating source.",commitMessage:"",files:[],nextCheckMinutes:60},
   {repo:"fresh-reflection-tool"}
 ];
 const endpoints:string[]=[];
 globalThis.fetch=async (url) => {
   endpoints.push(String(url));
   const value=responses.shift();
   return body(JSON.stringify(value));
 };
 try {
   const c=config();
   c.webSearchEnabled=false;
   const decision=await planCompanion({config:c,station:{owner:"example-owner",repo:"primary-repo"},
     existingRepos:[],mode:"create",context:"Safe offline test; wait is permitted.",deadlineAt:Date.now()+15000});
   assert.equal(decision.action,"wait");
   const named=await planPrimaryRepoName({config:c,owner:"example-owner",recentNames:[],
     deadlineAt:Date.now()+15000});
   assert.equal(named,"fresh-reflection-tool");
   assert.equal(endpoints.length,2);
   assert(endpoints.every(item=>item==="https://api.reflection.ai/openai/v1/chat/completions"));
   tested++;
 } finally {globalThis.fetch=fetchOriginal;}
}
{
 const c=config();c.reflectionApiKeys=[key("bad-request")];
 const client=createReflectionChatClient({config:c,deadlineAt:Date.now()+10000,
   fetch:async ()=>new Response(JSON.stringify({error:{
     code:"unsupported_parameter",param:"messages[0].content",
     message:"Untrusted text and secret value local-fixture-bad-request"
   }}),{status:400,headers:{"Content-Type":"application/json"}})});
 await assert.rejects(()=>client.request([{role:"user",content:"bad request"}]),
   /Reflection HTTP 400/);
 assert.equal(c.reflectionApiKeys[0].lastError,
   "Reflection HTTP 400 (unsupported_parameter; messages[0].content)");
 assert(!c.reflectionApiKeys[0].lastError.includes("local-fixture"));
 assert.equal(c.reflectionApiKeys[0].disabled,false);
 tested++;
}
{
 const c=config();c.reflectionApiKeys=[key("error-code")];
 const client=createReflectionChatClient({config:c,deadlineAt:Date.now()+10000,
   fetch:async ()=>new Response(JSON.stringify({error:{code:"model_not_found",param:"model"}}),
     {status:404})});
 await assert.rejects(()=>client.request([{role:"user",content:"model"}]),/Reflection HTTP 404/);
 assert.equal(c.reflectionApiKeys[0].lastError,"Reflection HTTP 404 (model_not_found; model)");
 tested++;
}
console.log("PASS: "+tested+" Reflection adapter integration cases (mock network).");
