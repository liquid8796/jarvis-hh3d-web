"use client";

import { useState, useTransition } from "react";
import { reconcileWorkerAutoscaleAction, saveWorkerAutoscaleAction, type AutoscaleInput } from "@/app/actions/workerAutoscale";
import type { WorkerAutoscaleSettings } from "@/lib/validation/workerAutoscale";
import type { StationView } from "@/app/actions/githubStations";

const modes = [
  { id: "manual", label: "Manual", description: "Chốt số workflow muốn duy trì" },
  { id: "scheduler", label: "Scheduler", description: "Đổi quy mô theo khung giờ mỗi ngày" },
  { id: "dynamic", label: "Dynamic", description: "Tính từ job chờ lượt và đang chạy" },
] as const;
const fieldClass = "mt-2 w-full min-h-11 rounded-xl border border-[var(--color-gold-400)]/25 bg-[var(--color-ink-900)]/70 px-3 text-[var(--color-parchment)] outline-none focus:border-[var(--color-gold-300)] focus:ring-2 focus:ring-[var(--color-gold-300)]/20";
const panelClass = "rounded-2xl border border-[var(--color-gold-400)]/20 bg-[var(--color-ink-900)]/55 p-5 sm:p-6";
const limited = (value: number, min = 1) => Number.isFinite(value) ? Math.max(min, Math.floor(value)) : min;

