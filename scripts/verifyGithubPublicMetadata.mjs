#!/usr/bin/env node
/** Offline public-metadata checks: no GitHub, database, auth, or publishing. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderReadme, renderWorkflow } from "./khoiloiPayload.mjs";
import { BACKEND_ENDPOINT_REDACTION as hidden, redactKnownBackendUrls as redact } from "./githubPublicMetadata.mjs";

let checks = 0;
function check(name, work) { work(); checks++; console.log(`✔ ${name}`); }
const endpoint = "https://backend.example.invalid";
const origins = [endpoint, "https://secondary.example.invalid:8443"];

check("README keeps its existing factual prose and omits only the endpoint disclosure", () => {
  assert.equal(renderReadme({ workerId: "fixture-worker", webUrl: `${endpoint}/private-route` }),
    "# fixture-worker\n\n" +
    "Scheduled background task runner.\n\n" +
    "Generated from an upstream template — do not edit here. Edit upstream and redeploy, or the\n" +
    "two copies will drift apart.\n");
});
check("README never includes a configured backend URL", () => {
  const readme = renderReadme({ workerId: "fixture-worker", webUrl: `${endpoint}/api/worker?fixture=private` });
  assert.ok(!readme.includes("backend.example.invalid"));
  assert.ok(!readme.includes("private"));
});
check("operational workflow still receives its configured endpoint", () => {
  const template = readFileSync(new URL("../deploy/github/linh-su.yml", import.meta.url), "utf8");
  const workflow = renderWorkflow({ template, workerId: "fixture-worker", webUrl: endpoint });
  assert.ok(workflow.includes(`vars.WEB_URL || '${endpoint}'`));
});
check("known URLs are redacted including path, query and fragment", () => {
  assert.equal(redact(`Endpoint: ${endpoint}/api/worker?fixture=private#status`, origins), `Endpoint: ${hidden}`);
});
check("matching is case-insensitive for URL scheme and hostname", () => {
  assert.equal(redact("HTTPS://BACKEND.EXAMPLE.INVALID/api", origins), hidden);
});
check("an empty allowlist preserves all input bytes", () => {
  const input = `Endpoint: ${endpoint}\r\n[Docs](https://docs.example.invalid/start)\r\n`;
  assert.equal(redact(input, []), input);
});
check("unrelated public links remain byte-identical", () => {
  const input = "[Docs](https://docs.example.invalid/start?q=1#help \"Reference\") and https://github.com/example/project.";
  assert.equal(redact(input, origins), input);
});
check("host lookalikes and regex metacharacter lookalikes are not redacted", () => {
  const input = "https://backend.example.invalid.evil.test https://backendXexampleXinvalid https://backend-example.invalid";
  assert.equal(redact(input, origins), input);
});
check("scheme and port remain part of the explicit origin boundary", () => {
  const input = "http://backend.example.invalid https://backend.example.invalid:8443 https://secondary.example.invalid:8443/status";
  assert.equal(redact(input, origins), `http://backend.example.invalid https://backend.example.invalid:8443 ${hidden}`);
});
check("sentence punctuation and CRLF are preserved", () => {
  assert.equal(redact(`See ${endpoint}/api.\r\nThen (${endpoint}/health).\r\n`, origins), `See ${hidden}.\r\nThen (${hidden}).\r\n`);
});
check("backend Markdown links keep their visible factual label and title", () => {
  assert.equal(redact(`[Worker API](${endpoint}/api \"Polling endpoint\")`, origins), `Worker API (Polling endpoint) ${hidden}`);
});
check("backend autolinks are replaced without broken markup", () => {
  assert.equal(redact(`Connect to <${endpoint}/api>.`, origins), `Connect to ${hidden}.`);
});
check("a backend URL used as its own link label is also removed", () => {
  const value = redact(`[${endpoint}](${endpoint}/api)`, origins);
  assert.ok(!value.includes(endpoint));
});
check("redaction is idempotent", () => {
  const once = redact(`Scheduled background task runner. Endpoint: ${endpoint}/api`, origins);
  assert.equal(redact(once, origins), once);
  assert.ok(once.startsWith("Scheduled background task runner."));
});
check("IPv6 origin brackets remain part of the address rather than sentence punctuation", () => {
  assert.equal(redact("Endpoint: https://[2001:db8::1].", ["https://[2001:db8::1]"]), `Endpoint: ${hidden}.`);
});
check("invalid origins fail explicitly instead of broadening redaction", () => {
  for (const value of ["backend.example.invalid", "file:///tmp/backend", `${endpoint}/api`, `${endpoint}?q=1`, "https://user:pass@backend.example.invalid"]) {
    assert.throws(() => redact("factual metadata", [value]), /backend origin|Backend origins/);
  }
});

console.log(`\n✔ ${checks} public metadata checks — endpoint privacy with operational behavior unchanged.`);
