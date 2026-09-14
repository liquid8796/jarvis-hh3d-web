#!/usr/bin/env node
/** Offline public-metadata checks: no GitHub, database, auth, or publishing. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { renderReadme, renderWorkflow } from "./khoiloiPayload.mjs";
import {
  PUBLIC_IDENTITY_LAYOUT_COUNT,
  PUBLIC_IDENTITY_THEME_COUNT,
  publicIdentityForWorker,
} from "./githubPublicIdentity.mjs";
import { BACKEND_ENDPOINT_REDACTION as hidden, redactKnownBackendUrls as redact } from "./githubPublicMetadata.mjs";

let checks = 0;
function check(name, work) { work(); checks++; console.log(`✔ ${name}`); }
const endpoint = "https://backend.example.invalid";
const origins = [endpoint, "https://secondary.example.invalid:8443"];

check("one private identity always selects the same complete public identity", () => {
  assert.deepEqual(publicIdentityForWorker("fixture-worker"), publicIdentityForWorker("fixture-worker"));
  assert.equal(
    renderReadme({ workerId: "fixture-worker", webUrl: `${endpoint}/private-route` }),
    publicIdentityForWorker("fixture-worker").readme,
  );
});
check("the v1 corpus stays pinned instead of silently reshuffling every repository", () => {
  const snapshots = new Map([
    ["fixture-alpha-001", "cad4ca2b10fc89f5070b6b00d2380f1543c2b9c3ac95b56de61ce20eea18309c"],
    ["fixture-beta-002", "23ce397880df96ef07e2ca667ae29983f8bdd80900a9df108f396f883e1f2cbd"],
    ["fixture-gamma-003", "f5eb30b28e823458d8af1106e8b36fd572c18984a89801a998d6cf9eb1a61719"],
  ]);
  for (const [workerId, expected] of snapshots) {
    const actual = createHash("sha256").update(JSON.stringify(publicIdentityForWorker(workerId))).digest("hex");
    assert.equal(actual, expected);
  }
});
check("README never includes a configured backend URL", () => {
  const readme = renderReadme({ workerId: "fixture-worker", webUrl: `${endpoint}/api/worker?fixture=private` });
  assert.ok(!readme.includes("backend.example.invalid"));
  assert.ok(!readme.includes("private"));
});
check("public identities vary in topic, layout, About copy and display labels", () => {
  const identities = Array.from({ length: 192 }, (_, index) => publicIdentityForWorker(`fixture-private-identity-${index}`));
  assert.ok(new Set(identities.map((identity) => identity.themeId)).size >= PUBLIC_IDENTITY_THEME_COUNT - 1);
  assert.equal(new Set(identities.map((identity) => identity.layoutId)).size, PUBLIC_IDENTITY_LAYOUT_COUNT);
  assert.ok(new Set(identities.map((identity) => identity.aboutDescription)).size >= 30);
  assert.ok(new Set(identities.map((identity) => identity.workflowName)).size >= 30);
  assert.ok(new Set(identities.map((identity) => identity.jobName)).size >= 30);
});
check("public output contains no private identity, operational vocabulary or URL", () => {
  const forbidden = /\b(?:action|actions|agent|automation|automated|backend|background|build|cron|deploy|dispatch|endpoint|github|heartbeat|job|pipeline|repository|repo|runner|runtime|schedule|scheduled|scheduler|script|server|source|task|template|worker|workflow)\b|hh3d|jarvis|kh[oô]i[ -]?l[oỗ]i|linh[ -]?sư|t[oô]ng m[oô]n|https?:\/\/|www\./iu;
  for (let index = 0; index < 192; index++) {
    const workerId = `private-identity-${index}-do-not-publish`;
    const identity = publicIdentityForWorker(workerId);
    const publicText = [identity.readme, identity.aboutDescription, identity.workflowName, identity.jobName].join("\n");
    assert.ok(!publicText.toLowerCase().includes(workerId.toLowerCase()));
    assert.doesNotMatch(publicText, forbidden);
  }
  for (const workerId of ["clay", "book", "sky"]) {
    const identity = publicIdentityForWorker(workerId);
    const publicText = [identity.readme, identity.aboutDescription, identity.workflowName, identity.jobName].join("\n");
    assert.ok(!publicText.toLowerCase().includes(workerId), `${workerId} must trigger a deterministic reselection`);
  }
});
check("workflow receives public labels while its private key and endpoint routing stay unchanged", () => {
  const template = readFileSync(new URL("../deploy/github/linh-su.yml", import.meta.url), "utf8");
  const workerId = "fixture-worker";
  const identity = publicIdentityForWorker(workerId);
  const workflow = renderWorkflow({ template, workerId, webUrl: endpoint });
  assert.ok(workflow.includes(`name: "${identity.workflowName}"`));
  assert.ok(workflow.includes(`name: "${identity.jobName}"`));
  assert.match(workflow, /^jobs:\r?\n  linh-su:\r?\n    name:/m);
  assert.ok(workflow.includes(`WORKER_ID: ${workerId}`));
  assert.ok(workflow.includes(`vars.WEB_URL || '${endpoint}'`));
  assert.doesNotMatch(workflow, /__PUBLIC_(?:WORKFLOW|JOB)_NAME__/);
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
