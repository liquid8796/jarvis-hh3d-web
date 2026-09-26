"use client";

import { useActionState } from "react";
import {
  deleteGithubCompanionAction,
  promoteGithubCompanionAction,
  saveGithubCompanionSettingsAction,
  type GithubStationDetailView,
} from "@/app/actions/githubNurture";
import type { StationResult, StationView } from "@/app/actions/githubStations";
import { MAX_COMPANION_COUNT } from "@/lib/validation/githubNurture";

const when = (value: string | null | undefined) => value ? new Date(value).toLocaleString("vi-VN") : "chưa có";

function CompanionCard({ station, companion }: { station: StationView; companion: StationView["companionRepos"][number] }) {
  const [promoteResult, promoteAction, promoting] = useActionState<StationResult | null, FormData>(promoteGithubCompanionAction, null);
  const [deleteResult, deleteAction, deleting] = useActionState<StationResult | null, FormData>(deleteGithubCompanionAction, null);
  const promotionNote = station.primaryDeferred
    ? `Promote ${station.owner}/${companion.repo} thành repo chính? Toàn bộ code dự án hiện có sẽ được giữ nguyên. Jarvis chỉ thêm hoặc cập nhật workflow khôi lỗi, cài WORKER_TOKEN và bật Actions; Ollama vẫn tiếp tục phát triển source cũ.`
    : `Promote ${station.owner}/${companion.repo} thành repo chính? Toàn bộ code dự án hiện có sẽ được giữ nguyên; Jarvis chỉ thêm hoặc cập nhật workflow khôi lỗi. ${station.owner}/${station.repo} sẽ thành repo phụ và Actions của repo cũ sẽ bị tắt. Lịch sử Git của cả hai repo được giữ lại.`;
  return (
    <article className="min-w-0 rounded-xl border border-[rgba(232,194,92,0.18)] p-4">
      <a href={`https://github.com/${station.owner}/${companion.repo}`} target="_blank" rel="noreferrer" className="font-mono text-sm break-all text-[var(--color-gold-300)] hover:underline">{station.owner}/{companion.repo} ↗</a>
      {companion.topic && <p className="mt-2 text-sm text-[var(--color-parchment)]">{companion.topic}</p>}
      <div className="mt-2 space-y-1 text-xs text-[var(--color-mist)]">
        <p>{companion.managedBy === "ollama" ? "Được tạo và phát triển bởi Ollama" : "Kho đã đăng ký từ trước"}{companion.forkedFrom && <> · Fork từ <span className="break-all">{companion.forkedFrom}</span></>}</p>
        <p>Đã đẩy {companion.pushesToday} lượt{companion.lastNurtureDay ? ` ngày ${companion.lastNurtureDay}` : ""} · Giới hạn {station.dailyPushes} lượt/ngày</p>
        <p>Đẩy gần nhất: {when(companion.lastPushAt)} · Quyết định tiếp theo: {when(companion.nextDecisionAt)}</p>
        {companion.lastPushNote && <p className={companion.lastPushOk === false ? "text-[#f2a0a0]" : ""}>{companion.lastPushNote}</p>}
        {companion.pendingDelete && <p className="text-[#f2a0a0]">Đang hoàn tất yêu cầu xoá kho này.</p>}
      </div>

      {!companion.pendingDelete && (
        <form action={promoteAction} className="mt-4 border-t border-[var(--color-ink-600)]/60 pt-3" onSubmit={(event) => {
          if (!confirm(promotionNote)) event.preventDefault();
        }}>
          <input type="hidden" name="slug" value={station.slug} />
          <input type="hidden" name="repo" value={companion.repo} />
          <p className="mb-2 text-xs text-[var(--color-mist)]">Đổi vai trò không xoá code hay lịch sử Git. Jarvis chỉ chồng tệp workflow vào <code>.github/workflows/</code>; worker tải runtime riêng khi Actions chạy, còn Ollama tiếp tục cập nhật source dự án cũ.</p>
          <button type="submit" className="btn btn-gold text-sm" disabled={promoting || deleting}>
            {promoting ? "Đang promote…" : "Promote làm repo chính"}
          </button>
          {promoteResult && <p role="status" className={`mt-2 text-xs ${promoteResult.ok ? "text-[var(--color-jade-300)]" : "text-[#f2a0a0]"}`}>{promoteResult.message}</p>}
        </form>
      )}

      <form action={deleteAction} className="mt-4 border-t border-[var(--color-ink-600)]/60 pt-3" onSubmit={(event) => {
        if (!confirm(`Xoá VĨNH VIỄN ${station.owner}/${companion.repo} trên GitHub? Toàn bộ mã và lịch sử sẽ bị xoá. Nếu còn thiếu số kho đã cấu hình, model có thể tự tạo kho thay thế ở vòng tiếp theo.`)) event.preventDefault();
      }}>
        <input type="hidden" name="slug" value={station.slug} />
        <input type="hidden" name="repo" value={companion.repo} />
        <label className="label text-xs" htmlFor={`delete-companion-${companion.repo}`}>Nhập tên kho để xoá vĩnh viễn</label>
        <div className="flex flex-wrap gap-2">
          <input id={`delete-companion-${companion.repo}`} name="confirmedRepo" required autoComplete="off" placeholder={companion.repo} className="input w-full min-w-0 font-mono text-sm sm:w-auto sm:flex-1" />
          <button type="submit" className="btn btn-danger text-sm" disabled={deleting || promoting}>{deleting ? "Đang xoá…" : "Xoá kho phụ"}</button>
        </div>
        {deleteResult && <p role="status" className={`mt-2 text-xs ${deleteResult.ok ? "text-[var(--color-jade-300)]" : "text-[#f2a0a0]"}`}>{deleteResult.message}</p>}
      </form>
    </article>
  );
}

