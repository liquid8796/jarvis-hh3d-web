/**
 * Five minutes per Ollama / Reflection request. A caller may specify a
 * shorter request timeout, and every fetch remains bounded by its task deadline.
 */
export const LLM_REQUEST_TIMEOUT_MS = 5 * 60_000;
/**
 * Companion runs need extra time for context reads, possible web-search rounds,
 * checkpoints and GitHub writes after a slow inference. Not an HTTP timeout.
 */
export const COMPANION_RUN_BUDGET_MS = 7 * 60_000;

export function boundedLlmTimeoutMs(requestLimitMs: number, remainingMs: number): number {
  return Math.max(1, Math.min(requestLimitMs, remainingMs));
}
