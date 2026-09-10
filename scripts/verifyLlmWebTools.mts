import assert from "node:assert/strict";
import { createLlmWebTools, WEB_TOOL_DEFINITIONS, type WebToolDependencies, type WebTransportRequest, isPublicWebAddress } from "../src/lib/services/llmWebTools";

let calls: WebTransportRequest[] = [];
let resolutions: string[] = [];
let reply: WebToolDependencies["request"];
let resolve: WebToolDependencies["resolve"] = async () => [{ address: "93.184.216.34", family: 4 }];
const secret = "fixture-web-secret-that-must-never-leave";
const tools = (over: Partial<Parameters<typeof createLlmWebTools>[0]> = {}) => createLlmWebTools({ enabled: true, searxngBaseUrl: "https://search.example.com", deadlineAt: Date.now() + 60000, secrets: [secret], ...over }, {
  resolve: async (host) => { resolutions.push(host); return resolve(host); },
  request: async (input) => { calls.push(input); return reply(input); },
});
const json = (body: unknown) => ({ status: 200, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
let passed = 0;
async function check(name: string, run: () => Promise<void> | void) {
  calls = []; resolutions = []; resolve = async () => [{ address: "93.184.216.34", family: 4 }];
  await run(); passed++; console.log(`ok ${passed} - ${name}`);
}
await check("reference names, SearXNG parameters, result count and domain boundaries", async () => {
  assert.deepEqual(WEB_TOOL_DEFINITIONS.map((tool) => tool.function.name), ["WebSearch", "WebFetch"]);
  reply = async () => json({ results: [
    { title: "Official", url: "https://docs.example.org/topic", content: "One   helpful\n result" },
    { title: "Blocked", url: "https://blocked.example.org/topic", content: "hidden" },
    { title: "Not allowed", url: "https://notexample.org/topic", content: "hidden" },
    { title: "Second official", url: "https://example.org/next", content: "b".repeat(500) },
  ], unresponsive_engines: [["duckduckgo", "CAPTCHA"]] });
  const result = await tools().execute("WebSearch", { query: "package documentation", allowed_domains: ["example.org"], blocked_domains: ["blocked.example.org"], count: 1, time_range: "week" });
  assert(result.ok); assert(result.content.includes("docs.example.org/topic"));
  assert(!result.content.includes("blocked.example.org/topic")); assert(!result.content.includes("notexample.org")); assert(!result.content.includes("Second official"));
  assert(result.content.includes("UNTRUSTED")); assert(result.content.includes("duckduckgo"));
  const url = new URL(calls[0].url);
  assert.equal(url.pathname, "/search"); assert.equal(url.searchParams.get("q"), "package documentation"); assert.equal(url.searchParams.get("format"), "json"); assert.equal(url.searchParams.get("time_range"), "week");
  assert.equal(calls[0].address.address, "93.184.216.34");
});
await check("private, loopback, mapped, reserved and nonstandard destinations are blocked before request", async () => {
  const blocked = ["http://127.0.0.1/", "http://2130706433/", "http://0x7f000001/", "http://10.0.0.1/", "http://169.254.169.254/", "http://[::1]/", "http://[::ffff:127.0.0.1]/", "http://[fc00::1]/", "http://[fe80::1]/", "http://localhost/", "http://service.internal/", "https://example.com:8443/", "file:///etc/passwd", "https://user:password@example.com/"];
  reply = async () => { throw new Error("must not send"); };
  for (const url of blocked) assert.equal((await tools().execute("WebFetch", { url })).ok, false, url);
  assert.equal(calls.length, 0);
  assert.equal(isPublicWebAddress("8.8.8.8"), true); assert.equal(isPublicWebAddress("2606:4700:4700::1111"), true);
  for (const address of ["100.64.0.1", "192.0.2.1", "198.51.100.2", "203.0.113.3", "224.0.0.1", "2001:db8::1", "2002:7f00:1::1"]) assert.equal(isPublicWebAddress(address), false, address);
});
await check("DNS mixed public/private answers and redirects to private hosts never connect", async () => {
  resolve = async () => [{ address: "93.184.216.34", family: 4 }, { address: "127.0.0.1", family: 4 }];
  assert.equal((await tools().execute("WebFetch", { url: "https://docs.example.com" })).ok, false); assert.equal(calls.length, 0);
  resolve = async () => [{ address: "93.184.216.34", family: 4 }];
  reply = async () => ({ status: 302, headers: { location: "http://169.254.169.254/latest/meta-data" }, body: "" });
  assert.equal((await tools().execute("WebFetch", { url: "https://docs.example.com" })).ok, false); assert.equal(calls.length, 1);
});
await check("public redirects revalidate DNS and HTML produces readable text without active content", async () => {
  reply = async () => calls.length === 1 ? { status: 302, headers: { location: "https://other.example.org/page" }, body: "" } : { status: 200, headers: { "content-type": "text/html" }, body: "<html><head><title>Private title</title><script>doNotReturn()</script></head><body><h1>Readable &amp; useful</h1><p>Line &#50;</p><style>hidden-css</style><noscript>hidden-noscript</noscript></body></html>" };
  const result = await tools().execute("WebFetch", { url: "https://docs.example.com" });
  assert(result.ok); assert(result.content.includes("Readable & useful")); assert(result.content.includes("Line 2"));
  for (const hidden of ["doNotReturn", "hidden-css", "hidden-noscript", "Private title"]) assert(!result.content.includes(hidden));
  assert.deepEqual(resolutions, ["docs.example.com", "other.example.org"]);
});
await check("queries, result text, URLs and errors cannot expose supplied secrets", async () => {
  reply = async () => json({ results: [{ title: secret, url: `https://docs.example.com/?key=${secret}`, content: secret }] });
  const result = await tools().execute("WebSearch", { query: `Find docs ${secret}` });
  assert(!JSON.stringify(calls).includes(secret)); assert(!result.content.includes(secret));
  calls = [];
  const denied = await tools().execute("WebFetch", { url: `https://docs.example.com/?api_key=${secret}` });
  assert.equal(denied.ok, false); assert.equal(calls.length, 0); assert(!denied.content.includes(secret));
  reply = async () => { throw new Error(`sensitive provider error ${secret}`); };
  const error = await tools().execute("WebFetch", { url: "https://docs.example.com/" });
  assert.equal(error.ok, false); assert(!error.content.includes(secret));
});
await check("disabled, expired, unsupported and malformed requests perform no network work", async () => {
  assert.equal((await tools({ enabled: false }).execute("WebSearch", { query: "docs" })).ok, false);
  assert.equal((await tools({ deadlineAt: Date.now() - 1 }).execute("WebFetch", { url: "https://docs.example.com" })).ok, false);
  assert.equal((await tools().execute("Shell", { command: "anything" })).ok, false);
  assert.equal((await tools().execute("WebSearch", { query: "docs", time_range: "forever" })).ok, false);
  assert.equal(calls.length, 0); assert.equal(resolutions.length, 0);
});
await check("search limits, response size, output truncation, and provider errors stay bounded", async () => {
  reply = async () => json({ results: Array.from({ length: 25 }, (_, i) => ({ title: `Title ${i}`, url: `https://docs.example.org/${i}`, content: "s".repeat(500) })) });
  const search = await tools().execute("WebSearch", { query: "docs", count: 100 });
  assert(search.ok); assert(search.content.includes("20 result")); assert(!search.content.includes("Title 20")); assert(!search.content.includes("s".repeat(301)));
  reply = async () => ({ status: 200, headers: { "content-type": "text/plain" }, body: "x".repeat(5000) });
  const page = await tools({ maxOutputChars: 1200 }).execute("WebFetch", { url: "https://docs.example.com" });
  assert(page.ok); assert(page.content.length <= 1200); assert(page.content.includes("truncated"));
  reply = async () => ({ status: 200, headers: {}, body: "x".repeat(2 * 1024 * 1024 + 1) });
  assert.equal((await tools().execute("WebFetch", { url: "https://docs.example.com" })).ok, false);
  reply = async () => ({ status: 403, headers: {}, body: secret });
  const failed = await tools().execute("WebSearch", { query: "docs" }); assert.equal(failed.ok, false); assert(!failed.content.includes(secret));
});
await check("DNS deadlines and public redirect loops stop within the assigned budget", async () => {
  resolve = async () => new Promise(() => {});
  const before = Date.now();
  const timedOut = await tools({ deadlineAt: before + 25 }).execute("WebFetch", { url: "https://docs.example.com" });
  assert.equal(timedOut.ok, false); assert(Date.now() - before < 1000); assert.equal(calls.length, 0);
  resolve = async () => [{ address: "93.184.216.34", family: 4 }];
  reply = async () => ({ status: 302, headers: { location: "/another-page" }, body: "" });
  assert.equal((await tools().execute("WebFetch", { url: "https://docs.example.com" })).ok, false);
  assert.equal(calls.length, 4);
});
console.log(`Verified ${passed} public web research groups; no live network requests.`);
