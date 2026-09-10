#!/usr/bin/env node
/** Injected metadata-only migration checks; no network, database, or real credentials. */
import assert from "node:assert/strict";
import { metadataRequest, publicMetadataOrigins, redactStationPublicMetadata, type MetadataRequest } from "./redactGithubPublicMetadata.mts";

const origin = "https://backend.example.invalid";
const slug = "fixture/worker";
const station = { owner: "fixture", repo: "worker", workflowFile: "worker.yml", pat: "unused-fixture" };
const legacy = `# worker\n\nScheduled background task runner.\n\nGenerated from an upstream template — do not edit here.\n\nEndpoint: ${origin}\n[Public docs](https://docs.example.invalid)\n`;
const oldSha = "a".repeat(40);
const newSha = "b".repeat(40);
type Call = { method: string; route: string; body?: unknown };
function fixture(options: { readme?: string | null; workflow?: string | null } = {}) {
  const calls: Call[] = [];
  const info = { id: 101, full_name: slug, default_branch: "main", description: `Scheduled task runner. API: ${origin}/api`, homepage: `${origin}/status` };
  let text = options.readme === undefined ? legacy : options.readme;
  let sha = oldSha;
  let infoReads = 0;
  let readmeReads = 0;
  let before: ((call: Call, count: { infoReads: number; readmeReads: number }) => void) | undefined;
  const file = (path: string, content: string) => ({ type: "file", path, sha, encoding: "base64", content: Buffer.from(content).toString("base64"), size: Buffer.byteLength(content) });
  const request: MetadataRequest = async (method, route, body) => {
    const call = { method, route, body };
    calls.push(call);
    if (method === "GET" && route === `/repos/${slug}`) infoReads++;
    if (method === "GET" && route.includes("/readme?")) readmeReads++;
    before?.(call, { infoReads, readmeReads });
    if (route === `/repos/${slug}` && method === "GET") return { status: 200, body: structuredClone(info) };
    if (route === `/repos/${slug}` && method === "PATCH") { Object.assign(info, body); return { status: 200, body: structuredClone(info) }; }
    if (route.includes("/readme?") && method === "GET") return text === null ? { status: 404, body: {} } : { status: 200, body: file("README.md", text) };
    if (route.includes("/contents/.github/workflows/") && method === "GET") {
      if (options.workflow === null) return { status: 404, body: {} };
      return { status: 200, body: file(".github/workflows/worker.yml", options.workflow ?? `env:\n  WEB_URL: \${{ vars.WEB_URL || '${origin}' }}\n`) };
    }
    if (route === `/repos/${slug}/contents/README.md` && method === "PUT") {
      const value = body as { sha: string; content: string; branch: string };
      assert.equal(value.sha, sha);
      assert.equal(value.branch, "main");
      text = Buffer.from(value.content, "base64").toString("utf8");
      sha = newSha;
      return { status: 200, body: { content: { sha } } };
    }
    throw new Error("Unexpected fixture request: only metadata routes are allowed.");
  };
  return { calls, info, request, text: () => text, mutateSha: () => { sha = newSha; }, hook: (value: typeof before) => { before = value; }, writes: () => calls.filter((call) => call.method !== "GET") };
}

let count = 0;
async function check(name: string, work: () => Promise<void> | void) { await work(); count++; console.log(`✔ ${name}`); }

