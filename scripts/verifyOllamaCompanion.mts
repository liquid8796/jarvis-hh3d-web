#!/usr/bin/env node
import assert from "node:assert/strict";
import { encryptSecret } from "../src/lib/crypto/secretBox";
import { planCompanion, type CompanionDecision } from "../src/lib/services/ollamaCompanion";
import type { AppSettings } from "../src/lib/services/settings";

process.env.ENCRYPTION_KEY = "3".repeat(64);
type Input = Parameters<typeof planCompanion>[0];
const fixtureSecret = "ollama_test_secret_do_not_publish_123456789";
const config = (): AppSettings["githubNurture"] => ({
  defaultCompanionCount: 3, model: "gemma4:31b-cloud", contextWindow: 64000,
  apiKeys: [0, 1].map((i) => ({ id: `key-${i}`, label: `Test ${i}`, secret: encryptSecret(`${fixtureSecret}-${i}`), disabled: false, cooldownUntil: null, lastUsedAt: null, lastError: "" })),
});
const input = (): Input => ({ config: config(), station: { owner: "fixture-owner", repo: "station-runtime" }, existingRepos: [], mode: "create", context: "Build a useful, small software project.", deadlineAt: Date.now() + 60000 });
const decision = (): CompanionDecision => ({ action: "create", repo: "color-contrast-helper", description: "Contrast calculations for interface colors", reason: "A focused utility can help designers check readable palettes.", commitMessage: "feat: calculate relative luminance", files: [{ path: "src/contrast.ts", content: "export function channel(value: number): number { const n = value / 255; return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4; }\n" }], nextCheckMinutes: 93 });
type Call = { url: string; body: Record<string, unknown>; headers: Headers };
let calls: Call[] = [];
let respond: (call: Call) => Response | Promise<Response>;
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const call = { url: String(url), body: JSON.parse(String(init?.body)), headers: new Headers(init?.headers) };
  calls.push(call);
  return respond(call);
};
const reply = (value: unknown) => new Response(JSON.stringify({ message: { content: typeof value === "string" ? value : JSON.stringify(value) }, done: true }), { status: 200 });
let passed = 0;
async function check(name: string, run: () => Promise<void>) {
  calls = [];
  await run();
  passed++;
  console.log(`ok ${passed} - ${name}`);
}
try {
  await check("native cloud request preserves model choices and generated content", async () => {
    const request = input();
    respond = () => reply(decision());
    const result = await planCompanion(request);
    assert.deepEqual(result, { ...decision(), readPaths: [] });
    assert.equal(calls[0].url, "https://ollama.com/api/chat");
    assert.equal(calls[0].body.model, "gemma4:31b");
    assert.equal(calls[0].body.stream, false);
    assert.equal(calls[0].body.format, undefined);
    assert.equal(calls[0].headers.get("Authorization"), `Bearer ${fixtureSecret}-0`);
    assert(!JSON.stringify(calls[0].body).includes(fixtureSecret));
    assert(request.config.apiKeys[0].lastUsedAt);
    request.config.model = "future-model:custom";
    await planCompanion(request);
    assert.equal(calls[1].body.model, "future-model:custom");
  });
  await check("repairs malformed JSON once, and accepts a fenced response", async () => {
    respond = () => calls.length === 1 ? reply("{invalid") : reply(`\`\`\`json\n${JSON.stringify(decision())}\n\`\`\``);
    assert.equal((await planCompanion(input())).action, "create");
    assert.equal(calls.length, 2);
    respond = () => reply("{invalid"); calls = [];
    await assert.rejects(planCompanion(input()), /decision|quyết định|JSON/i);
    assert.equal(calls.length, 2);
  });
  await check("context budget includes repair history and reserves output", async () => {
    const request = input(); request.config.contextWindow = 8192; request.context = "漢🙂".repeat(100000);
    respond = () => calls.length === 1 ? reply("not JSON") : reply(decision());
    await planCompanion(request);
    for (const call of calls) {
      const options = call.body.options as { num_predict: number };
      assert(Buffer.byteLength(JSON.stringify(call.body.messages), "utf8") + options.num_predict <= request.config.contextWindow);
    }
  });
  await check("file context is complete or absent and readPaths describes the successful prompt", async () => {
    const request = input(); request.config.contextWindow = 8192;
    request.contextFiles = { "src/huge.ts": "// huge\n" + "z".repeat(16000), "src/small.ts": "export function square(n: number) { return n * n; }\n", "credentials.json": '{"password":"private-fixture-value"}' };
    respond = () => calls.length === 1 ? reply("{invalid") : reply(decision());
    const result = await planCompanion(request);
    for (const call of calls) {
      const messages = call.body.messages as Array<{ role: string; content: string }>;
      const context = JSON.parse(messages.find((message) => message.role === "user")!.content);
      assert.equal(context.contextFiles["src/small.ts"], request.contextFiles["src/small.ts"]);
      assert.equal(context.contextFiles["src/huge.ts"], undefined);
      assert.equal(context.contextFiles["credentials.json"], undefined);
      assert(!JSON.stringify(call.body).includes("private-fixture-value"));
    }
    assert.deepEqual(result.readPaths, ["src/small.ts"]);
  });
  await check("auth failure disables only that key and tries an eligible alternative", async () => {
    const request = input();
    respond = () => calls.length === 1 ? new Response(`invalid ${fixtureSecret}-0`, { status: 401 }) : reply(decision());
    await planCompanion(request);
    assert.equal(calls.length, 2);
    assert.equal(request.config.apiKeys[0].disabled, true);
    assert(!JSON.stringify(request.config.apiKeys.map(({ secret: _, ...rest }) => rest)).includes(fixtureSecret));
    assert.equal(calls[1].headers.get("Authorization"), `Bearer ${fixtureSecret}-1`);
  });
  await check("429 honors Retry-After and each failed key is attempted only once", async () => {
    const request = input(); const before = Date.now();
    respond = () => new Response("rate limited", { status: 429, headers: { "Retry-After": "120" } });
    await assert.rejects(planCompanion(request), /key|khóa|khoá|Ollama/i);
    assert.equal(calls.length, 2);
    assert(Date.parse(request.config.apiKeys[0].cooldownUntil!) >= before + 120000);
    calls = [];
    await assert.rejects(planCompanion(request));
    assert.equal(calls.length, 0);
  });
  await check("402 quota exhausts one key temporarily and falls back without disabling it", async () => {
    const request = input(); const before = Date.now();
    respond = () => calls.length === 1 ? new Response("quota", { status: 402 }) : reply(decision());
    await planCompanion(request);
    assert.equal(calls.length, 2);
    assert.equal(request.config.apiKeys[0].disabled, false);
    assert(Date.parse(request.config.apiKeys[0].cooldownUntil!) >= before + 3600000);
  });
  await check("omitted source cannot be edited and model cannot forge readPaths", async () => {
    const request = input(); request.config.contextWindow = 8192;
    request.contextFiles = { "src/huge.ts": "z".repeat(20000) };
    respond = () => reply({ ...decision(), files: [{ path: "src/huge.ts", content: "export function next() { return 42; }" }] });
    await assert.rejects(planCompanion(request), /not included completely/);
    respond = () => reply({ ...decision(), readPaths: ["src/huge.ts"] });
    await assert.rejects(planCompanion(request), /unsupported fields/);
  });
  await check("model errors and transport errors do not cycle keys or disclose provider output", async () => {
    for (const status of [400, 404, 500, 503]) {
      calls = [];
      respond = () => new Response(`sensitive ${fixtureSecret}-0`, { status });
      await assert.rejects(planCompanion(input()), (error: Error) => !error.message.includes(fixtureSecret));
      assert.equal(calls.length, 1);
    }
    calls = []; respond = () => { throw new Error(`Bearer ${fixtureSecret}-0`); };
    await assert.rejects(planCompanion(input()), (error: Error) => !error.message.includes(fixtureSecret));
    assert.equal(calls.length, 1);
  });
  await check("rejects unsafe paths, oversized writes, docs-only work and invalid JSON files", async () => {
    const invalid = [
      { files: [{ path: "../outside.ts", content: "export const answer = 42;" }] },
      { files: [{ path: ".github/workflows/build.yml", content: "name: forbidden" }] },
      { files: [{ path: "folder/.git/config", content: "forbidden" }] },
      { files: [{ path: ".env.local", content: "TOKEN=forbidden" }] },
      { files: [{ path: "src\\file.ts", content: "forbidden" }] },
      { files: [{ path: "src/file.ts", content: "x".repeat(262145) }] },
      { files: [{ path: "README.md", content: "Activity counter only" }] },
      { files: [{ path: "package.json", content: "{broken" }, ...decision().files] },
      { files: Array.from({ length: 25 }, (_, n) => ({ path: `src/file${n}.ts`, content: "export const value = 42;" })) },
      { repo: "station-runtime" }, { nextCheckMinutes: 4 }, { nextCheckMinutes: 10081 },
    ];
    for (const change of invalid) {
      calls = []; respond = () => reply({ ...decision(), ...change });
      await assert.rejects(planCompanion(input()));
      assert.equal(calls.length, 2);
    }
  });
  await check("guards maintain target and permission gates while allowing model-chosen waits", async () => {
    const request = input(); request.mode = "maintain"; request.repo = decision().repo; request.existingRepos = [request.repo];
    respond = () => reply({ ...decision(), action: "commit" });
    assert.equal((await planCompanion(request)).action, "commit");
    respond = () => reply({ ...decision(), action: "delete", files: [] });
    await assert.rejects(planCompanion(request));
    request.station.allowCompanionDelete = true;
    assert.equal((await planCompanion(request)).action, "delete");
    respond = () => reply({ ...decision(), action: "commit", repo: "other-repo" });
    await assert.rejects(planCompanion(request));
    respond = () => reply({ ...decision(), action: "wait", files: [], nextCheckMinutes: 10080 });
    assert.equal((await planCompanion(input())).nextCheckMinutes, 10080);
    respond = () => reply({ ...decision(), action: "fork", files: [], forkFrom: "public-owner/source" });
    await assert.rejects(planCompanion(input()));
    const create = input(); create.station.allowCompanionFork = true;
    assert.equal((await planCompanion(create)).forkFrom, "public-owner/source");
  });
  await check("redacts known secrets in context and rejects secrets echoed into generated material", async () => {
    const request = input(); request.context = `Reference: ${fixtureSecret}-0; token ghp_${"a".repeat(40)}`;
    respond = () => reply({ ...decision(), reason: `Reason contains ${fixtureSecret}-0` });
    await assert.rejects(planCompanion(request), (error: Error) => !error.message.includes(fixtureSecret));
    assert(calls.every((call) => !JSON.stringify(call.body).includes(fixtureSecret)));
  });
  await check("expired deadline performs no network requests", async () => {
    const request = input(); request.deadlineAt = Date.now() - 1;
    await assert.rejects(planCompanion(request)); assert.equal(calls.length, 0);
  });
  await check("invalid provider envelopes stop immediately with an accurate sanitized error", async () => {
    for (const body of ["null", "[]", "{broken", JSON.stringify({ error: fixtureSecret })]) {
      calls = []; respond = () => new Response(body, { status: 200 });
      await assert.rejects(planCompanion(input()), /response envelope|no usable decision/);
      assert.equal(calls.length, 1);
    }
  });
  await check("cooling and disabled keys are skipped, including HTTP-date Retry-After", async () => {
    const request = input(); request.config.apiKeys[0].disabled = true;
    const until = new Date(Date.now() + 300000).toUTCString();
    respond = () => new Response("limited", { status: 429, headers: { "Retry-After": until } });
    await assert.rejects(planCompanion(request));
    assert.equal(calls.length, 1);
    assert.equal(request.config.apiKeys[1].cooldownUntil, new Date(until).toISOString());
  });
  console.log(`Verified ${passed} Ollama harness checks; no live network calls.`);
} finally { globalThis.fetch = originalFetch; }