export function WorkerAutoscalePanel({ initial, stations }: { initial: WorkerAutoscaleSettings; stations: StationView[] }) {
  const [config, setConfig] = useState<AutoscaleInput>({
    enabled: initial.enabled, mode: initial.mode, minWorkers: initial.minWorkers,
    manualWorkers: initial.manualWorkers, schedule: initial.schedule,
    dynamicMaxWorkers: initial.dynamicMaxWorkers, jobsPerWorker: initial.jobsPerWorker,
    downscaleCooldownMinutes: initial.downscaleCooldownMinutes,
  });
  const [busy, start] = useTransition();
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const eligible = stations.filter(s => s.enabled && !s.primaryDeferred && s.purpose === "worker");
  const active = eligible.filter(s => s.workflowState === "active").length;
  const countUnknown = eligible.filter(s => !["active", "disabled_manually", "disabled_inactivity"].includes(s.workflowState)).length;
  const change = <K extends keyof AutoscaleInput>(key: K, value: AutoscaleInput[K]) => setConfig(c => ({ ...c, [key]: value }));
  const valid = config.minWorkers > 0 && config.minWorkers <= 100
    && config.dynamicMaxWorkers >= config.minWorkers
    && config.schedule.length > 0 && new Set(config.schedule.map(p => p.time)).size === config.schedule.length
    && config.schedule.every(p => /^([01]\d|2[0-3]):[0-5]\d$/.test(p.time) && p.workers >= 1 && p.workers <= 100);
  const updateSchedule = (index: number, changes: Partial<AutoscaleInput["schedule"][number]>) =>
    change("schedule", config.schedule.map((item, i) => i === index ? { ...item, ...changes } : item));

  function submit() {
    start(async () => {
      setNotice(null);
      try {
        const reply = await saveWorkerAutoscaleAction(config);
        setNotice({ ok: reply.ok, text: reply.message });
      } catch (err) {
        setNotice({ ok: false, text: err instanceof Error ? err.message : "Không lưu được cấu hình." });
      }
    });
  }
  function reconcile() {
    start(async () => {
      setNotice(null);
      try {
        const reply = await reconcileWorkerAutoscaleAction();
        setNotice({ ok: reply.ok, text: reply.message });
      } catch (err) {
        setNotice({ ok: false, text: err instanceof Error ? err.message : "Không kết nối được GitHub." });
      }
    });
  }
  return (
    <section className="space-y-5" aria-labelledby="worker-autoscale-title">
      <div className="card relative overflow-hidden p-5 sm:p-7">
        <div className="absolute inset-y-0 right-0 w-1 bg-[var(--color-gold-400)]/70" aria-hidden="true" />
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[.18em] text-[var(--color-gold-300)]">GitHub Actions / Điều phối tải</p>
            <h2 id="worker-autoscale-title" className="h-display mt-2 text-2xl font-bold text-gilded">Auto Scaling Khôi Lỗi</h2>
            <p className="mt-2 max-w-xl text-sm leading-6 text-[var(--color-mist)]">Điều chỉnh số workflow GitHub đang bật. Khi giảm tải, Khôi Lỗi được chọn ngừng nhận job mới, hoàn tất job đang chạy rồi tự thoát. Không chạy Khôi Lỗi trên OCI.</p>
          </div>
          <label className="flex min-h-11 items-center gap-3 rounded-xl border border-[var(--color-gold-400)]/25 bg-[var(--color-ink-900)]/70 px-4 text-sm font-semibold text-[var(--color-parchment)]">
            <input type="checkbox" checked={config.enabled} onChange={e => change("enabled", e.target.checked)} className="size-5 accent-amber-400" disabled={busy} />
            Kích hoạt điều phối
          </label>
        </div>
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { value: eligible.length, label: "Kho khả dụng" },
            { value: active, label: "Workflow đang bật*" },
            { value: config.minWorkers, label: "Mức tối thiểu" },
            { value: config.mode === "manual" ? config.manualWorkers : config.mode === "dynamic" ? config.dynamicMaxWorkers : config.schedule.length, label: config.mode === "manual" ? "Mục tiêu Manual" : config.mode === "dynamic" ? "Trần Dynamic" : "Mốc thời gian" },
          ].map(item => <div key={item.label} className="rounded-xl border border-white/10 bg-black/20 p-3 sm:p-4">
            <div className="text-2xl font-bold tabular-nums text-[var(--color-parchment)]">{item.value}</div>
            <div className="mt-1 text-xs text-[var(--color-mist)]">{item.label}</div>
          </div>)}
        </div>
        {active === eligible.length && eligible.length > 0 && config.mode === "dynamic" && <p className="mt-3 text-sm text-amber-200" role="status">Đã bật toàn bộ {eligible.length} workflow hiện có. Nếu job vẫn ùn ứ, phải bổ sung kho Khôi Lỗi mới hoặc tăng năng lực runner; nâng Max vượt số kho không tạo thêm runner.</p>}
        {initial.drainingWorkerIds.length > 0 && <p className="mt-3 text-sm text-amber-200" role="status">{initial.drainingWorkerIds.length} Khôi Lỗi đang rút lui hoặc đã được ngừng nhận job mới. Số máy online sẽ giảm khi ca cũ kết thúc.</p>}
        <p className="mt-3 text-xs leading-5 text-[var(--color-mist)]">* Dựa trên lần kiểm tra workflow gần nhất; kết quả thực tế được đối chiếu lại trực tiếp với GitHub mỗi lần scale. {countUnknown > 0 ? `${countUnknown} kho chưa có trạng thái xác thực.` : ""}</p>
      </div>

      <div className={panelClass}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-lg font-bold text-[var(--color-parchment)]">Số Khôi Lỗi tối thiểu</h3>
            <p className="mt-1 text-sm text-[var(--color-mist)]">Áp dụng chung cho Manual, Scheduler và Dynamic. Mặc định 2 workflow.</p>
          </div>
          <div className="w-36">
            <label htmlFor="autoscale-min" className="text-xs font-semibold text-[var(--color-mist)]">Minimum workers</label>
            <input id="autoscale-min" className={fieldClass} type="number" min={1} max={100} value={config.minWorkers} onChange={e => change("minWorkers", limited(Number(e.target.value)))} disabled={busy} />
          </div>
        </div>
      </div>

      <div className={panelClass}>
        <h3 className="text-lg font-bold text-[var(--color-parchment)]">Chế độ điều phối</h3>
        <div className="mt-4 grid gap-3 md:grid-cols-3" role="radiogroup" aria-label="Chọn chế độ auto scaling">
          {modes.map(m => <label key={m.id} className={`flex min-h-28 cursor-pointer gap-3 rounded-xl border p-4 transition-colors ${config.mode === m.id ? "border-[var(--color-gold-400)] bg-[var(--color-gold-400)]/10" : "border-white/10 bg-black/15 hover:border-white/30"}`}>
            <input className="mt-1 size-4 shrink-0 accent-amber-400" name="autoscale-mode" type="radio" value={m.id} checked={config.mode === m.id} onChange={() => change("mode", m.id)} disabled={busy} />
            <span><span className="block text-base font-bold text-[var(--color-parchment)]">{m.label}</span><span className="mt-1 block text-sm leading-5 text-[var(--color-mist)]">{m.description}</span></span>
          </label>)}
        </div>

        {config.mode === "manual" && <div className="mt-6 border-t border-white/10 pt-5">
          <h4 className="font-bold text-[var(--color-parchment)]">Số workflow muốn bật</h4>
          <p className="mt-1 text-sm text-[var(--color-mist)]">Nhập tổng số Khôi Lỗi GitHub cần giữ hoạt động; số thực tế không vượt lượng kho đủ điều kiện.</p>
          <label className="mt-4 block max-w-xs text-sm text-[var(--color-mist)]" htmlFor="autoscale-manual">Target workers
            <input id="autoscale-manual" type="number" min={config.minWorkers} max={100} className={fieldClass} value={config.manualWorkers} onChange={e => change("manualWorkers", limited(Number(e.target.value)))} disabled={busy} />
          </label>
        </div>}

        {config.mode === "scheduler" && <div className="mt-6 border-t border-white/10 pt-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><h4 className="font-bold text-[var(--color-parchment)]">Mốc giờ hằng ngày</h4><p className="mt-1 text-sm text-[var(--color-mist)]">Theo múi giờ Việt Nam (Asia/Ho_Chi_Minh). Mốc gần nhất có hiệu lực cho tới mốc kế tiếp.</p></div>
            <button type="button" className="btn btn-ghost text-sm" disabled={busy || config.schedule.length >= 24} onClick={() => change("schedule", [...config.schedule, { time: "12:00", workers: config.minWorkers }])}>+ Thêm mốc</button>
          </div>
          <div className="mt-4 space-y-3">{config.schedule.map((item, i) =>
            <div key={i} className="grid grid-cols-[1fr_1fr_auto] items-end gap-3 rounded-xl border border-white/10 bg-black/15 p-3">
              <label className="min-w-0 text-xs font-semibold text-[var(--color-mist)]">Thời gian
                <input className={fieldClass} type="time" value={item.time} onChange={e => updateSchedule(i, { time: e.target.value })} disabled={busy} />
              </label>
              <label className="min-w-0 text-xs font-semibold text-[var(--color-mist)]">Số Khôi Lỗi
                <input className={fieldClass} type="number" min={config.minWorkers} max={100} value={item.workers} onChange={e => updateSchedule(i, { workers: limited(Number(e.target.value)) })} disabled={busy} />
              </label>
              <button type="button" className="btn btn-ghost min-h-11 px-3 text-xs" aria-label={`Xóa mốc thứ ${i + 1}`} disabled={busy || config.schedule.length === 1} onClick={() => change("schedule", config.schedule.filter((_, j) => i !== j))}>Xóa</button>
            </div>)}</div>
        </div>}

        {config.mode === "dynamic" && <div className="mt-6 border-t border-white/10 pt-5">
          <h4 className="font-bold text-[var(--color-parchment)]">Điều tiết theo hàng đợi</h4>
          <p className="mt-1 text-sm text-[var(--color-mist)]">Chỉ tính job đã hết cooldown, đang chờ Khôi Lỗi nhận ngay và job đang chạy còn nhịp tim. Không tính job còn cooldown hoặc dành cho máy nhà. Cooldown giảm tải riêng vẫn có hiệu lực.</p>
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            <label className="text-xs font-semibold text-[var(--color-mist)]">Tối đa workflow
              <input type="number" className={fieldClass} min={config.minWorkers} max={100} value={config.dynamicMaxWorkers} onChange={e => change("dynamicMaxWorkers", limited(Number(e.target.value)))} disabled={busy} />
            </label>
            <label className="text-xs font-semibold text-[var(--color-mist)]">Job / workflow
              <input type="number" className={fieldClass} min={1} max={20} value={config.jobsPerWorker} onChange={e => change("jobsPerWorker", limited(Number(e.target.value)))} disabled={busy} />
            </label>
            <label className="text-xs font-semibold text-[var(--color-mist)]">Cooldown giảm tải (phút)
              <input type="number" className={fieldClass} min={10} max={1440} value={config.downscaleCooldownMinutes} onChange={e => change("downscaleCooldownMinutes", limited(Number(e.target.value), 10))} disabled={busy} />
            </label>
          </div>
        </div>}
      </div>

      <div className="card p-5 sm:p-6">
        <div className="flex flex-wrap gap-3">
          <button type="button" className="btn btn-gold min-h-11" onClick={submit} disabled={busy || !valid}>{busy ? "Đang xử lý…" : "Lưu cấu hình và áp dụng"}</button>
          <button type="button" className="btn btn-ghost min-h-11" onClick={reconcile} disabled={busy || !config.enabled}>{busy ? "Đang xử lý…" : "Đồng bộ lại ngay"}</button>
        </div>
        {notice && <p className={`mt-4 rounded-xl border p-3 text-sm ${notice.ok ? "border-emerald-500/40 text-[#a9f4d3]" : "border-rose-500/40 text-[#ffc4c4]"}`} role="status">{notice.text}</p>}
        {initial.lastError && !notice && <p className="mt-3 text-sm text-[#ffc4c4]" role="alert">Lỗi lượt trước: {initial.lastError}</p>}
        <p className="mt-3 text-xs leading-5 text-[var(--color-mist)]">Lịch dự kiến kiểm tra mỗi 10 phút khi kích hoạt. GitHub Actions có thể khởi động worker trễ; thao tác bật/tắt workflow không ngắt job đang thực thi. Chỉ các kho có quyền quản lý trong tab Kho GitHub mới được điều phối.</p>
      </div>
    </section>
  );
}
