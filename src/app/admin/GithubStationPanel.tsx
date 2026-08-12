"use client";

import { useActionState, useState } from "react";
import {
  deleteGithubStationAction,
  pingGithubStationAction,
  runKeepaliveAction,
  saveGithubStationAction,
  type StationResult,
  type StationView,
} from "@/app/actions/githubStations";
import {
  DEFAULT_WORKFLOW_FILE,
  KEEPALIVE_INTERVAL_DAYS,
  PAT_SCOPES_NOTE,
  SCHEDULE_DISABLE_DAYS,
} from "@/lib/validation/githubStations";

/**
 * Tab Kho GitHub — sổ tài khoản đang giữ khôi lỗi chạy trên Actions (deploy/github-actions.md §7).
 *
 * Tab CHỈ hiện với người mang `github_station.manage` (page.tsx lọc), nên panel không tự gác
 * nữa — action phía server mới là hàng rào thật. PAT chỉ ĐI LÊN qua form, không bao giờ đi
 * xuống: server phát `StationView` không mang phong bì, và ô sửa để trống nghĩa là「giữ PAT cũ」.
 *
 * Thứ đáng nhìn nhất trên tab này là ĐẾM NGƯỢC của từng kho, nên nó là dòng to nhất mỗi hàng —
 * mọi thứ khác (ghi chú lượt ngó, mốc thời gian) là chữ nhỏ dưới nó. Một tab mà mọi dòng đều
 * cùng cỡ thì người vận hành phải đọc hết mới biết có kho nào sắp chết hay không.
 */

/**
 * Tông màu của đếm ngược. Hai ngưỡng, và cả hai suy ra từ nhịp ghi thật chứ không phải số tròn
 * cho đẹp — một kho KHOẺ phải luôn xanh, bằng không màu vàng mất hết nghĩa sau tuần đầu.
 *
 * Kho khoẻ dao động giữa 60 (vừa ghi) và 40 (đúng lúc tới hạn, trước khi vòng nuôi trong ngày
 * chạy). Nên ngưỡng vàng là「THẤP HƠN 40」chứ không phải「từ 40 trở xuống」: đứng đúng ở 40 là
 * trạng thái bình thường mỗi chu kỳ, và tô vàng cho nó là dạy người vận hành bỏ qua màu vàng.
 */
function countdownTone(days: number | null): { text: string; className: string } {
  if (days === null) {
    return { text: "chưa ghi mốc lần nào", className: "text-[var(--color-mist)]" };
  }
  // Còn ít hơn một chu kỳ ghi: lượt ghi kế mà hỏng nữa là không còn lần thứ ba nào trước mốc tắt.
  if (days <= KEEPALIVE_INTERVAL_DAYS) {
    return { text: `còn ${days} ngày`, className: "text-[#f2a0a0]" };
  }
  // Đã trượt hẳn một lượt ghi — vòng nuôi có chạy, nhưng kho này không nhận được commit nào.
  if (days < SCHEDULE_DISABLE_DAYS - KEEPALIVE_INTERVAL_DAYS) {
    return { text: `còn ${days} ngày`, className: "text-[var(--color-gold-300)]" };
  }
  return { text: `còn ${days} ngày`, className: "text-[var(--color-jade-300)]" };
}

/** Chữ Việt cho `state` GitHub khai. Giá trị lạ hiện NGUYÊN VĂN — đoán bừa còn tệ hơn không dịch. */
function workflowStateLabel(state: string): string {
  if (state === "active") return "lịch đang chạy";
  if (state === "disabled_inactivity") return "lịch bị tắt vì im lặng";
  if (state === "disabled_manually") return "lịch bị tắt tay";
  if (state === "") return "chưa ngó lần nào";
  return state;
}

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("vi-VN") : "chưa có");

