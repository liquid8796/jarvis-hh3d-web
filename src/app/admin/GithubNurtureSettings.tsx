"use client";

import { useActionState, useState } from "react";
import {
  deleteGithubNurtureKeyAction,
  importGithubNurtureKeysAction,
  revealGithubNurtureKeyAction,
  saveGithubNurtureSettingsAction,
  setGithubNurtureKeyDisabledAction,
  type GithubNurtureView,
} from "@/app/actions/githubNurture";
import type { StationResult } from "@/app/actions/githubStations";
import {
  DEFAULT_OLLAMA_MODEL,
  DEFAULT_REFLECTION_MODEL,
  MAX_COMPANION_COUNT,
  MIN_OLLAMA_CONTEXT_WINDOW,
  MAX_OLLAMA_CONTEXT_WINDOW,
  DEFAULT_WEB_SEARCH_ENABLED,
  DEFAULT_SEARXNG_BASE_URL,
} from "@/lib/validation/githubNurture";

const when = (value: string | null) => value ? new Date(value).toLocaleString("vi-VN") : "chưa sử dụng";
const HEALTH: Record<GithubNurtureView["apiKeys"][number]["health"], string> = {
  disabled: "Đã tắt",
  cooldown: "Đang chờ",
  error: "Lỗi gần nhất",
  ready: "Sẵn sàng",
  unused: "Chưa dùng",
};

function Result({ result }: { result: StationResult | null }) {
  return result ? <p role="status" className={`text-sm ${result.ok ? "text-[var(--color-jade-300)]" : "text-[#f2a0a0]"}`}>{result.message}</p> : null;
}

