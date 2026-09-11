import { decryptSecret } from "@/lib/crypto/secretBox";
import type { AppSettings } from "./settings";

export type OllamaToolCall = { function: { name: string; arguments: Record<string, unknown> } };
export type OllamaMessage = { role: "system" | "user" | "assistant" | "tool"; content: string; tool_calls?: OllamaToolCall[]; tool_name?: string };
export type OllamaReply = { content: string; tool_calls?: unknown[] };
type Config = AppSettings["githubNurture"];
type Key = Config["apiKeys"][number];
const API_URL = "https://ollama.com/api/chat";

export function redactOllamaSecrets(text: string, secrets: readonly string[]): string {
  let clean = text;
  for (const secret of secrets) if (secret) clean = clean.split(secret).join("[REDACTED]");
  return clean
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "[REDACTED PRIVATE KEY]")
    .replace(/\b(?:github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9_-]{20,}|AKIA[A-Z0-9]{16})\b/g, "[REDACTED TOKEN]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]{12,}=*/gi, "Bearer [REDACTED]")
    .replace(/((?:api[_-]?key|access[_-]?token|password|client[_-]?secret|secret[_-]?access[_-]?key)["']?\s*[=:]\s*["']?)[A-Za-z0-9._~+/-]{16,}/gi, "$1[REDACTED]")
    .replace(/\b((?:postgres(?:ql)?|mongodb(?:\+srv)?|mysql|https?):\/\/)[^\s:/@]+:[^\s/@]+@/gi, "$1[REDACTED]@");
}

function retryAt(header: string | null, now: number, defaultDelay = 60000): string {
  const seconds = header?.trim() ? Number(header) : NaN;
  const timestamp = Number.isFinite(seconds) && seconds >= 0 ? now + seconds * 1000 : Date.parse(header ?? "");
  const usable = Number.isFinite(timestamp) && timestamp > now && timestamp <= 8.64e15 ? timestamp : now + defaultDelay;
  return new Date(usable).toISOString();
}

async function readBounded(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) throw new Error("Empty Ollama response.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) { await reader.cancel(); throw new Error("Ollama response exceeds the safe size limit."); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks).toString("utf8");
}

/** Native cloud transport shared by coding and naming. Mutates only supplied key health. */
export function createOllamaChatClient(options: {
  config: Config;
  deadlineAt: number;
  now?: () => number;
  fetch?: typeof globalThis.fetch;
  outputTokens?: number;
  maxResponseBytes?: number;
  requestTimeoutMs?: number;
}) {
  const { config, deadlineAt } = options;
  const now = options.now ?? Date.now;
  const fetcher = options.fetch ?? globalThis.fetch;
  const outputTokens = options.outputTokens ?? Math.min(16384, Math.floor(config.contextWindow / 4));
  const maxResponseBytes = options.maxResponseBytes ?? 2 * 1024 * 1024;
  const requestTimeoutMs = options.requestTimeoutMs ?? 60000;
  if (!Number.isFinite(deadlineAt) || deadlineAt <= now()) throw new Error("Ollama decision deadline has expired.");
  if (!Number.isInteger(config.contextWindow) || config.contextWindow < 8192 || config.contextWindow > 2000000) throw new Error("Invalid Ollama context window; use at least 8192 tokens.");
  const model = config.model.trim().replace(/-cloud$/i, "").replace(/:cloud$/i, "");
  if (!model || model.length > 200 || /[\x00-\x1f\x7f]/.test(model)) throw new Error("Invalid Ollama model identifier.");
  const keySecrets = new Map<Key, string>();
  for (const key of config.apiKeys) {
    try {
      const secret = decryptSecret(key.secret).trim();
      if (secret) keySecrets.set(key, secret);
      else if (!key.disabled) key.lastError = "Ollama API key is empty.";
    } catch {
      key.disabled = true;
      key.lastError = "Unable to decrypt this Ollama API key; save the key again.";
    }
  }
  const secrets = [...keySecrets.values()];
  const failed = new Set<Key>();
  let preferred: Key | undefined;

  async function request(messages: OllamaMessage[], requestOptions: { tools?: readonly unknown[]; temperature?: number } = {}): Promise<OllamaReply> {
    const eligible = config.apiKeys.filter((key) => !key.disabled && !failed.has(key) && keySecrets.has(key) && (!key.cooldownUntil || Date.parse(key.cooldownUntil) <= now()))
      .sort((a, b) => (a === preferred ? -1 : b === preferred ? 1 : (Date.parse(a.lastUsedAt ?? "") || 0) - (Date.parse(b.lastUsedAt ?? "") || 0)));
    if (!eligible.length) throw new Error("No eligible Ollama API key; add a key or wait for its cooldown.");
    for (const key of eligible) {
      const remaining = deadlineAt - now();
      if (remaining <= 0) throw new Error("Ollama decision deadline has expired.");
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), Math.min(requestTimeoutMs, remaining));
      key.lastUsedAt = new Date(now()).toISOString();
      try {
        const response = await fetcher(API_URL, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${keySecrets.get(key)}` }, body: JSON.stringify({ model, messages, stream: false, options: { num_predict: outputTokens, ...(requestOptions.temperature === undefined ? {} : { temperature: requestOptions.temperature }) }, ...(requestOptions.tools ? { tools: requestOptions.tools } : {}) }), signal: controller.signal, redirect: "error" });
        if (!response.ok) {
          await response.body?.cancel();
          if ([401, 402, 403, 429].includes(response.status)) {
            failed.add(key);
            if (response.status === 429 || response.status === 402) {
              key.cooldownUntil = retryAt(response.headers.get("Retry-After"), now(), response.status === 402 ? 3600000 : 60000);
              key.lastError = response.status === 402 ? "Ollama key quota is exhausted; waiting before another attempt." : "Ollama rate limit reached; waiting for the provider cooldown.";
            } else {
              key.disabled = true;
              key.lastError = `Ollama authentication rejected this key (HTTP ${response.status}); replace or re-enable it after checking access.`;
            }
            continue;
          }
          key.lastError = `Ollama request failed (HTTP ${response.status}); check model/service availability.`;
          throw new Error(key.lastError);
        }
        const raw = await readBounded(response, maxResponseBytes);
        let payload: { message?: { content?: unknown; tool_calls?: unknown }; error?: unknown };
        try { payload = JSON.parse(raw); } catch { throw new Error("Ollama returned an invalid response envelope."); }
        if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("Ollama returned an invalid response envelope.");
        if (payload.error || !payload.message || (typeof payload.message.content !== "string" && !Array.isArray(payload.message.tool_calls))) throw new Error("Ollama returned no usable decision; check model/service availability.");
        preferred = key;
        key.cooldownUntil = null;
        key.lastError = "";
        return { content: typeof payload.message.content === "string" ? payload.message.content : "", tool_calls: Array.isArray(payload.message.tool_calls) ? payload.message.tool_calls : undefined };
      } catch (error) {
        // Raw provider bodies, request URLs, headers and transport exceptions are
        // deliberately never placed in storage, prompts or user-visible errors.
        const own = error instanceof Error && /^(?:Ollama (?:request failed \(HTTP \d+\); check model\/service availability\.|response exceeds the safe size limit\.|returned an invalid response envelope\.|returned no usable decision; check model\/service availability\.)|Empty Ollama response\.)$/.test(error.message);
        const message = own ? (error as Error).message : controller.signal.aborted ? "Ollama request timed out within the task deadline." : "Ollama request could not reach the provider.";
        key.lastError = message;
        throw new Error(message);
      } finally { clearTimeout(timer); }
    }
    throw new Error("All eligible Ollama API keys are unavailable or cooling down.");
  }

  return { secrets, outputTokens, request };
}