function PrimarySourceCard({ station }: { station: StationView }) {
  const source = station.primarySource;
  if (!source) return null;
  return (
    <section className="card card-hairline p-6" data-primary-source>
      <h2 className="h-display text-lg font-semibold text-gilded">Source cũ trong repo chính</h2>
      <p className="mt-2 text-sm text-[var(--color-parchment)]">
        Repo <span className="font-mono break-all">{station.owner}/{station.repo}</span> vẫn giữ nguyên dự án trước lúc promote. Jarvis chỉ quản lý workflow khôi lỗi trong <code>.github/workflows/</code>; Ollama tiếp tục phát triển các tệp source cũ và không được sửa workflow.
      </p>
      <div className="mt-3 space-y-1 text-xs text-[var(--color-mist)]">
        {source.topic && <p>{source.topic}</p>}
        <p>Ngôn ngữ: {source.language || "đang nhận diện"} · Đã đẩy {source.pushesToday} lượt{source.lastNurtureDay ? " ngày " + source.lastNurtureDay : ""} · Giới hạn {station.dailyPushes} lượt/ngày</p>
        <p>Promote: {when(source.promotedAt)}{source.promotedFrom ? <> · Từ <span className="font-mono break-all">{source.promotedFrom}</span></> : null}</p>
        <p>Đẩy source gần nhất: {when(source.lastPushAt)} · Quyết định tiếp theo: {when(source.nextDecisionAt)}</p>
        {source.lastPushNote && <p className={source.lastPushOk === false ? "text-[#f2a0a0]" : ""}>{source.lastPushNote}</p>}
      </div>
    </section>
  );
}

export function GithubCompanionDetail({ detail }: { detail: GithubStationDetailView }) {
  const { station } = detail;
  const [result, action, pending] = useActionState<StationResult | null, FormData>(saveGithubCompanionSettingsAction, null);
  return (
    <div className="flex flex-col gap-6">
      <section className="card card-hairline p-6">
        <h2 className="h-display text-lg font-semibold text-gilded">Cấu hình riêng</h2>
        <p className="mt-2 text-sm text-[var(--color-mist)]">Đang có {station.companionRepos.length} kho phụ · Số lượng áp dụng: {detail.effectiveCompanionCount} · Mặc định chung: {detail.defaultCompanionCount}.</p>
        {!station.enabled && <p className="mt-2 text-sm text-[var(--color-gold-300)]">Kho chính đang tắt vòng nuôi tự động.</p>}
        <form action={action} className="mt-4 flex flex-col gap-4">
          <input type="hidden" name="slug" value={station.slug} />
          <div className="max-w-sm">
            <label className="label" htmlFor="companion-count">Ghi đè số kho phụ</label>
            <input id="companion-count" name="companionCountOverride" type="number" min={0} max={MAX_COMPANION_COUNT} step={1} defaultValue={station.companionCountOverride ?? ""} placeholder={`Dùng mặc định (${detail.defaultCompanionCount})`} className="input w-full font-mono" />
            <p className="mt-1 text-xs text-[var(--color-mist)]">Để trống để theo mặc định chung. Nhập 0 để không tạo thêm kho phụ. Giảm số lượng không tự xoá các repo đang có; muốn tạm dừng phát triển, đặt giới hạn lượt đẩy về 0 ở form sửa kho chính.</p>
          </div>
          <label className="flex items-start gap-2 text-sm"><input name="allowCompanionFork" type="checkbox" defaultChecked={station.allowCompanionFork} className="mt-1" /><span>Cho phép model fork repo công khai cùng chủ đề để phát triển tiếp.</span></label>
          <label className="flex items-start gap-2 text-sm"><input name="allowCompanionDelete" type="checkbox" defaultChecked={station.allowCompanionDelete} className="mt-1" /><span>Cho phép model xoá vĩnh viễn các repo phụ do Ollama quản lý khi cần tạo lại. Mã và lịch sử sẽ mất.</span></label>
          <p className="text-xs text-[var(--color-mist)]">Hai quyền mặc định đều tắt. Thao tác xoá thủ công bên dưới yêu cầu xác nhận riêng. Khi thiếu số lượng cấu hình, model có thể tự tạo kho thay thế ở vòng tiếp theo.</p>
          {result && <p role="status" className={`text-sm ${result.ok ? "text-[var(--color-jade-300)]" : "text-[#f2a0a0]"}`}>{result.message}</p>}
          <button type="submit" className="btn btn-gold self-start" disabled={pending}>{pending ? "Đang lưu…" : "Lưu cấu hình kho"}</button>
        </form>
        <div className="mt-4 space-y-1 text-xs text-[var(--color-mist)]">
          <p>Vòng quyết định tiếp theo: {when(station.nurtureNextAt)}</p>
          {station.nurtureLastNote && <p>{station.nurtureLastNote}</p>}
          {station.nurturePending && <p>Đang hoàn tất {station.nurturePending.kind === "fork" ? "fork" : "tạo"} kho {station.nurturePending.repo}.</p>}
        </div>
      </section>
      <PrimarySourceCard station={station} />
      <section className="card card-hairline p-6">
        <h2 className="h-display mb-4 text-lg font-semibold text-gilded">Kho phụ hiện có ({station.companionRepos.length})</h2>
        {station.companionRepos.length === 0 ? <p className="text-sm text-[var(--color-mist)]">Chưa có kho phụ. Model sẽ tạo ở vòng nuôi khi có API key khả dụng và số lượng cấu hình lớn hơn 0.</p> : <div className="grid min-w-0 grid-cols-1 gap-4 md:grid-cols-2">{station.companionRepos.map((companion) => <CompanionCard key={companion.repo} station={station} companion={companion} />)}</div>}
      </section>
    </div>
  );
}
