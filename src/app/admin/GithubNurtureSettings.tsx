"use client";

import { useActionState } from "react";
import {
  deleteGithubNurtureKeyAction,
  importGithubNurtureKeysAction,
  saveGithubNurtureSettingsAction,
  setGithubNurtureKeyDisabledAction,
  type GithubNurtureView,
} from "@/app/actions/githubNurture";
import type { StationResult } from "@/app/actions/githubStations";
import {
  DEFAULT_OLLAMA_MODEL,
  DEFAULT_OLLAMA_CONTEXT_WINDOW,
  MAX_COMPANION_COUNT,
  MIN_OLLAMA_CONTEXT_WINDOW,
  MAX_OLLAMA_CONTEXT_WINDOW,
  DEFAULT_WEB_SEARCH_ENABLED,
  DEFAULT_SEARXNG_BASE_URL,
} from "@/lib/validation/githubNurture";

const when = (value: string | null) => value ? new Date(value).toLocaleString("vi-VN") : "chưa sử dụng";
const HEALTH: Record<GithubNurtureView["apiKeys"][number]["health"], string> = {
  disabled: "Đã tắt",
  cooldown: "Đang chờ giới hạn API",
  error: "Lượt dùng gần nhất bị lỗi",
  ready: "Lượt dùng gần nhất thành công",
  unused: "Chưa kiểm tra",
};

function Result({ result }: { result: StationResult | null }) {
  return result ? <p role="status" className={`text-sm ${result.ok ? "text-[var(--color-jade-300)]" : "text-[#f2a0a0]"}`}>{result.message}</p> : null;
}

