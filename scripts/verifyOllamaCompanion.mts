#!/usr/bin/env node
import assert from "node:assert/strict";
import { encryptSecret } from "../src/lib/crypto/secretBox";
import { planCompanion, type CompanionDecision } from "../src/lib/services/ollamaCompanion";
import type { AppSettings } from "../src/lib/services/settings";
import { canonicalCompanionLanguage, inferCompanionLanguages, isCompanionSourcePath } from "../src/lib/validation/companionLanguages";

process.env.ENCRYPTION_KEY = "3".repeat(64);
type Input = Parameters<typeof planCompanion>[0];
const fixtureSecret = "ollama_test_secret_do_not_publish_123456789";
const config = (): AppSettings["githubNurture"] => ({
  defaultCompanionCount: 3, model: "gemma4:31b-cloud", contextWindow: 64000,
  apiKeys: [0, 1].map((i) => ({ id: `key-${i}`, label: `Test ${i}`, secret: encryptSecret(`${fixtureSecret}-${i}`), disabled: false, cooldownUntil: null, lastUsedAt: null, lastError: "" })),
});
const input = (): Input => ({ config: config(), station: { owner: "fixture-owner", repo: "station-runtime" }, existingRepos: [], mode: "create", context: "Build a useful, small software project.", deadlineAt: Date.now() + 60000 });
const decision = (): CompanionDecision => ({ action: "create", repo: "color-contrast-helper", description: "Contrast calculations for interface colors", reason: "A focused utility can help designers check readable palettes.", commitMessage: "feat: calculate relative luminance", language: "TypeScript", sourcePaths: ["src/contrast.ts"], files: [{ path: "src/contrast.ts", content: "export function channel(value: number): number { const n = value / 255; return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4; }\n" }], nextCheckMinutes: 93 });
const inLanguage = (language: string, path: string, content: string): CompanionDecision => ({ ...decision(), language, sourcePaths: [path], files: [{ path, content }] });
const python = () => inLanguage("Python", "src/contrast.py", "def luminance_channel(value):\n    n = value / 255\n    return n / 12.92 if n <= 0.04045 else ((n + 0.055) / 1.055) ** 2.4\n");
const rust = () => inLanguage("Rust", "src/lib.rs", "pub fn channel(value: u8) -> f64 { let n = f64::from(value) / 255.0; if n <= 0.04045 { n / 12.92 } else { ((n + 0.055) / 1.055).powf(2.4) } }\n");
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
  await check("new projects declare language and matching primary source while legacy maintenance remains valid", async () => {
    for (const change of [{ language: undefined }, { language: "" }, { sourcePaths: undefined }, { sourcePaths: [] }]) {
      calls = []; respond = () => reply({ ...decision(), ...change });
      await assert.rejects(planCompanion(input()), /language|sourcePaths/i);
      assert.equal(calls.length, 2);
    }
    const request = input(); request.mode = "maintain"; request.repo = decision().repo;
    respond = () => reply({ ...decision(), action: "commit", language: undefined, sourcePaths: undefined });
    assert.equal((await planCompanion(request)).action, "commit");
    respond = () => reply({ ...decision(), action: "wait", language: undefined, sourcePaths: undefined, files: [] });
    assert.equal((await planCompanion(input())).action, "wait");
  });
  await check("maintenance reuses trusted unfamiliar source declarations but new source needs its own declaration", async () => {
    const request = input(); request.mode = "maintain"; request.repo = decision().repo; request.language = "Janet";
    request.declaredSourcePaths = ["src/math.janet", ...Array.from({ length: 255 }, (_, index) => `src/module-${index}.janet`)];
    request.contextFiles = { "src/math.janet": "(defn square [number]\n  (* number number))\n" };
    request.config.contextWindow = 8192;
    request.languageHistory = ["Janet", "Janet"];
    const existingChange = { ...inLanguage("Janet", "src/math.janet", "(defn cube [number]\n  (* number number number))\n"), action: "commit", language: undefined, sourcePaths: undefined };
    respond = () => reply(existingChange);
    const maintained = await planCompanion(request);
    assert.equal(maintained.action, "commit");
    assert.equal(maintained.language, undefined);
    assert.equal(maintained.sourcePaths, undefined);
    assert.deepEqual(maintained.readPaths, ["src/math.janet"]);
    const messages = calls[0].body.messages as Array<{ role: string; content: string }>;
    const metadata = JSON.parse(messages.find((entry) => entry.role === "user")!.content);
    assert.equal(metadata.language, "Janet");
    assert.deepEqual(metadata.declaredSourcePaths, ["src/math.janet"], "only complete included source needs declaration metadata in a small context budget");
    const newChange = { ...inLanguage("Janet", "src/new.janet", "(defn cube [number]\n  (* number number number))\n"), action: "commit" };
    calls = []; respond = () => reply({ ...newChange, language: undefined, sourcePaths: undefined });
    await assert.rejects(planCompanion(request), /new unfamiliar source path/);
    calls = []; respond = () => reply({ ...newChange, language: undefined });
    await assert.rejects(planCompanion(request), /primary programming language/);
    calls = []; respond = () => reply(calls.length === 1 ? { ...newChange, sourcePaths: undefined } : newChange);
    assert.deepEqual((await planCompanion(request)).sourcePaths, ["src/new.janet"]);
    assert.equal(calls.length, 2);
  });
  await check("nonwrite decisions cannot inject source declarations and forks cannot invent their language", async () => {
    for (const action of ["fork", "wait", "delete"] as const) {
      const request = input();
      request.station.allowCompanionFork = true; request.station.allowCompanionDelete = true;
      if (action === "delete") { request.mode = "maintain"; request.repo = decision().repo; }
      calls = []; respond = () => reply({ ...decision(), action, language: undefined, sourcePaths: ["README.md"], files: [], ...(action === "fork" ? { forkFrom: "public-owner/source" } : {}) });
      await assert.rejects(planCompanion(request), /sourcePaths is only valid/);
    }
    const request = input(); request.station.allowCompanionFork = true;
    calls = []; respond = () => reply({ ...decision(), action: "fork", sourcePaths: undefined, files: [], forkFrom: "public-owner/source" });
    await assert.rejects(planCompanion(request), /Fork language comes from/);
  });
  await check("Python repetition triggers one repair with actual language history and accepts Rust", async () => {
    const request = input(); request.languageHistory = ["python3", "Python"];
    respond = () => reply(calls.length === 1 ? python() : rust());
    const result = await planCompanion(request);
    assert.equal(result.language, "Rust");
    assert.deepEqual(result.sourcePaths, ["src/lib.rs"]);
    assert.equal(calls.length, 2);
    const messages = calls[0].body.messages as Array<{ role: string; content: string }>;
    assert.deepEqual(JSON.parse(messages.find((entry) => entry.role === "user")!.content).languageHistory, request.languageHistory);
    assert(messages[0].content.includes("FIRST choose"));
    assert(JSON.stringify(calls[1].body.messages).includes("most recently created companion or a dominant language"));
    assert.equal(calls[1].body.tools, undefined);
  });
  await check("dominant languages cannot alternate with a single other language to bypass diversity", async () => {
    const request = input(); request.languageHistory = ["Rust", "Python", "python3"];
    for (const candidate of [python(), rust()]) {
      calls = []; respond = () => reply(candidate);
      await assert.rejects(planCompanion(request), /dominant language/);
      assert.equal(calls.length, 2);
    }
    calls = []; respond = () => reply(calls.length === 1 ? python() : decision());
    assert.equal((await planCompanion(request)).language, "TypeScript");
    assert.equal(calls.length, 2);
    // History outside the last eight entries does not become a permanent ban.
    request.languageHistory = ["Rust", "Go", "Ruby", "Elixir", "Julia", "Nim", "C#", "Gleam", "Python", "Python"];
    calls = []; respond = () => reply(python());
    assert.equal((await planCompanion(request)).language, "Python");
    assert.equal(calls.length, 1);
  });
  await check("aliases cannot bypass repetition and balanced history leaves the model free to choose", async () => {
    for (const [last, candidate] of [["TS", decision()], ["JavaScript", inLanguage("JS", "src/math.js", "export const square = value => value * value;\n")], ["CSharp", inLanguage("C#", "Square.cs", "public static class Math { public static int Square(int n) => n * n; }\n")]] as const) {
      const request = input(); request.languageHistory = [last];
      calls = []; respond = () => reply(candidate);
      await assert.rejects(planCompanion(request), /most recently/);
    }
    const request = input(); request.languageHistory = ["Rust", "Python", "Go"];
    calls = []; respond = () => reply(python());
    assert.equal((await planCompanion(request)).language, "Python");
    assert.equal(calls.length, 1);
    assert.equal(canonicalCompanionLanguage("C ++"), canonicalCompanionLanguage("CPP"));
    assert.equal(canonicalCompanionLanguage("C Sharp"), canonicalCompanionLanguage("c#"));
  });
  await check("Python stays available with no history and maintenance preserves its existing language", async () => {
    respond = () => reply(python());
    assert.equal((await planCompanion(input())).language, "Python");
    const request = input(); request.mode = "maintain"; request.repo = decision().repo; request.languageHistory = ["Python", "Python"];
    respond = () => reply({ ...python(), action: "commit" });
    assert.equal((await planCompanion(request)).language, "Python");
    const messages = calls.at(-1)!.body.messages as Array<{ role: string; content: string }>;
    assert(messages[0].content.includes("preserves the existing language and architecture"));
  });
  await check("diverse known languages and unfamiliar source extensions are accepted without executing them", async () => {
    const candidates = [
      rust(),
      inLanguage("Go", "src/math.go", "package math\nfunc Square(n int) int { return n * n }\n"),
      inLanguage("C#", "Square.cs", "public static class Math { public static int Square(int n) => n * n; }\n"),
      inLanguage("Ruby", "lib/math.rb", "def square(number)\n  number * number\nend\n"),
      inLanguage("Elixir", "lib/math.ex", "defmodule Math do\n  def square(number), do: number * number\nend\n"),
      inLanguage("Gleam", "src/math.gleam", "pub fn square(number: Int) -> Int { number * number }\n"),
      inLanguage("F#", "Math.fs", "module Math\nlet square number = number * number\n"),
      inLanguage("Fortran", "src/math.f90", "integer function square(n)\ninteger, intent(in) :: n\nsquare = n * n\nend function\n"),
      inLanguage("Prolog", "src/family.pl", "ancestor(X, Y) :- parent(X, Y).\nancestor(X, Y) :- parent(X, Z), ancestor(Z, Y).\n"),
      inLanguage("MATLAB", "src/square.m", "function result = square(n)\nresult = n .* n;\nend\n"),
      inLanguage("Janet", "src/math.janet", "(defn square [number]\n  (* number number))\n"),
    ];
    for (const candidate of candidates) {
      calls = []; respond = () => reply(candidate);
      const request = input(); request.languageHistory = ["Python", "Python"];
      assert.equal((await planCompanion(request)).language, candidate.language);
      assert.equal(calls.length, 1);
    }
  });
  await check("language declarations cannot spoof Python as Rust or promote documentation and assets to source", async () => {
    const invalid = [
      { ...python(), language: "Rust" },
      { ...decision(), sourcePaths: ["src/missing.ts"] },
      { ...decision(), sourcePaths: ["src/contrast.ts", "src/contrast.ts"] },
      { ...decision(), sourcePaths: "src/contrast.ts" },
      ...["README.md", "README.unknown", "package.json", "config.unknown", "data.csv", "logo.svg", "image.png", ".env", ".github/workflows/run.unknown"].map((path) => inLanguage("Future Language", path, path.endsWith(".json") ? '{"description":"documentation only"}' : "Documentation about a future project, with no source implementation.")),
      inLanguage("Janet", "src/math.janet", ""),
    ];
    for (const candidate of invalid) {
      calls = []; respond = () => reply(candidate);
      await assert.rejects(planCompanion(input()));
      assert.equal(calls.length, 2);
    }
    assert(isCompanionSourcePath("src/math.gleam"));
    assert(!isCompanionSourcePath("src/math.janet"));
    assert(isCompanionSourcePath("src/math.janet", ["src/math.janet"]));
    for (const path of ["README.md", "settings.json", "image.png", ".github/workflows/source.rs", "../source.rs", "secrets/source.rs"]) assert(!isCompanionSourcePath(path, [path]), path);
    assert.deepEqual(inferCompanionLanguages([{ path: "src/math.py", content: "x".repeat(200) }, { path: "src/lib.rs", content: "x".repeat(300) }, { path: "README.md", content: "x".repeat(1000) }]), ["Rust", "Python"]);
    assert.deepEqual(inferCompanionLanguages(["src/main.go", "src/math.go", "src/example.py"]), ["Go", "Python"]);
    assert.deepEqual(inferCompanionLanguages(["src/ambiguous.m", "src/ambiguous.v"]), []);
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
    respond = () => reply({ ...decision(), sourcePaths: ["src/huge.ts"], files: [{ path: "src/huge.ts", content: "export function next() { return 42; }" }] });
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
    respond = () => reply({ ...decision(), action: "delete", sourcePaths: undefined, files: [] });
    await assert.rejects(planCompanion(request));
    request.station.allowCompanionDelete = true;
    assert.equal((await planCompanion(request)).action, "delete");
    respond = () => reply({ ...decision(), action: "commit", repo: "other-repo" });
    await assert.rejects(planCompanion(request));
    respond = () => reply({ ...decision(), action: "wait", sourcePaths: undefined, files: [], nextCheckMinutes: 10080 });
    assert.equal((await planCompanion(input())).nextCheckMinutes, 10080);
    respond = () => reply({ ...decision(), action: "fork", language: undefined, sourcePaths: undefined, files: [], forkFrom: "public-owner/source" });
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
