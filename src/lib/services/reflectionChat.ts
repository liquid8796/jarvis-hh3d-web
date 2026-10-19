import { decryptSecret } from "@/lib/crypto/secretBox";
import type { AppSettings } from "./settings";
import type { OllamaMessage, OllamaReply } from "./ollamaChat";
type Config = AppSettings["githubNurture"];
type Key = NonNullable<Config["reflectionApiKeys"]>[number];
const ENDPOINT = "https://api.reflection.ai/openai/v1/chat/completions";
async function readLimited(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) throw new Error("Reflection response too large.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const {done, value} = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) { await reader.cancel(); throw new Error("Reflection response too large."); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks).toString("utf8");
}
/** Keep only official machine-readable error codes and parameter paths, not provider messages. */
function sanitizedApiError(status: number, raw: string): string {
  const generic = "Reflection HTTP error " + status;
  try {
    const data: unknown = JSON.parse(raw);
    if (!data || typeof data !== "object" || Array.isArray(data)) return generic;
    const error = (data as {error?: unknown}).error;
    if (!error || typeof error !== "object" || Array.isArray(error)) return generic;
    const {code, param} = error as {code?: unknown; param?: unknown};
    if (typeof code !== "string" || !/^[a-z][a-z0-9_]{1,60}$/.test(code)) return generic;
    const validParam = typeof param === "string" && param.length <= 100 &&
      /^[A-Za-z_]/.test(param) &&
      [...param].every(char => char === "[" || char === "]" || /^[A-Za-z0-9_.-]$/.test(char));
    const location = validParam ? "; " + param : "";
    return "Reflection HTTP " + status + " (" + code + location + ")";
  } catch { return generic; }
}
function retryAt(header: string | null, now: number, fallback: number) {
  const secs = Number(header);
  const date = header && Number.isFinite(secs) ? now + secs * 1000 : Date.parse(header ?? "");
  return new Date(Number.isFinite(date) && date > now ? date : now + fallback).toISOString();
}
export function createReflectionChatClient(options: {
  config: Config; deadlineAt: number; now?: () => number; fetch?: typeof globalThis.fetch;
  outputTokens?: number; requestTimeoutMs?: number; maxResponseBytes?: number;
}) {
  const now = options.now ?? Date.now;
  const fetcher = options.fetch ?? globalThis.fetch;
  const config = options.config;
  const outputTokens = options.outputTokens ?? Math.min(32768, Math.floor(config.contextWindow / (config.contextWindow >= 32768 ? 2 : 4)));
  const model = (config.reflectionModel ?? "Beam-1.0-501B-A23B").trim();
  if (!model || model.length > 200) throw new Error("Invalid Reflection model.");
  if (options.deadlineAt <= now()) throw new Error("Reflection deadline expired.");
  const keys = config.reflectionApiKeys ?? [];
  const secretsByKey = new Map<Key, string>();
  for (const key of keys) {
    try {
      const secret = decryptSecret(key.secret).trim();
      if (secret) secretsByKey.set(key, secret);
      else key.lastError = "Empty Reflection key.";
    } catch {
      key.disabled = true;
      key.lastError = "Unable to decrypt Reflection key.";
    }
  }
  const secrets = [...secretsByKey.values()];
  const attempted = new Set<Key>();
  let preferred: Key | undefined;

  async function request(messages: OllamaMessage[], opts: {
    tools?: readonly unknown[]; temperature?: number; format?: "json"; think?: boolean;
  } = {}): Promise<OllamaReply> {
    const eligible = keys.filter(k => !k.disabled && !attempted.has(k) && secretsByKey.has(k) &&
      (!k.cooldownUntil || Date.parse(k.cooldownUntil) <= now()))
      .sort((a, b) => a === preferred ? -1 : b === preferred ? 1 :
        (Date.parse(a.lastUsedAt ?? "") || 0) - (Date.parse(b.lastUsedAt ?? "") || 0));
    if (!eligible.length) throw new Error("No eligible Reflection API key.");
    const conversation = messages.map(m => {
      if (m.role === "tool") return {role: "tool", content: m.content, tool_call_id: m.tool_call_id};
      if (m.role === "assistant" && m.tool_calls?.length) return {
        role: "assistant", content: m.content || null,
        reasoning_content: m.reasoning_content ?? null,
        tool_calls: m.tool_calls.map((call, index) => ({
          type: "function", id: call.id ?? ("call_" + index),
          function: {name: call.function.name, arguments: JSON.stringify(call.function.arguments)}
        }))
      };
      return {role: m.role, content: m.content};
    });
    for (const key of eligible) {
      const remaining = options.deadlineAt - now();
      if (remaining <= 0) throw new Error("Reflection deadline expired.");
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), Math.min(remaining, options.requestTimeoutMs ?? 60000));
      key.lastUsedAt = new Date(now()).toISOString();
      try {
        const response = await fetcher(ENDPOINT, {
          method: "POST",
          headers: {"Content-Type": "application/json", Authorization: "Bearer " + secretsByKey.get(key)},
          body: JSON.stringify({
            model, messages: conversation, stream: false, max_completion_tokens: outputTokens,
            reasoning_effort: "max",
            ...(opts.temperature === undefined ? {} : {temperature: opts.temperature}),
            ...(opts.tools ? {tools: opts.tools, tool_choice: "auto"} : {}),
            ...(opts.format === "json" ? {response_format: {type: "json_object"}} : {})
          }),
          signal: controller.signal, redirect: "error"
        });

        if (!response.ok) {
          // Error bodies are bounded and reduced to validated error.code / error.param only.
          // Never persist or display error.message, headers, request content or credentials.
          const details = await readLimited(response, 4096).catch(() => "");
          const diagnostic = sanitizedApiError(response.status, details);
          if ([401, 402, 403, 429].includes(response.status)) {
            attempted.add(key);
            if (response.status === 402 || response.status === 429) {
              key.cooldownUntil = retryAt(response.headers.get("Retry-After"), now(), response.status === 402 ? 3600000 : 60000);
              key.lastError = diagnostic;
            } else {
              key.disabled = true;
              key.lastError = diagnostic;
            }
            continue;
          }
          key.lastError = diagnostic;
          throw new Error(key.lastError);
        }
        const raw = await readLimited(response, options.maxResponseBytes ?? 2097152);
        let payload: {choices?: Array<{message?: {
          content?: unknown; tool_calls?: unknown; reasoning_content?: unknown;
        }; finish_reason?: unknown}>};
        try {payload = JSON.parse(raw);}
        catch {throw new Error("Reflection invalid response JSON.");}
        const choice = payload.choices?.[0], message = choice?.message;
        const truncated = choice?.finish_reason === "length";
        if (!message || (typeof message.content !== "string" && !Array.isArray(message.tool_calls) && !truncated))
          throw new Error("Reflection returned no usable response.");
        preferred = key; key.cooldownUntil = null; key.lastError = "";
        return {
          content: typeof message.content === "string" ? message.content : "",
          tool_calls: Array.isArray(message.tool_calls) ? message.tool_calls : undefined,
          reasoning_content: typeof message.reasoning_content === "string" ? message.reasoning_content : undefined,
          doneReason: truncated ? "length" : typeof choice?.finish_reason === "string" ? choice.finish_reason : undefined,
        };
      } catch(error) {
        // Never place response bodies, headers, credential text, or transport details in logs.
        const sameHttpError = error instanceof Error && error.message === key.lastError &&
          /^Reflection HTTP (?:error )?[0-9]{3}(?: \([a-z][a-z0-9_]{1,60}(?:; [A-Za-z0-9_.\[\]-]{1,100})?\))?$/.test(error.message);
        const safe = sameHttpError || (error instanceof Error &&
          /^(?:Reflection (?:response too large|invalid response JSON|returned no usable response))$/.test(error.message));
        const message = safe ? (error as Error).message :
          controller.signal.aborted ? "Reflection request timed out." : "Reflection request could not reach provider.";
        key.lastError = message; throw new Error(message);
      } finally {clearTimeout(timer);}
    }
    throw new Error("All eligible Reflection API keys are unavailable or cooling down.");
  }
  return {secrets, outputTokens, request};
}