function ProviderKeyReveal({ id, label, provider }: { id: string; label: string; provider: "ollama" | "reflection" }) {
  // Plain key stays in local component state ONLY while explicitly revealed.
  const [plainKey, setPlainKey] = useState<string | null>(null);
  const [revealing, setRevealing] = useState(false);
  const [notice, setNotice] = useState("");

  async function toggle() {
    if (plainKey !== null) {
      setPlainKey(null);
      setNotice("");
      return;
    }
    setRevealing(true);
    setNotice("");
    try {
      const result = await revealGithubNurtureKeyAction(id, provider);
      if (!result.ok) setNotice(result.message);
      else setPlainKey(result.key);
    } catch {
      setNotice("Không thể lấy API key lúc này. Vui lòng thử lại.");
    } finally {
      setRevealing(false);
    }
  }

  async function copy() {
    if (plainKey === null) return;
    try {
      await navigator.clipboard.writeText(plainKey);
      setNotice("Đã sao chép API key.");
    } catch {
      setNotice("Trình duyệt không cho sao chép tự động. Chọn khóa bên trên rồi nhấn Ctrl+C.");
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn btn-ghost px-3 py-1.5 text-xs"
          aria-pressed={plainKey !== null} disabled={revealing} onClick={toggle}>
          {revealing ? "Đang mở…" : plainKey === null ? "Hiện khóa" : "Ẩn khóa"}
        </button>
        {plainKey !== null && (
          <button type="button" className="btn btn-ghost px-3 py-1.5 text-xs" onClick={copy}>Sao chép</button>
        )}
      </div>
      {plainKey !== null && (
        <input aria-label={`Giá trị API key ${label}`} className="input w-full min-w-0 font-mono text-xs"
          type="text" readOnly autoComplete="off" spellCheck={false} value={plainKey}
          onFocus={(event) => event.currentTarget.select()} />
      )}
      {notice && <p role="status" className="break-words text-xs text-[var(--color-mist)]">{notice}</p>}
    </div>
  );
}

export type GithubNurtureSection = "ollama" | "keys";

export function GithubNurtureSettings({
  config,
  section,
}: {
  config: GithubNurtureView;
  section: GithubNurtureSection;
}) {
  const [saved, saveAction, saving] = useActionState<StationResult | null, FormData>(saveGithubNurtureSettingsAction, null);
  const [imported, importAction, importing] = useActionState<StationResult | null, FormData>(importGithubNurtureKeysAction, null);
  const [deleted, deleteAction, deleting] = useActionState<StationResult | null, FormData>(deleteGithubNurtureKeyAction, null);
  const [toggled, toggleAction, toggling] = useActionState<StationResult | null, FormData>(setGithubNurtureKeyDisabledAction, null);
  const [providerChoice, setProviderChoice] = useState<"ollama" | "reflection">(config.provider ?? "ollama");
  const [keyProvider, setKeyProvider] = useState<"ollama" | "reflection">(config.provider ?? "ollama");
  const activeKeys = keyProvider === "reflection" ? (config.reflectionApiKeys ?? []) : config.apiKeys;

  if (section === "ollama") {
    return (
      <section className="card card-hairline p-4 sm:p-5" aria-labelledby="github-ollama-title">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="github-ollama-title" className="h-display text-lg font-semibold text-gilded">Cấu hình AI provider</h2>
          <span className="text-xs text-[var(--color-mist)]">Áp dụng chung cho mọi kho phụ</span>
        </div>
        <form action={saveAction} className="mt-4 flex flex-col gap-4">
          <div className="grid gap-3 md:grid-cols-12">
            <div className="md:col-span-3">
              <label className="label" htmlFor="nurture-provider">AI provider</label>
              <select id="nurture-provider" name="provider" className="input w-full" value={providerChoice}
                onChange={event => setProviderChoice(event.target.value as "ollama" | "reflection")}>
                <option value="ollama">Ollama</option>
                <option value="reflection">Reflection</option>
              </select>
            </div>
            <div className="md:col-span-3">
              <label className="label" htmlFor="nurture-default-count">Số kho phụ mặc định</label>
              <input id="nurture-default-count" name="defaultCompanionCount" type="number" min={0} max={MAX_COMPANION_COUNT} step={1} required defaultValue={config.defaultCompanionCount} className="input w-full font-mono" />
            </div>
            <div className="md:col-span-6">
              <label className="label" htmlFor="nurture-model">Model Ollama</label>
              <input id="nurture-model" name="model" required maxLength={200} defaultValue={config.model} placeholder={DEFAULT_OLLAMA_MODEL} className="input w-full font-mono" />
            </div>
            <div className="md:col-span-6">
              <label className="label" htmlFor="nurture-reflection-model">Model Reflection</label>
              <input id="nurture-reflection-model" name="reflectionModel" required maxLength={200}
                defaultValue={config.reflectionModel ?? DEFAULT_REFLECTION_MODEL}
                placeholder={DEFAULT_REFLECTION_MODEL} className="input w-full font-mono" />
            </div>
            <div className="md:col-span-3">
              <label className="label" htmlFor="nurture-context">Context (token)</label>
              <input id="nurture-context" name="contextWindow" type="number" min={MIN_OLLAMA_CONTEXT_WINDOW} max={MAX_OLLAMA_CONTEXT_WINDOW} step={1} required defaultValue={config.contextWindow} className="input w-full font-mono" />
              <p className="mt-1 text-[11px] text-[var(--color-mist)]">
                {MIN_OLLAMA_CONTEXT_WINDOW.toLocaleString("vi-VN")}–{MAX_OLLAMA_CONTEXT_WINDOW.toLocaleString("vi-VN")}
              </p>
            </div>
            <label className="flex min-h-11 items-center gap-2 rounded-lg border border-[var(--color-ink-600)]/60 px-3 text-sm md:col-span-3" htmlFor="nurture-web-search">
              <input type="hidden" name="webSearchSettingsPresent" value="1" />
              <input id="nurture-web-search" name="webSearchEnabled" type="checkbox" defaultChecked={config.webSearchEnabled ?? DEFAULT_WEB_SEARCH_ENABLED} />
              Web search
            </label>
            <div className="min-w-0 md:col-span-9">
              <label className="label" htmlFor="nurture-searxng">SearXNG URL</label>
              <input id="nurture-searxng" name="searxngBaseUrl" type="url" required maxLength={2048} defaultValue={config.searxngBaseUrl ?? DEFAULT_SEARXNG_BASE_URL} placeholder={DEFAULT_SEARXNG_BASE_URL} className="input w-full min-w-0 font-mono text-sm" />
              <p className="mt-1 text-[11px] text-[var(--color-mist)]">HTTPS công khai · hỗ trợ JSON</p>
            </div>
          </div>
          <Result result={saved} />
          <button type="submit" className="btn btn-gold self-start" disabled={saving}>{saving ? "Đang lưu…" : "Lưu cấu hình AI"}</button>
        </form>
      </section>
    );
  }

  return (
    <section className="card card-hairline p-4 sm:p-5" aria-labelledby="github-keys-title">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="github-keys-title" className="h-display text-lg font-semibold text-gilded">API key {keyProvider === "reflection" ? "Reflection" : "Ollama"}</h2>
        <div className="flex items-center gap-2">
          <label htmlFor="nurture-key-provider" className="text-xs">Provider</label>
          <select id="nurture-key-provider" className="input" value={keyProvider}
            onChange={event => setKeyProvider(event.target.value as "ollama" | "reflection")}>
            <option value="ollama">Ollama</option><option value="reflection">Reflection</option>
          </select>
          <span className="text-xs text-[var(--color-mist)]">{activeKeys.length}/100 key</span>
        </div>
      </div>
      <form action={importAction} className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1.5fr)_minmax(16rem,1fr)]">
        <div>
          <input type="hidden" name="provider" value={keyProvider} />
          <label className="label" htmlFor="nurture-api-keys">Dán danh sách key</label>
          <textarea id="nurture-api-keys" name="apiKeys" rows={2} maxLength={262144} autoComplete="off" spellCheck={false} placeholder={'Mỗi dòng một key, hoặc JSON ["key-1", "key-2"]'} className="input w-full font-mono text-sm" />
        </div>
        <div className="flex min-w-0 flex-col justify-end gap-2">
          <label className="label" htmlFor="nurture-key-file">Hoặc tệp TXT / JSON</label>
          <input id="nurture-key-file" name="apiKeyFile" type="file" accept=".txt,.json,text/plain,application/json" className="input w-full text-sm" />
          <button type="submit" className="btn btn-ghost self-start" disabled={importing}>{importing ? "Đang mã hoá và nhập…" : "Nhập API key"}</button>
        </div>
        <div className="lg:col-span-2"><Result result={imported} /></div>
      </form>

      <div className="mt-4 flex flex-col gap-2">
          <Result result={deleted} />
          <Result result={toggled} />
          {activeKeys.length === 0 ? (
            <p className="py-8 text-center text-sm text-[var(--color-mist)]">Chưa có API key.</p>
          ) : (
            <div className="grid max-h-[28rem] gap-2 overflow-y-auto pr-1 md:grid-cols-2">
              {activeKeys.map((key) => (
                <div key={key.id} data-ollama-key-id={key.id} className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--color-ink-600)]/60 p-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium" title={`${key.label} ${key.maskedKey}`}>{key.label} <span className="font-mono text-[var(--color-mist)]">{key.maskedKey}</span></p>
                    <p className={`text-xs ${key.health === "error" ? "text-[#f2a0a0]" : "text-[var(--color-mist)]"}`}>{HEALTH[key.health]}{key.lastUsedAt ? ` · ${when(key.lastUsedAt)}` : ""}</p>
                    {key.cooldownUntil && <p className="text-[11px] text-[var(--color-mist)]">Chờ đến {when(key.cooldownUntil)}</p>}
                  </div>
                  <div className="flex min-w-0 shrink-0 flex-wrap items-start gap-2">
                    <ProviderKeyReveal id={key.id} label={key.label} provider={keyProvider} />
                    <form action={toggleAction}>
                      <input type="hidden" name="id" value={key.id} />
                      <input type="hidden" name="provider" value={keyProvider} />
                      <input type="hidden" name="disabled" value={String(!key.disabled)} />
                      <button type="submit" className="btn btn-ghost px-3 py-1.5 text-xs" disabled={toggling}>{key.disabled ? "Bật" : "Tạm tắt"}</button>
                    </form>
                    <form action={deleteAction} onSubmit={(event) => { if (!confirm(`Xoá ${key.label} khỏi sổ provider? Muốn dùng lại cần nhập lại key.`)) event.preventDefault(); }}>
                      <input type="hidden" name="id" value={key.id} />
                      <input type="hidden" name="provider" value={keyProvider} />
                      <button type="submit" className="btn btn-danger px-3 py-1.5 text-xs" disabled={deleting}>Xoá key</button>
                    </form>
                  </div>
                </div>
              ))}
            </div>
          )}
      </div>
    </section>
  );
}
