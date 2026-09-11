#!/usr/bin/env node
import assert from "node:assert/strict";
import { encryptSecret } from "../src/lib/crypto/secretBox";
import { appSettingsSchema, type AppSettings } from "../src/lib/services/settings";
import { createPrimaryRepoNameGenerator, planPrimaryRepoName, type PrimaryRepoNameInput } from "../src/lib/services/ollamaRepoNaming";

process.env.ENCRYPTION_KEY = "4".repeat(64);
const secret = "naming-fixture-secret-do-not-publish-123456";
const config = (): AppSettings["githubNurture"] => ({ defaultCompanionCount: 3, model: "gemma4:31b-cloud", contextWindow: 8192,
  apiKeys: Array.from({ length: 4 }, (_, index) => ({ id: `key-${index}`, label: `Fixture ${index}`, secret: encryptSecret(`${secret}-${index}`), disabled: false, cooldownUntil: null, lastUsedAt: null, lastError: "" })) });
const state = (): AppSettings => appSettingsSchema.parse({ githubNurture: config(), githubStations: [{ owner: "fixture-owner", repo: "Earlier", companionRepos: [], pat: "private-pat" }] });
type Call = { url: string; body: { model: string; messages: Array<{ role: string; content: string }>; options: Record<string, number>; tools?: unknown; format?: unknown; stream?: boolean }; headers: Headers; init?: RequestInit };
let calls: Call[] = [];
let respond: (call: Call) => Response | Promise<Response>;
const fetcher: typeof fetch = async (url, init) => {
  const call = { url: String(url), body: JSON.parse(String(init?.body)), headers: new Headers(init?.headers), init };
  calls.push(call);
  return respond(call);
};
const input = (): PrimaryRepoNameInput => ({ config: config(), owner: "fixture-owner", recentNames: [], deadlineAt: Date.now() + 60_000, fetch: fetcher });
const reply = (value: unknown) => new Response(JSON.stringify({ message: { content: typeof value === "string" ? value : JSON.stringify(value) } }), { status: 200 });
let passed = 0;
async function check(name: string, run: () => Promise<void>) { calls = []; await run(); console.log(`ok ${++passed} - ${name}`); }

