"use client";

import { useActionState, useState, useTransition } from "react";
import {
  deleteGithubStationAction,
  pingGithubStationAction,
  revealGithubStationPatAction,
  runKeepaliveAction,
  saveGithubStationAction,
  type StationResult,
  type StationView,
} from "@/app/actions/githubStations";
import {
  DEFAULT_DAILY_PUSHES,
  DEFAULT_WORKFLOW_FILE,
  KEEPALIVE_INTERVAL_DAYS,
  MAX_DAILY_PUSHES,
  MIN_DAILY_PUSHES,
  PAT_SCOPES_NOTE,
  SCHEDULE_DISABLE_DAYS,
} from "@/lib/validation/githubStations";

/**
 * Tab Kho GitHub — sổ tài khoản đang giữ khôi lỗi chạy trên Actions (deploy/github-actions.md §7).
 *
 * Tab CHỈ hiện với người mang `github_station.manage` (page.tsx lọc), nên panel không tự gác
 * nữa — action phía server mới là hàng rào thật. `StationView` không mang phong bì PAT, nên vẽ
 * tab này ra không kéo PAT nào xuống trình duyệt; muốn đọc thì phải BẤM (xem `PatVault`), và ô
 * sửa để trống vẫn nghĩa là「giữ PAT cũ」.
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

/** Nút nhỏ trong khối PAT — cùng khuôn với nút「Chép lệnh」của mục Khôi Lỗi, cao hơn cho vừa ngón tay. */
const CHIP =
  "shrink-0 rounded-md border border-[var(--color-ink-600)] px-2.5 py-1 text-xs text-[var(--color-mist)] transition-colors hover:border-[rgba(232,194,92,0.5)] hover:text-[var(--color-gold-300)] disabled:opacity-50";

/**
 * Két PAT của kho ĐANG SỬA: mở phong bì khi admin bấm, không sớm hơn một nhịp nào.
 *
 * Vì sao cần cửa này: GitHub không cho xem lại token đã phát, nên sổ là bản duy nhất còn giữ PAT —
 * xem lý lẽ đầy đủ ở `revealGithubStationPatAction`.
 *
 * Bản rõ hiện ra NGOÀI form, không đổ vào ô「dán cái mới để thay」. Hai lẽ: ô ấy để trống mới đúng
 * nghĩa「giữ PAT cũ」, và một ô đã có chữ nghĩa là bấm「Cập nhật kho」sẽ đẩy ngược chính cái PAT vừa
 * xem lên máy chủ để mã hoá lại — một lượt đi thừa của một bí mật, chỉ vì admin đã ngó nó.
 *
 * `key={slug}` ở chỗ gọi là thứ dọn dẹp: đổi sang kho khác thì component chết, bản rõ chết theo.
 */
function PatVault({ slug }: { slug: string }) {
  const [pat, setPat] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();

  const reveal = () => {
    setError(null);
    startTransition(async () => {
      try {
        const result = await revealGithubStationPatAction(slug);
        if (result.ok) {
          setPat(result.pat);
        } else {
          setError(result.message);
        }
      } catch {
        // Action NÉM khi người bấm không còn quyền (phiên hết hạn giữa chừng). Bắt ở đây để nó
        // ra một dòng chữ, chứ không phải một promise gãy im lặng dưới console.
        setError("Không mở được phong bì — tải lại trang rồi thử lại.");
      }
    });
  };

  const copy = () => {
    if (pat === null) {
      return;
    }
    setError(null);
    // `navigator.clipboard` KHÔNG có ngoài secure context (một trạm mở bằng http trần), và một
    // cái nút bấm xong không làm gì cả thì tệ hơn một cái nút nói thẳng là nó không làm được.
    if (!navigator.clipboard) {
      setError("Trình duyệt không cho chép tự động ở đây — bôi đen dòng trên rồi Ctrl+C.");
      return;
    }
    void navigator.clipboard.writeText(pat).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      },
      () => setError("Trình duyệt chặn lượt chép — bôi đen dòng trên rồi Ctrl+C."),
    );
  };

  return (
    <div className="mt-3">
      {pat === null ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-[var(--color-mist)]">Sổ đang giữ một PAT cho kho này.</span>
          <button type="button" className={CHIP} onClick={reveal} disabled={pending}>
            {pending ? "Đang mở phong bì…" : "Hiện PAT để chép"}
          </button>
        </div>
      ) : (
        <>
          <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs text-[var(--color-mist)]">PAT đang lưu trong sổ</span>
            <div className="flex shrink-0 gap-2">
              <button type="button" className={CHIP} onClick={copy}>
                {copied ? "Đã chép ✓" : "Chép PAT"}
              </button>
              <button
                type="button"
                className={CHIP}
                onClick={() => {
                  setPat(null);
                  setCopied(false);
                  setError(null);
                }}
              >
                Ẩn
              </button>
            </div>
          </div>
          {/* `break-all`: PAT fine-grained dài ~93 ký tự và không có chỗ ngắt tự nhiên nào — để
              nguyên là nó đẩy phình cả cột form (cùng bài học với `CopyBlock` bên LinhSuPanel). */}
          <code className="block rounded-lg border border-[var(--color-ink-600)]/60 bg-[var(--color-ink-900)]/60 p-3 font-mono text-[11px] leading-relaxed break-all text-[var(--color-parchment)]">
            {pat}
          </code>
        </>
      )}
      {error && (
        <p role="status" className="mt-1 text-xs text-[#f2a0a0]">
          {error}
        </p>
      )}
    </div>
  );
}