export function GithubStationPanel({ stations }: { stations: StationView[] }) {
  const [saveState, saveAction, saving] = useActionState<StationResult | null, FormData>(saveGithubStationAction, null);
  const [pingState, pingAction, pinging] = useActionState<StationResult | null, FormData>(pingGithubStationAction, null);
  const [deleteState, deleteAction, deleting] = useActionState<StationResult | null, FormData>(deleteGithubStationAction, null);
  const [loopState, loopAction, looping] = useActionState<StationResult | null, FormData>(runKeepaliveAction, null);
  /** slug đang sửa — đổ sẵn mọi thứ trừ PAT; PAT thì không bao giờ đổ lại. */
  const [editing, setEditing] = useState<StationView | null>(null);

  const notice = [saveState, pingState, deleteState, loopState].find((s) => s !== null);

  return (
    <div className="flex flex-col gap-6">
      {notice && (
        <p
          role="status"
          className={`rounded-lg border px-4 py-2 text-sm ${notice.ok ? "border-[rgba(76,201,154,0.4)] text-[var(--color-jade-300)]" : "border-[rgba(255,120,120,0.4)] text-[#f2a0a0]"}`}
        >
          {notice.message}
        </p>
      )}

      <section className="card card-hairline p-6">
        <div className="mb-2 flex flex-wrap items-start justify-between gap-4">
          <h2 className="h-display text-lg font-semibold text-gilded">Sổ kho khôi lỗi GitHub</h2>
          <form action={loopAction}>
            <button type="submit" className="btn btn-ghost text-sm" disabled={looping}>
              {looping ? "Đang chạy vòng…" : "Chạy vòng nuôi"}
            </button>
          </form>
        </div>
        <p className="mb-5 max-w-prose text-xs text-[var(--color-mist)]">
          GitHub tắt lịch <code>schedule</code> của một kho công khai sau {SCHEDULE_DISABLE_DAYS} ngày
          không có commit nào, và khi tắt thì khôi lỗi im lặng ngừng lên ca. Vòng nuôi chạy mỗi ngày
          theo lịch <code>/api/cron</code>: ngó trạng thái của từng kho, và ghi một dòng mốc vào{" "}
          <code>.github/heartbeat.txt</code> mỗi ~{KEEPALIVE_INTERVAL_DAYS} ngày. Lịch nào đã bị tắt vì
          im lặng thì nó bật lại; lịch bị tắt TAY thì nó để nguyên.
        </p>

        {stations.length === 0 ? (
          <p className="text-sm text-[var(--color-mist)]">
            Sổ còn trống, nên chưa kho nào được nuôi. Đường ngắn nhất: bấm đúp{" "}
            <code>new-github-khoiloi.bat</code> ở gốc repo — nhập đúng một PAT, nó tự dựng kho, tự
            đặt tên, rồi tự ghi vào sổ này. Form dưới dành cho kho đã có sẵn.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {stations.map((station) => {
              const countdown = countdownTone(station.daysToDisable);
              return (
                <div
                  key={station.slug}
                  className="flex flex-wrap items-center gap-3 rounded-xl border border-[rgba(232,194,92,0.18)] px-4 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-baseline gap-x-2 font-semibold">
                      <span className="truncate font-mono">{station.slug}</span>
                      <span className={`text-sm font-normal ${countdown.className}`}>{countdown.text}</span>
                      {!station.enabled && (
                        <span className="rounded-full border border-[rgba(155,150,190,0.5)] px-2 py-0.5 text-xs font-normal text-[var(--color-mist)]">
                          đang tắt
                        </span>
                      )}
                    </p>
                    <p className="truncate text-xs text-[var(--color-mist)]">
                      {station.workflowFile} · {workflowStateLabel(station.workflowState)}
                      {station.workerId && <> · WORKER_ID {station.workerId}</>}
                    </p>
                    <p
                      className={`text-xs ${station.lastPingOk ? "text-[var(--color-jade-300)]" : station.lastPingOk === false ? "text-[#f2a0a0]" : "text-[var(--color-mist)]"}`}
                    >
                      {station.lastPingAt ? `Ngó ${when(station.lastPingAt)}: ${station.lastPingNote}` : "Chưa ngó lần nào."}
                    </p>
                    <p className="text-xs text-[var(--color-mist)]">Mốc ghi gần nhất: {when(station.lastCommitAt)}</p>
                  </div>
                  <form action={pingAction}>
                    <input type="hidden" name="slug" value={station.slug} />
                    <button type="submit" className="btn btn-ghost text-sm" disabled={pinging}>
                      {pinging ? "Đang nuôi…" : "Nuôi ngay"}
                    </button>
                  </form>
                  <button type="button" className="btn btn-ghost text-sm" onClick={() => setEditing(station)}>
                    Sửa
                  </button>
                  <form
                    action={deleteAction}
                    onSubmit={(e) => {
                      // Xoá là mất phong bì PAT — một cú bấm nhầm không được phép đủ.
                      if (!confirm(`Xoá kho「${station.slug}」khỏi sổ? PAT đã mã hoá mất theo, và từ nay không ai nuôi kho ấy nữa.`)) {
                        e.preventDefault();
                      }
                    }}
                  >
                    <input type="hidden" name="slug" value={station.slug} />
                    <button type="submit" className="btn btn-danger text-sm" disabled={deleting}>
                      Xoá
                    </button>
                  </form>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="card card-hairline max-w-2xl p-6">
        <h2 className="h-display mb-5 text-lg font-semibold text-gilded">
          {editing ? `Sửa kho「${editing.slug}」` : "Ghi kho mới"}
        </h2>
        {/* key ép React dựng lại form khi đổi giữa thêm/sửa — defaultValue chỉ đọc lúc mount. */}
        <form key={editing?.slug ?? "new"} action={saveAction} className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-4">
            <div className="min-w-[12rem] flex-1">
              <label className="label" htmlFor="station-owner">
                Tài khoản GitHub
              </label>
              <input
                id="station-owner"
                name="owner"
                className="input w-full font-mono"
                placeholder="zhangyu4"
                defaultValue={editing?.owner ?? ""}
                readOnly={editing !== null}
                required
              />
            </div>
            <div className="min-w-[12rem] flex-1">
              <label className="label" htmlFor="station-repo">
                Tên kho
              </label>
              <input
                id="station-repo"
                name="repo"
                className="input w-full font-mono"
                placeholder="github-khoiloi"
                defaultValue={editing?.repo ?? ""}
                readOnly={editing !== null}
                required
              />
            </div>
          </div>
          {editing && (
            <p className="-mt-2 text-xs text-[var(--color-mist)]">
              Tài khoản và tên kho là danh tính của dòng này nên không sửa được — đổi kho thì xoá dòng
              cũ rồi ghi dòng mới.
            </p>
          )}
          <div className="flex flex-wrap gap-4">
            <div className="min-w-[12rem] flex-1">
              <label className="label" htmlFor="station-workflow">
                Tệp workflow
              </label>
              <input
                id="station-workflow"
                name="workflowFile"
                className="input w-full font-mono"
                placeholder={DEFAULT_WORKFLOW_FILE}
                defaultValue={editing?.workflowFile ?? DEFAULT_WORKFLOW_FILE}
              />
            </div>
            <div className="min-w-[12rem] flex-1">
              <label className="label" htmlFor="station-worker">
                WORKER_ID <span className="font-normal">(tuỳ chọn)</span>
              </label>
              <input
                id="station-worker"
                name="workerId"
                className="input w-full font-mono"
                placeholder="github-zhangyu4"
                defaultValue={editing?.workerId ?? ""}
              />
            </div>
          </div>
          <div>
            <label className="label" htmlFor="station-pat">
              PAT của tài khoản giữ kho{editing && " — để trống là giữ PAT cũ"}
            </label>
            <input
              id="station-pat"
              name="pat"
              type="password"
              className="input w-full font-mono"
              placeholder={editing ? "đang giữ một PAT — dán cái mới để thay" : "ghp_… hoặc github_pat_…"}
              autoComplete="off"
            />
            {/* Nói ngay chỗ lấy và scope nào: thiếu `workflow` là lỗi hay gặp nhất của cả lối này,
                và nó chỉ lộ ra ở đúng bước cuối cùng. */}
            <p className="mt-1 text-xs text-[var(--color-mist)]">
              Lấy ở <code>github.com/settings/tokens</code>, đăng nhập ĐÚNG tài khoản giữ kho.{" "}
              {PAT_SCOPES_NOTE}
            </p>
          </div>
          <label className="flex items-center gap-2 text-sm" htmlFor="station-enabled">
            <input
              id="station-enabled"
              name="enabled"
              type="checkbox"
              defaultChecked={editing ? editing.enabled : true}
            />
            Nằm trong vòng nuôi hằng ngày
          </label>
          <div className="flex gap-3">
            <button type="submit" className="btn btn-gold" disabled={saving}>
              {saving ? "Đang ghi + ngó kho…" : editing ? "Cập nhật kho" : "Ghi vào sổ"}
            </button>
            {editing && (
              <button type="button" className="btn btn-ghost" onClick={() => setEditing(null)}>
                Thôi, ghi kho mới
              </button>
            )}
          </div>
        </form>
      </section>
    </div>
  );
}