await check("configured cloud model and keys use a bounded native request without unsupported format or tools", async () => {
  const request = input();
  respond = () => reply({ repo: "Quill" });
  assert.equal(await planPrimaryRepoName(request), "Quill");
  assert.equal(calls[0].url, "https://ollama.com/api/chat");
  assert.equal(calls[0].body.model, "gemma4:31b");
  assert.equal(calls[0].body.format, undefined);
  assert.equal(calls[0].body.tools, undefined);
  assert.equal(calls[0].body.stream, false);
  assert.equal(calls[0].body.options.num_predict, 2048);
  assert.equal(calls[0].init?.redirect, "error");
  assert.equal(calls[0].headers.get("authorization"), `Bearer ${secret}-0`);
  assert(!JSON.stringify(calls[0].body).includes(secret));
  assert(request.config.apiKeys[0].lastUsedAt);
  request.config.model = "future-model:custom";
  await planPrimaryRepoName(request);
  assert.equal(calls[1].body.model, request.config.model);
});
await check("names retain arbitrary model-selected lengths, case and separators without template or suffix", async () => {
  for (const repo of ["A", "MixedCase", "with_underscores", "a.b.c", "multiple-long-word-combinations", "123", ".hidden", "Z".repeat(100)]) {
    respond = () => reply({ repo });
    assert.equal(await planPrimaryRepoName(input()), repo);
  }
});
await check("invalid output gets exactly one repair and never a generated fallback", async () => {
  for (const value of ["not json", [], {}, { repo: "../escape" }, { repo: "." }, { repo: ".." }, { repo: "word.git" }, { repo: "too long" }, { repo: "á" }, { repo: "a".repeat(101) }, { repo: "name", extra: true }, { repo: 42 }]) {
    calls = []; respond = () => reply(value);
    await assert.rejects(planPrimaryRepoName(input()), /failed after one repair/);
    assert.equal(calls.length, 2);
  }
  calls = []; respond = () => reply(calls.length === 1 ? { repo: "invalid/name" } : { repo: "Clear" });
  assert.equal(await planPrimaryRepoName(input()), "Clear");
  assert.equal(calls.length, 2);
});
await check("recent history is bounded, treated as data and rejects exact case-insensitive repetition", async () => {
  const request = input(); request.recentNames = Array.from({ length: 30 }, (_, index) => `old_${index}`);
  respond = () => reply(calls.length === 1 ? { repo: "OLD_29" } : { repo: "NewChoice" });
  assert.equal(await planPrimaryRepoName(request), "NewChoice");
  const metadata = JSON.parse(calls[0].body.messages[1].content);
  assert.deepEqual(metadata.recentNames, request.recentNames.slice(-20));
  assert(calls[0].body.messages[0].content.includes("not naming instructions"));
});
await check("quota, rate-limit and invalid-authentication health follows the shared key policy", async () => {
  const request = input();
  respond = () => calls.length <= 3 ? new Response("provider body must stay private", { status: [401, 429, 402][calls.length - 1], headers: { "Retry-After": "120" } }) : reply({ repo: "Available" });
  assert.equal(await planPrimaryRepoName(request), "Available");
  assert.equal(calls.length, 4);
  assert(request.config.apiKeys[0].disabled);
  assert(request.config.apiKeys[1].cooldownUntil);
  assert(request.config.apiKeys[2].cooldownUntil);
  assert.equal(request.config.apiKeys[3].lastError, "");
  assert(!JSON.stringify(request.config.apiKeys).includes("provider body"));
});
await check("unavailable keys and model failures stop without calling other resources", async () => {
  const request = input(); request.config.apiKeys.forEach(key => { key.disabled = true; });
  await assert.rejects(planPrimaryRepoName(request), /No eligible Ollama API key/);
  assert.equal(calls.length, 0);
  respond = () => new Response(secret, { status: 503 });
  await assert.rejects(planPrimaryRepoName(input()), /HTTP 503/);
  assert.equal(calls.length, 1);
});
await check("credentials, including JSON-escaped output, never become names or repair prompt content", async () => {
  for (const content of [JSON.stringify({ repo: `${secret}-0` }), `{"repo":"${`${secret}-0`.split("").map(char => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`).join("")}"}`]) {
    calls = []; respond = () => reply(content);
    await assert.rejects(planPrimaryRepoName(input()), /authentication material/);
    assert.equal(calls.length, 2);
    assert(!JSON.stringify(calls[1].body).includes(secret));
    assert(!JSON.stringify(calls[1].body).includes("\\u006e"));
  }
});
await check("provider tools and oversized envelopes are rejected without execution", async () => {
  respond = () => new Response(JSON.stringify({ message: { content: "", tool_calls: [{ function: { name: "WebSearch", arguments: { query: "unused" } } }] } }));
  await assert.rejects(planPrimaryRepoName(input()), /does not allow tools/);
  assert.equal(calls.length, 2);
  calls = []; respond = () => reply("x".repeat(33 * 1024));
  await assert.rejects(planPrimaryRepoName(input()), /safe size limit/);
  assert.equal(calls.length, 1);
});
await check("expired and short task budgets abort transport rather than continue or invent a name", async () => {
  const expired = input(); expired.deadlineAt = Date.now() - 1;
  await assert.rejects(planPrimaryRepoName(expired), /deadline has expired/);
  assert.equal(calls.length, 0);
  const request = input(); request.deadlineAt = Date.now() + 30;
  respond = call => new Promise<Response>((_, reject) => {
    const rejectAbort = () => reject(new Error("transport exception with private material"));
    if (call.init?.signal?.aborted) rejectAbort(); else call.init?.signal?.addEventListener("abort", rejectAbort, { once: true });
  });
  await assert.rejects(planPrimaryRepoName(request), /timed out within the task deadline/);
  assert.equal(calls.length, 1);
});
await check("authoritative generator caps its complete stage and merges only current key health", async () => {
  const initial = state(); const current = structuredClone(initial); let captured: PrimaryRepoNameInput | undefined; let mutationDeadline = 0;
  const start = Date.now();
  const generate = createPrimaryRepoNameGenerator({
    read: async deadline => { assert.equal(deadline, start + 43_500); return initial; },
    plan: async request => {
      captured = request;
      request.config.apiKeys[0].lastUsedAt = new Date(start).toISOString(); request.config.apiKeys[0].lastError = "A safe diagnostic";
      current.githubNurture.model = "user-selected:other";
      current.githubStations[0].repo = "ConcurrentUserEdit";
      current.githubNurture.apiKeys[0].label = "New user label";
      return "Chosen";
    },
    mutate: async (change, options) => { mutationDeadline = options.deadlineAt; change(current); },
  });
  assert.equal(await generate("fixture-owner", { deadlineAt: start + 240_000, now: () => start }), "Chosen");
  assert.equal(captured?.deadlineAt, start + 43_500);
  assert.deepEqual(captured?.recentNames, ["Earlier"]);
  assert.equal(mutationDeadline, start + 45_000);
  assert.equal(current.githubNurture.model, "user-selected:other");
  assert.equal(current.githubStations[0].repo, "ConcurrentUserEdit");
  assert.equal(current.githubNurture.apiKeys[0].label, "New user label");
  assert.equal(current.githubNurture.apiKeys[0].lastError, "A safe diagnostic");
  assert.equal(initial.githubNurture.apiKeys[0].lastUsedAt, null);
});
await check("failure health persists but replaced, user-edited and more-recent keys remain untouched", async () => {
  for (const mode of ["unchanged", "replaced", "disabled", "newer"] as const) {
    const initial = state(); const current = structuredClone(initial); const start = Date.now(); let writes = 0;
    const generate = createPrimaryRepoNameGenerator({
      read: async () => initial,
      plan: async request => {
        request.config.apiKeys[0].lastUsedAt = new Date(start).toISOString(); request.config.apiKeys[0].lastError = "Failed attempt";
        if (mode === "replaced") current.githubNurture.apiKeys[0].secret = encryptSecret("a-new-user-supplied-secret");
        if (mode === "disabled") current.githubNurture.apiKeys[0].disabled = true;
        if (mode === "newer") current.githubNurture.apiKeys[0].lastUsedAt = new Date(start + 1000).toISOString();
        throw new Error("Naming failed");
      },
      mutate: async change => { writes++; change(current); },
    });
    await assert.rejects(generate("fixture-owner", { deadlineAt: start + 60_000, now: () => start }), /Naming failed/);
    assert.equal(writes, 1);
    assert.equal(current.githubNurture.apiKeys[0].lastError, mode === "unchanged" ? "Failed attempt" : "");
  }
});
console.log(`Verified ${passed} Ollama repository naming cases.`);
