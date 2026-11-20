import assert from "node:assert/strict";
import { encryptSecret } from "../src/lib/crypto/secretBox";
import { enrichNewGithubProfile } from "../src/lib/services/githubProfileEnrichment";
import type { AppSettings } from "../src/lib/services/settings";

process.env.ENCRYPTION_KEY = "4".repeat(64);
type Settings = Pick<AppSettings, "githubNurture" | "githubStations">;
const key = (id: string) => ({
  id, label: "Test", secret: encryptSecret("test-only-" + id),
  disabled: false, cooldownUntil: null, lastUsedAt: null, lastError: "",
});
function settings(provider: "reflection" | "ollama", reflectionKeys = true): Settings {
  return {
    githubStations: [],
    githubNurture: {
      provider, defaultCompanionCount: 1, contextWindow: 32768,
      model: "sample:cloud", reflectionModel: "Beam-1.0-501B-A23B",
      apiKeys: [key("ollama")], reflectionApiKeys: reflectionKeys ? [key("reflection")] : [],
    },
  };
}
const bio = { name: "Example Builder", bio: "Developing small utilities for everyday software tasks.",
  company: "Independent", location: "Remote", blog: "" };
const success = () => new Response(JSON.stringify({
  choices: [{ message: { content: JSON.stringify(bio) }, finish_reason: "stop" }],
}), { status: 200 });
const opt = { pat: "dummy", login: "fixture-user", deadlineAt: Date.now() + 90_000 };
let calls: string[] = [];
let modelBody: Record<string, unknown> = {};
const fakeFetch: typeof fetch = async (url, init) => {
  calls.push(String(url));
  if (String(url).includes("reflection.ai")) {
    modelBody = JSON.parse(String(init?.body));
    return success();
  }
  if (String(url) === "https://api.github.com/user") {
    assert.deepEqual(JSON.parse(String(init?.body)), bio);
    return new Response("{}", { status: 200 });
  }
  throw new Error("Unexpected provider endpoint");
};
const warnings = await enrichNewGithubProfile(opt, {
  readSettings: async () => settings("reflection"), fetch: fakeFetch,
});
assert.deepEqual(calls, [
  "https://api.reflection.ai/openai/v1/chat/completions", "https://api.github.com/user",
]);
assert.equal(modelBody.model, "Beam-1.0-501B-A23B");
assert.deepEqual(modelBody.response_format, { type: "json_object" });
assert.equal(warnings.length, 1);
assert.match(warnings[0], /Avatar GitHub/);

calls = [];
const unavailable = await enrichNewGithubProfile(opt, {
  readSettings: async () => settings("reflection", false),
  fetch: async (url) => { calls.push(String(url)); throw Error("No requests expected"); },
});
assert.deepEqual(calls, [], "No silent fallback to configured Ollama keys");
assert.match(unavailable[0], /Reflection/);
assert.doesNotMatch(unavailable[0], /Ollama/);
console.log("PASS: profile enrichment selects Reflection, sends JSON, and never falls back to Ollama.");