await check("default dry-run reports exactly three changed fields and makes no mutation", async () => {
  const f = fixture();
  const result = await redactStationPublicMetadata(station, { request: f.request });
  assert.equal(result.status, "planned");
  assert.equal(result.changedFields, 3);
  assert.equal(result.writes, 0);
  assert.equal(f.writes().length, 0);
});
await check("apply writes only README and the two endpoint-bearing About fields", async () => {
  const f = fixture();
  const result = await redactStationPublicMetadata(station, { apply: true, request: f.request });
  assert.equal(result.status, "updated");
  assert.equal(result.writes, 2);
  assert.deepEqual(f.writes().map((call) => [call.method, call.route]), [["PUT", `/repos/${slug}/contents/README.md`], ["PATCH", `/repos/${slug}`]]);
  assert.deepEqual(Object.keys(f.writes()[1].body as object).sort(), ["description", "homepage"]);
  assert.ok(!f.text()!.includes(origin));
  assert.ok(f.text()!.includes("Scheduled background task runner."));
  assert.ok(f.text()!.includes("[Public docs](https://docs.example.invalid)"));
  assert.equal(f.info.homepage, "");
  assert.ok(f.info.description.startsWith("Scheduled task runner."));
});
await check("README SHA changes prevent every mutation", async () => {
  const f = fixture();
  f.hook((call, counters) => { if (call.route.includes("/readme?") && counters.readmeReads === 2) f.mutateSha(); });
  const result = await redactStationPublicMetadata(station, { apply: true, request: f.request });
  assert.equal(result.status, "failed");
  assert.equal(result.writes, 0);
  assert.equal(f.writes().length, 0);
});
await check("replacement repository IDs prevent every mutation", async () => {
  const f = fixture();
  f.hook((call, counters) => { if (call.route === `/repos/${slug}` && counters.infoReads === 2) f.info.id = 999; });
  const result = await redactStationPublicMetadata(station, { apply: true, request: f.request });
  assert.equal(result.status, "failed");
  assert.equal(f.writes().length, 0);
});
await check("a changed default branch prevents every mutation", async () => {
  const f = fixture();
  f.hook((call, counters) => { if (call.route === `/repos/${slug}` && counters.infoReads === 2) f.info.default_branch = "other"; });
  const result = await redactStationPublicMetadata(station, { apply: true, request: f.request });
  assert.equal(result.status, "failed");
  assert.equal(f.writes().length, 0);
});
await check("an About edit after the README write is preserved and partial progress is reported", async () => {
  const f = fixture();
  f.hook((call, counters) => { if (call.route === `/repos/${slug}` && counters.infoReads === 3) f.info.description = "A concurrently updated factual description."; });
  const result = await redactStationPublicMetadata(station, { apply: true, request: f.request });
  assert.equal(result.status, "failed");
  assert.equal(result.writes, 1);
  assert.equal(f.writes().length, 1);
  assert.equal(f.info.description, "A concurrently updated factual description.");
});
await check("an arbitrary README Endpoint line is not trusted as configuration", async () => {
  const f = fixture({ readme: `Project docs\nEndpoint: ${origin}\n`, workflow: null });
  const result = await redactStationPublicMetadata(station, { request: f.request });
  assert.equal(result.status, "unchanged");
  assert.equal(f.writes().length, 0);
});
await check("the recognized old README is sufficient for LF and CRLF origin discovery", () => {
  assert.deepEqual(publicMetadataOrigins({ readme: legacy }), [origin]);
  assert.deepEqual(publicMetadataOrigins({ readme: legacy.replace(/\n/g, "\r\n") }), [origin]);
});
await check("explicit origins permit About-only cleanup when README is absent", async () => {
  const f = fixture({ readme: null, workflow: null });
  const result = await redactStationPublicMetadata(station, { apply: true, origins: [origin], request: f.request });
  assert.equal(result.status, "updated");
  assert.equal(result.changedFields, 2);
  assert.deepEqual(f.writes().map((call) => call.method), ["PATCH"]);
});
await check("workflow discovery ignores unrelated URLs and reads only endpoint configuration lines", () => {
  assert.deepEqual(publicMetadataOrigins({ workflow: `# https://unrelated.example.invalid\nenv:\n  WEB_URL: \${{ vars.WEB_URL || '${origin}' }}\n  WORKER_FALLBACK_URL: 'https://fallback.example.invalid'\n  DOCUMENTATION_URL: https://docs.example.invalid\n` }), [origin, "https://fallback.example.invalid"]);
});
await check("transport fixes the GitHub host, refuses redirects and does not expose error response text", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const request = metadataRequest("fixture-pat", (async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({ message: "private-body-must-not-be-logged" }), { status: 403 });
  }) as typeof fetch);
  const result = await redactStationPublicMetadata(station, { request });
  assert.equal(result.status, "failed");
  assert.equal(result.note, "GitHub metadata HTTP 403.");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `https://api.github.com/repos/${slug}`);
  assert.equal(calls[0].init?.redirect, "error");
  assert.ok(!JSON.stringify(result).includes("private-body"));
});
await check("oversized transport responses fail without attempting metadata mutation", async () => {
  const request = metadataRequest("fixture-pat", (async () => new Response("x".repeat(1024 * 1024 + 1), { status: 200 })) as typeof fetch);
  const result = await redactStationPublicMetadata(station, { request });
  assert.equal(result.status, "failed");
  assert.equal(result.writes, 0);
  assert.equal(result.note, "GitHub metadata response exceeds the size limit.");
});

console.log(`\n✔ ${count} metadata migration scenarios passed with injected transport only.`);