/** Một dòng repo phụ: tên + tiến độ trong ngày + kết quả push gần nhất mà backend đã ghi. */
function CompanionRepoStatus({
  owner,
  companion,
  dailyPushes,
}: {
  owner: string;
  companion: StationView["companionRepos"][number];
  dailyPushes: number;
}) {
  const tone =
    companion.lastPushOk === true
      ? "text-[var(--color-jade-300)]"
      : companion.lastPushOk === false
        ? "text-[#f2a0a0]"
        : "text-[var(--color-mist)]";
  const progress =
    dailyPushes === 0
      ? "đã tạm dừng"
      : companion.lastNurtureDay
        ? `${companion.pushesToday}/${dailyPushes} lượt · ${companion.lastNurtureDay}`
        : `0/${dailyPushes} lượt · chưa bắt đầu`;

  return (
    <div className="rounded-lg border border-[var(--color-ink-600)]/50 px-3 py-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <a
          href={`https://github.com/${owner}/${companion.repo}`}
          target="_blank"
          rel="noreferrer"
          className="min-w-0 truncate font-mono text-xs text-[var(--color-parchment)] hover:text-[var(--color-gold-300)]"
        >
          {owner}/{companion.repo}
        </a>
        <span className="shrink-0 font-mono text-[11px] text-[var(--color-mist)]">{progress}</span>
      </div>
      <p className={`mt-0.5 text-[11px] ${tone}`}>
        {companion.lastPushAt
          ? `Đẩy gần nhất ${when(companion.lastPushAt)}${companion.lastPushNote ? `: ${companion.lastPushNote}` : "."}`
          : "Chưa có kết quả đẩy nào."}
      </p>
    </div>
  );
}

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
          im lặng thì nó bật lại; lịch bị tắt TAY thì nó để nguyên. Hai kho phần mềm phụ của mỗi
          khôi lỗi nhận số lượt đẩy riêng trong ngày mà Gia chủ đặt ở form sửa kho.
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
                    <div className="mt-2">
                      <p className="mb-1 text-[11px] font-medium tracking-wide text-[var(--color-mist)] uppercase">
                        Kho phần mềm phụ · {station.dailyPushes} lượt/kho/ngày
                      </p>
                      {station.companionRepos.length === 0 ? (
                        <p className="text-[11px] text-[var(--color-mist)]">
                          Kho khôi lỗi cũ này chưa có cặp repo phụ; form sửa vẫn giữ nguyên trạng thái ấy.
                        </p>
                      ) : (
                        <div className="grid gap-1 sm:grid-cols-2">
                          {station.companionRepos.map((companion) => (
                            <CompanionRepoStatus
                              key={companion.repo}
                              owner={station.owner}
                              companion={companion}
                              dailyPushes={station.dailyPushes}
                            />
                          ))}
                        </div>
                      )}
                    </div>
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
                      if (!confirm(
                        `Xoá station「${station.slug}」khỏi sổ? PAT đã mã hoá mất theo; cả ba repo ` +
                          "trên GitHub vẫn được giữ nhưng từ nay không repo nào trong bundle được nuôi tự động.",
                      )) {
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
                placeholder="linh-su"
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
          <fieldset className="rounded-xl border border-[rgba(232,194,92,0.18)] p-4">
            <legend className="px-1 text-sm font-medium text-[var(--color-parchment)]">
              Hai kho phần mềm phụ
            </legend>
            <div className="flex flex-wrap gap-4">
              {[0, 1].map((index) => (
                <div key={index} className="min-w-[12rem] flex-1">
                  <label className="label" htmlFor={`station-companion-${index + 1}`}>
                    Tên kho phụ {index + 1}
                  </label>
                  <input
                    id={`station-companion-${index + 1}`}
                    name={`companionRepo${index + 1}`}
                    className="input w-full font-mono"
                    placeholder={index === 0 ? "harbor-lantern-a7f3" : "quiet-orbit-c9e1"}
                    defaultValue={editing?.companionRepos[index]?.repo ?? ""}
                    readOnly={editing?.companionRepos.length === 2}
                    required={editing === null || (editing?.companionRepos.length ?? 0) > 0}
                  />
                </div>
              ))}
            </div>
            <p className="mt-2 text-xs text-[var(--color-mist)]">
              Cùng tài khoản và PAT với kho khôi lỗi. Cặp đủ hai tên trở thành danh tính được khoá
              cả ở giao diện lẫn server; kho cũ có thể để trống hoặc bổ sung đúng hai tên một lần.
            </p>
          </fieldset>
          <div>
            <label className="label" htmlFor="station-daily-pushes">
              Số lượt đẩy mỗi ngày cho mỗi kho phụ
            </label>
            <input
              id="station-daily-pushes"
              name="dailyPushes"
              type="number"
              min={MIN_DAILY_PUSHES}
              max={MAX_DAILY_PUSHES}
              step={1}
              className="input max-w-[10rem] font-mono"
              defaultValue={editing?.dailyPushes ?? DEFAULT_DAILY_PUSHES}
              required
            />
            <p className="mt-1 text-xs text-[var(--color-mist)]">
              {MIN_DAILY_PUSHES}–{MAX_DAILY_PUSHES}; mặc định {DEFAULT_DAILY_PUSHES}. Chọn 0 để tạm
              dừng nuôi hai repo phụ mà không tắt kho khôi lỗi chính.
            </p>
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
            {editing && <PatVault key={editing.slug} slug={editing.slug} />}
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
