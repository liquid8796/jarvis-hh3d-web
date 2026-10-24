#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { encryptSecret } from "../src/lib/crypto/secretBox";
import { appSettingsSchema } from "../src/lib/services/settings";
import { createOllamaChatClient } from "../src/lib/services/ollamaChat";
import { createReflectionChatClient } from "../src/lib/services/reflectionChat";
import { LLM_REQUEST_TIMEOUT_MS, COMPANION_RUN_BUDGET_MS, boundedLlmTimeoutMs } from "../src/lib/services/llmTimeouts";

process.env.ENCRYPTION_KEY = "7".repeat(64);
const now = 1_800_000_000_000;
const key = (id: string) => ({
  id, label: "offline fixture", secret: encryptSecret("offline-" + id),
  disabled: false, cooldownUntil: null, lastUsedAt: null, lastError: "",
});
const config = appSettingsSchema.parse({
  githubNurture: {
    model: "beam:cloud",
    reflectionModel: "Beam-1.0-501B-A23B",
    contextWindow: 32768,
    apiKeys: [key("ollama")], reflectionApiKeys: [key("reflection")]
  }
}).githubNurture;
const response = (provider: "ollama" | "reflection") => provider === "ollama"
  ? Response.json({ message: { content: "OK" }, done: true })
  : Response.json({ choices: [{ message: { content: "OK" }, finish_reason: "stop" }] });

assert.equal(LLM_REQUEST_TIMEOUT_MS, 300_000, "Five minutes = 300000 ms");
assert(COMPANION_RUN_BUDGET_MS > LLM_REQUEST_TIMEOUT_MS + 60_000, "Task needs time for web/GitHub work after inference");
assert.equal(boundedLlmTimeoutMs(LLM_REQUEST_TIMEOUT_MS, 420_000), 300_000);
assert.equal(boundedLlmTimeoutMs(LLM_REQUEST_TIMEOUT_MS, 15_000), 15_000);
assert.equal(boundedLlmTimeoutMs(LLM_REQUEST_TIMEOUT_MS, 0), 1);

const originalSetTimeout = globalThis.setTimeout;
let observed: number[] = [];
globalThis.setTimeout = ((callback: (...args: any[]) => void, milliseconds?: number, ...args: any[]) => {
  observed.push(Number(milliseconds));
  return originalSetTimeout(callback, milliseconds, ...args);
}) as typeof setTimeout;
try {
  for (const provider of ["ollama", "reflection"] as const) {
    for (const [name, duration, override] of [
      ["full request", 420_000, undefined],
      ["short caller deadline", 12_000, undefined],
      ["explicit shorter request", 420_000, 2_000],
    ] as const) {
      observed = [];
      const client = (provider === "ollama" ? createOllamaChatClient : createReflectionChatClient)({
        config: structuredClone(config),
        now: () => now,
        deadlineAt: now + duration,
        fetch: async () => response(provider),
        ...(override === undefined ? {} : { requestTimeoutMs: override }),
      });
      assert.equal((await client.request([{ role: "user", content: "OK" }])).content, "OK");
      assert.equal(observed[0], Math.min(override ?? 300_000, duration), provider + ": " + name);
    }
  }
} finally {
  globalThis.setTimeout = originalSetTimeout;
}
const read = (path: string) => readFileSync(new URL("../" + path, import.meta.url), "utf8");
assert(read("src/lib/services/companionNurture.ts").includes("Date.now() + COMPANION_RUN_BUDGET_MS"));
assert(read("src/app/actions/githubStations.ts").includes("startedAt + COMPANION_RUN_BUDGET_MS"));
assert(read("src/app/api/cron/route.ts").includes("routeStartedAt + COMPANION_RUN_BUDGET_MS"));
assert(read("src/app/api/cron/route.ts").includes("export const maxDuration = 480"));
assert(read("deploy/oracle/jarvis-companions.service").includes("TimeoutStartSec=510"));
assert(read("deploy/oracle/jarvis-companions.service").includes("curl -fsS -m 480"));
console.log("PASS: Ollama/Reflection 300s default, shorter deadline/override, 420s companion run, 480s cron, 510s OCI service.");