export function GithubNurtureSettings({ config }: { config: GithubNurtureView }) {
  const [saved, saveAction, saving] = useActionState<StationResult | null, FormData>(saveGithubNurtureSettingsAction, null);
  const [imported, importAction, importing] = useActionState<StationResult | null, FormData>(importGithubNurtureKeysAction, null);
  const [deleted, deleteAction, deleting] = useActionState<StationResult | null, FormData>(deleteGithubNurtureKeyAction, null);
  const [toggled, toggleAction, toggling] = useActionState<StationResult | null, FormData>(setGithubNurtureKeyDisabledAction, null);

  return (
    <section className="card card-hairline p-6">
      <h2 className="h-display text-lg font-semibold text-gilded">Ollama · quản lý kho phần mềm phụ</h2>
      <p className="mt-2 max-w-prose text-sm text-[var(--color-mist)]">
        Model chọn ý tưởng, phát triển phần mềm và quyết định thời điểm làm tiếp. Số kho mặc định áp dụng
        cho từng kho khôi lỗi; có thể ghi đè tại trang chi tiết. Chỉ tạo hoặc cập nhật khi vòng nuôi chạy.
      </p>
      <form action={saveAction} className="mt-5 flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label className="label" htmlFor="nurture-default-count">Số kho phụ mặc định</label>
            <input id="nurture-default-count" name="defaultCompanionCount" type="number" min={0} max={MAX_COMPANION_COUNT} step={1} required defaultValue={config.defaultCompanionCount} className="input w-full font-mono" />
          </div>
          <div className="sm:col-span-2">
            <label className="label" htmlFor="nurture-model">Model Ollama</label>
            <input id="nurture-model" name="model" required maxLength={200} defaultValue={config.model} placeholder={DEFAULT_OLLAMA_MODEL} className="input w-full font-mono" />
          </div>
        </div>
        <div className="max-w-sm">
          <label className="label" htmlFor="nurture-context">Context window (token)</label>
          <input id="nurture-context" name="contextWindow" type="number" min={MIN_OLLAMA_CONTEXT_WINDOW} max={MAX_OLLAMA_CONTEXT_WINDOW} step={1} required defaultValue={config.contextWindow} className="input w-full font-mono" />
          <p className="mt-1 text-xs text-[var(--color-mist)]">Mặc định {DEFAULT_OLLAMA_CONTEXT_WINDOW.toLocaleString("vi-VN")}; giới hạn source và lịch sử gửi vào model. Với Ollama Cloud, context tối đa thực tế do nhà cung cấp quyết định.</p>
        </div>
        <fieldset className="min-w-0 rounded-xl border border-[var(--color-ink-600)]/60 p-4">
          <legend className="px-1 font-medium text-[var(--color-parchment)]">Tra cứu tài liệu cho model</legend>
          <input type="hidden" name="webSearchSettingsPresent" value="1" />
          <label className="flex items-center gap-2 text-sm" htmlFor="nurture-web-search">
            <input id="nurture-web-search" name="webSearchEnabled" type="checkbox" defaultChecked={config.webSearchEnabled ?? DEFAULT_WEB_SEARCH_ENABLED} />
            Web search &amp; đọc trang
          </label>
          <div className="mt-3">
            <label className="label" htmlFor="nurture-searxng">SearXNG URL</label>
            <input id="nurture-searxng" name="searxngBaseUrl" type="url" required maxLength={2048} defaultValue={config.searxngBaseUrl ?? DEFAULT_SEARXNG_BASE_URL} placeholder={DEFAULT_SEARXNG_BASE_URL} className="input w-full min-w-0 font-mono text-sm" />
            <p className="mt-1 text-xs text-[var(--color-mist)]">Instance cần bật định dạng kết quả JSON. Dùng HTTPS công khai; có thể nhập URL gốc hoặc /search. Model chỉ tìm kiếm và đọc trang khi cần tài liệu để phát triển kho phụ.</p>
          </div>
        </fieldset>
        <Result result={saved} />
        <button type="submit" className="btn btn-gold self-start" disabled={saving}>{saving ? "Đang lưu…" : "Lưu cấu hình Ollama"}</button>
      </form>

      <div className="mt-7 border-t border-[var(--color-ink-600)]/60 pt-5">
        <h3 className="font-semibold text-[var(--color-parchment)]">API key Ollama ({config.apiKeys.length})</h3>
        <p className="mt-1 text-xs text-[var(--color-mist)]">Key được mã hoá khi lưu. Vòng nuôi luân phiên các key khả dụng và tạm chờ key chạm giới hạn.</p>
        <form action={importAction} className="mt-4 flex flex-col gap-3">
          <div>
            <label className="label" htmlFor="nurture-api-keys">Dán danh sách key</label>
            <textarea id="nurture-api-keys" name="apiKeys" rows={4} maxLength={262144} autoComplete="off" spellCheck={false} placeholder={'Mỗi dòng một key, hoặc JSON ["key-1", "key-2"]'} className="input w-full font-mono text-sm" />
          </div>
          <div>
            <label className="label" htmlFor="nurture-key-file">Hoặc tải lên tệp TXT / JSON</label>
            <input id="nurture-key-file" name="apiKeyFile" type="file" accept=".txt,.json,text/plain,application/json" className="input w-full text-sm" />
            <p className="mt-1 text-xs text-[var(--color-mist)]">Tối đa 256 KiB và 100 key. Hỗ trợ danh sách chuỗi hoặc đối tượng có trường key; key trùng được bỏ qua.</p>
          </div>
          <Result result={imported} />
          <button type="submit" className="btn btn-ghost self-start" disabled={importing}>{importing ? "Đang mã hoá và nhập…" : "Nhập API key"}</button>
        </form>

        <div className="mt-4 flex flex-col gap-2">
          <Result result={deleted} />
          <Result result={toggled} />
          {config.apiKeys.length === 0 && <p className="text-sm text-[var(--color-mist)]">Chưa có API key. Nhập key để model có thể tạo và phát triển kho phụ.</p>}
          {config.apiKeys.map((key) => (
            <div key={key.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--color-ink-600)]/60 p-3">
              <div className="min-w-0">
                <p className="text-sm font-medium">{key.label} <span className="font-mono text-[var(--color-mist)]">{key.maskedKey}</span></p>
                <p className={`text-xs ${key.health === "error" ? "text-[#f2a0a0]" : "text-[var(--color-mist)]"}`}>{HEALTH[key.health]} · Dùng gần nhất: {when(key.lastUsedAt)}</p>
                {key.cooldownUntil && <p className="text-xs text-[var(--color-mist)]">Hết thời gian chờ: {when(key.cooldownUntil)}</p>}
              </div>
              <div className="flex gap-2">
                <form action={toggleAction}>
                  <input type="hidden" name="id" value={key.id} />
                  <input type="hidden" name="disabled" value={String(!key.disabled)} />
                  <button type="submit" className="btn btn-ghost text-xs" disabled={toggling}>{key.disabled ? "Bật" : "Tạm tắt"}</button>
                </form>
                <form action={deleteAction} onSubmit={(event) => { if (!confirm(`Xoá ${key.label} khỏi sổ Ollama? Muốn dùng lại cần nhập lại key.`)) event.preventDefault(); }}>
                  <input type="hidden" name="id" value={key.id} />
                  <button type="submit" className="btn btn-danger text-xs" disabled={deleting}>Xoá key</button>
                </form>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
