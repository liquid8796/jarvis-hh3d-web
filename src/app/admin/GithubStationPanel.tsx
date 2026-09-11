"use client";

import { useActionState, useState, useTransition } from "react";
import Link from "next/link";
import {
  deleteGithubStationAction,
  pingGithubStationAction,
  revealGithubStationPatAction,
  runKeepaliveAction,
  provisionGithubStationAction,
  updateGithubStationAction,
  type StationResult,
  type StationView,
} from "@/app/actions/githubStations";
import { PageSizeSelect, Pager, usePageSize, usePaged } from "@/components/Pager";
import {
  countdownLevel,
  countUrgent,
  DEFAULT_DAILY_PUSHES,
  DEFAULT_WORKFLOW_FILE,
  KEEPALIVE_INTERVAL_DAYS,
  MAX_DAILY_PUSHES,
  MIN_DAILY_PUSHES,
  PAT_SCOPES_NOTE,
  SCHEDULE_DISABLE_DAYS,
  type CountdownLevel,
} from "@/lib/validation/githubStations";
import { githubPrimaryOwnerGroupFingerprint } from "@/lib/validation/githubPrimaryDeletion";

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
 *
 * Sổ được CẮT TRANG (`@/components/Pager`), và chính cái lệ「liếc một cái là thấy kho sắp chết」
 * ở trên là thứ phải trả giá cho phép cắt ấy: một kho đỏ nằm ở trang hai thì không ai liếc thấy.
 * Nên trang nào giấu kho đang đếm ngược thì nói thẳng ra — xem `offPageParts` bên dưới.
 */

/** Khoá riêng cho lựa chọn số kho mỗi trang, để không giẫm lên sổ môn đồ hay hàng đợi. */
const STATIONS_PAGE_SIZE_KEY = "jarvis:admin-github-stations:per-page";

/**
 * Thang mức RIÊNG, bắt đầu từ 5 thay vì thang chung `[10, 20, 50, 100]`.
 *
 * Một dòng ở đây không phải một dòng bảng: nó là một tấm thẻ mang đếm ngược, trạng thái lịch,
 * ghi chú lượt ngó, mốc ghi, rồi lưới kho phần mềm phụ — cao gấp chục lần một dòng sổ môn
 * đồ. Sổ production hiện có sáu kho mà đã dài quá một màn hình, nên một thang bắt đầu từ 10 là
 * một thang không bao giờ cắt gì cả: thêm phân trang mà người vận hành không thấy khác gì.
 */
const STATION_PAGE_SIZES = [5, 10, 20, 50] as const;

/** Mở ở mức nhỏ nhất; ai muốn xem trọn một mạch thì đổi, và lựa chọn ấy sống qua lần mở sau. */
const STATION_DEFAULT_PAGE_SIZE = STATION_PAGE_SIZES[0];

/**
 * Bảng màu cho từng hạng đếm ngược. Phép PHÂN HẠNG nằm ở `@/lib/validation/githubStations`
 * cùng hai con số nó so — ở đây chỉ còn chuyện tô màu, thứ thật sự thuộc về giao diện.
 */
const COUNTDOWN_CLASS: Record<CountdownLevel, string> = {
  unknown: "text-[var(--color-mist)]",
  critical: "text-[#f2a0a0]",
  warn: "text-[var(--color-gold-300)]",
  ok: "text-[var(--color-jade-300)]",
};

/** Tông màu + chữ của đếm ngược, cho đúng một hàng kho. */
function countdownTone(days: number | null): { text: string; className: string } {
  return {
    text: days === null ? "chưa ghi mốc lần nào" : `còn ${days} ngày`,
    className: COUNTDOWN_CLASS[countdownLevel(days)],
  };
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
        ? `${companion.pushesToday} lượt · giới hạn ${dailyPushes} · ${companion.lastNurtureDay}`
        : `Giới hạn ${dailyPushes} lượt/ngày · chưa bắt đầu`;

  return (
    <div className="min-w-0 rounded-lg border border-[var(--color-ink-600)]/50 px-3 py-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <a
          href={`https://github.com/${owner}/${companion.repo}`}
          target="_blank"
          rel="noreferrer"
          className="min-w-0 truncate font-mono text-xs text-[var(--color-parchment)] hover:text-[var(--color-gold-300)]"
        >
          {owner}/{companion.repo}
        </a>
        <span className="font-mono text-[11px] text-[var(--color-mist)]">{progress}</span>
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
  const [pingState, pingAction, pinging] = useActionState<StationResult | null, FormData>(pingGithubStationAction, null);
  const [deleteState, deleteAction, deleting] = useActionState<StationResult | null, FormData>(deleteGithubStationAction, null);
  const [loopState, loopAction, looping] = useActionState<StationResult | null, FormData>(runKeepaliveAction, null);
  /** slug đang sửa — đổ sẵn mọi thứ trừ PAT; PAT thì không bao giờ đổ lại. */
  const [editing, setEditing] = useState<StationView | null>(null);
  /** Chỉ đổi chữ ở đúng nút đã xác nhận; mọi nút vẫn bị khoá trong lúc xoá cả nhóm tài khoản. */
  const [deletingSlug, setDeletingSlug] = useState<string | null>(null);

  const [perPage, setPerPage] = usePageSize(
    STATIONS_PAGE_SIZE_KEY,
    STATION_PAGE_SIZES,
    STATION_DEFAULT_PAGE_SIZE,
  );
  const paged = usePaged(stations, perPage);

  /**
   * Kho đang đếm ngược mà trang hiện tại KHÔNG cho thấy — hiệu của「cả sổ」trừ「trang này」.
   *
   * Không đưa về trang đầu khi `stations` đổi: mọi thao tác ở tab này (nuôi, sửa, xoá) đều
   * `revalidatePath("/admin")` rồi trả về CÙNG một sổ chỉ khác vài mốc thời gian — ném người
   * đang đọc trang 2 về đầu sau mỗi cú「Nuôi ngay」là phá đúng việc họ đang làm. Trang vượt tầm
   * sau một lượt xoá thì `usePaged` đã kẹp lại.
   */
  const urgentInBook = countUrgent(stations);
  const urgentOnPage = countUrgent(paged.items);
  const offPage = {
    critical: urgentInBook.critical - urgentOnPage.critical,
    warn: urgentInBook.warn - urgentOnPage.warn,
  };
  const offPageParts = [
    offPage.critical > 0 ? `${offPage.critical} kho sắp tắt lịch` : null,
    offPage.warn > 0 ? `${offPage.warn} kho đã trượt một lượt ghi` : null,
  ]
    .filter((part): part is string => part !== null)
    .join(" · ");

  const notice = [pingState, deleteState, loopState].find((s) => s !== null);

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
          {/* Ô chọn đứng TRƯỚC nút nuôi: nút ấy đã đậu ở góc phải từ trước, và một tuỳ chọn mới
              không đáng đẩy một cái nút người vận hành đã quen tay đi chỗ khác. Nó ở lại kể cả
              khi sổ trống — cùng lẽ với chính nút「Chạy vòng nuôi」ngay bên cạnh, thứ cũng không
              làm gì được với một cuốn sổ rỗng mà vẫn đứng nguyên đó. */}
          <div className="flex flex-wrap items-center gap-3">
            <PageSizeSelect perPage={perPage} onPerPage={setPerPage} unit="kho" sizes={STATION_PAGE_SIZES} />
            <form action={loopAction}>
              <button type="submit" className="btn btn-ghost text-sm" disabled={looping}>
                {looping ? "Đang chạy · chờ Ollama…" : "Chạy vòng nuôi"}
              </button>
            </form>
          </div>
        </div>
        <p className="mb-5 max-w-prose text-xs text-[var(--color-mist)]">
          GitHub tắt lịch <code>schedule</code> của một kho công khai sau {SCHEDULE_DISABLE_DAYS} ngày
          không có commit nào, và khi tắt thì khôi lỗi im lặng ngừng lên ca. Vòng nuôi chạy mỗi ngày
          theo lịch <code>/api/cron</code>: ngó trạng thái của từng kho, và ghi một dòng mốc vào{" "}
          <code>.github/heartbeat.txt</code> mỗi ~{KEEPALIVE_INTERVAL_DAYS} ngày. Lịch nào đã bị tắt vì
          im lặng thì nó bật lại; lịch bị tắt TAY thì nó để nguyên. Các kho phần mềm phụ được Ollama
          phát triển theo nhu cầu trong giới hạn đẩy hằng ngày; chỉnh số lượng và quyền tại trang chi tiết.
        </p>

        {stations.length === 0 ? (
          <p className="text-sm text-[var(--color-mist)]">
            Sổ còn trống. Dùng form bên dưới để tạo repo GitHub, cài workflow và đăng ký kho vào vòng nuôi.
          </p>
        ) : (
          <>
            {offPageParts && (
              /* `role="status"` là một vùng live lịch sự: bấm sang trang khác thì người dùng
                 trình đọc màn hình nghe được luôn là trang mới có giấu kho đang đếm ngược không,
                 mà không cắt ngang thứ họ đang nghe dở. */
              <p
                role="status"
                className={`mb-3 text-xs ${offPage.critical > 0 ? "text-[#f2a0a0]" : "text-[var(--color-gold-300)]"}`}
              >
                Trang này không phải cả sổ — ngoài nó còn {offPageParts}. Lật trang hoặc tăng
                「Mỗi trang」để nhìn trọn.
              </p>
            )}
            <div className="flex flex-col gap-3">
              {paged.items.map((station) => {
                const countdown = countdownTone(station.daysToDisable);
                const accountStations = stations.filter(
                  (candidate) => candidate.owner.toLowerCase() === station.owner.toLowerCase(),
                );
                const retainedCompanions = accountStations.reduce(
                  (total, candidate) => total + candidate.companionRepos.length,
                  0,
                );
                return (
                  <div
                    key={station.slug}
                    className="flex flex-wrap items-center gap-3 rounded-xl border border-[rgba(232,194,92,0.18)] px-4 py-3"
                  >
                    <div className="w-full min-w-0 sm:w-auto sm:flex-1">
                      <p className="flex flex-wrap items-baseline gap-x-2 font-semibold">
                        <Link href={`/admin/github/${encodeURIComponent(station.owner)}/${encodeURIComponent(station.repo)}`} className="truncate font-mono hover:text-[var(--color-gold-300)] hover:underline">{station.slug}</Link>
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
                          Kho phần mềm phụ · giới hạn {station.dailyPushes} lượt/kho/ngày
                        </p>
                        {station.companionRepos.length === 0 ? (
                          <p className="text-[11px] text-[var(--color-mist)]">
                            Chưa có kho phụ. Ollama sẽ tạo khi vòng nuôi chạy và cấu hình cho phép.
                          </p>
                        ) : (
                          <div className="grid min-w-0 grid-cols-1 gap-1 sm:grid-cols-2">
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
                    <Link href={`/admin/github/${encodeURIComponent(station.owner)}/${encodeURIComponent(station.repo)}`} className="btn btn-ghost text-sm">Kho phụ / Chi tiết</Link>
                    <form action={pingAction}>
                      <input type="hidden" name="slug" value={station.slug} />
                      <input type="hidden" name="expectedGroup" value={githubPrimaryOwnerGroupFingerprint(accountStations, station.owner)} />
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
                        // Một lượt xoá áp dụng cho mọi repo chính cùng tài khoản, nên lời xác nhận
                        // phải nói rõ phạm vi và khẳng định các repo phụ vẫn nằm nguyên trên GitHub.
                        if (!confirm(
                          `XÓA VĨNH VIỄN ${accountStations.length} REPO CHÍNH của tài khoản GitHub「${station.owner}」?\n\n` +
                            `${retainedCompanions} repo phụ đã đăng ký sẽ được GIỮ NGUYÊN trên GitHub.\n\n` +
                            "Nếu tài khoản không còn truy cập được, chẳng hạn bị đình chỉ, hệ thống chỉ xoá " +
                            "các station khỏi sổ.",
                        )) {
                          e.preventDefault();
                          return;
                        }
                        setDeletingSlug(station.slug);
                      }}
                    >
                      <input type="hidden" name="slug" value={station.slug} />
                      <button type="submit" className="btn btn-danger text-sm" disabled={deleting}>
                        {deleting && deletingSlug === station.slug ? "Đang xoá kho chính…" : "Xoá"}
                      </button>
                    </form>
                  </div>
                );
              })}
            </div>
            <Pager paged={paged} unit="kho" />
          </>
        )}
      </section>

      <StationEditor key={editing?.slug ?? "new"} station={editing} onNew={() => setEditing(null)} />
    </div>
  );
}

/** A keyed editor keeps create/update action state and secret input isolated per station. */
function StationEditor({ station, onNew }: { station: StationView | null; onNew: () => void }) {
  const [state, action, pending] = useActionState<StationResult | null, FormData>(
    station ? updateGithubStationAction : provisionGithubStationAction,
    null,
  );
  const managed = station?.provisionedBy === "jarvis";
  return (
    <section className="card card-hairline w-full max-w-2xl min-w-0 p-4 sm:p-6" aria-labelledby="station-form-title">
      <h2 id="station-form-title" className="h-display text-lg font-semibold text-gilded">
        {station ? "Sửa cấu hình kho GitHub" : "Tạo kho GitHub mới"}
      </h2>
      <p className="mt-2 mb-5 text-sm text-[var(--color-mist)]">
        {station
          ? "Giữ nguyên tài khoản và tên kho. Các kho phụ và lịch sử vận hành được giữ khi cập nhật."
          : "Jarvis xác định tài khoản từ PAT, tạo repo công khai, đẩy workflow và đưa kho vào vòng nuôi. Tên repo đã tồn tại sẽ dừng trước khi thay đổi."}
      </p>
      {state && !pending && (
        <div role="status" className={`mb-4 rounded-lg border p-3 text-sm break-words ${state.ok ? "border-[rgba(76,201,154,0.4)] text-[var(--color-jade-300)]" : "border-[rgba(255,120,120,0.4)] text-[#f2a0a0]"}`}>
          <p>{state.message}</p>
          {state.slug && <p className="mt-1 break-all font-mono">{state.slug}</p>}
          {!!state.warnings?.length && (
            <ul className="mt-2 list-disc space-y-1 pl-5 text-[var(--color-gold-300)]">
              {state.warnings.map((warning, index) => <li key={index}>{warning}</li>)}
            </ul>
          )}
        </div>
      )}
      <form action={action} aria-busy={pending}>
        <fieldset disabled={pending} className="flex min-w-0 flex-col gap-4">
          {station && (
            <>
              <input type="hidden" name="slug" value={station.slug} />
              <div className="rounded-lg border border-[var(--color-ink-600)] p-3">
                <p className="text-xs text-[var(--color-mist)]">Tài khoản / Tên kho (cố định)</p>
                <p className="mt-1 break-all font-mono text-sm">{station.owner}/{station.repo}</p>
              </div>
            </>
          )}
          <div>
            <label className="label" htmlFor="station-pat">
              {station ? "PAT thay thế (để trống để giữ PAT cũ)" : "PAT GitHub (bắt buộc)"}
            </label>
            <input id="station-pat" name="pat" type="password" className="input w-full font-mono" autoComplete="off"
              required={!station} placeholder={station ? "Dán PAT mới của cùng tài khoản" : "ghp_…"} />
            <p className="mt-1 text-xs text-[var(--color-mist)]">
              {station
                ? <>PAT mới phải thuộc đúng tài khoản đang giữ kho. {PAT_SCOPES_NOTE}</>
                : <>Tạo classic PAT tại github.com/settings/tokens với đủ quyền <code>repo</code>, <code>workflow</code> và <code>delete_repo</code>. Quyền xoá dùng để thu hồi kho vừa tạo nếu thiết lập thất bại.</>}
            </p>
            {station && <PatVault key={station.slug} slug={station.slug} />}
          </div>
          {!station && (
            <div>
              <label className="label" htmlFor="station-repo">Tên repo (tuỳ chọn)</label>
              <input id="station-repo" name="repo" className="input w-full font-mono" maxLength={100} placeholder="Để trống để Ollama tự đặt tên" />
              <p className="mt-1 text-xs text-[var(--color-mist)]">Để trống: Ollama tự chọn tên, không dùng khuôn cố định. Cần model và API key Ollama dùng được; lỗi sẽ dừng tạo kho. Tên tự nhập được giữ nguyên; tên khôi lỗi được tạo riêng để không trùng repo.</p>
            </div>
          )}
          {managed ? (
            <div className="rounded-lg border border-[var(--color-ink-600)] p-3 text-sm">
              <p className="text-xs text-[var(--color-mist)]">Cấu hình do Jarvis tạo (cố định)</p>
              <p className="mt-1 break-all font-mono">Workflow: {station.workflowFile}</p>
              <p className="break-all font-mono">WORKER_ID: {station.workerId}</p>
            </div>
          ) : (
            <div className="flex min-w-0 flex-wrap gap-4">
              <div className="min-w-0 basis-48 flex-1">
                <label className="label" htmlFor="station-workflow">Tệp workflow{!station && " (tuỳ chọn)"}</label>
                <input id="station-workflow" name="workflowFile" className="input w-full font-mono" maxLength={100}
                  defaultValue={station?.workflowFile ?? ""} placeholder={DEFAULT_WORKFLOW_FILE} required={!!station} />
                <p className="mt-1 text-xs text-[var(--color-mist)]">
                  {station ? "Nhập đúng tên workflow đang có trong kho." : `Để trống dùng ${DEFAULT_WORKFLOW_FILE}. Chỉ nhập tên tệp .yml hoặc .yaml.`}
                </p>
              </div>
              {station && (
                <div className="min-w-0 basis-48 flex-1">
                  <label className="label" htmlFor="station-worker">WORKER_ID (tuỳ chọn)</label>
                  <input id="station-worker" name="workerId" className="input w-full font-mono" maxLength={120} defaultValue={station.workerId} />
                  <p className="mt-1 text-xs text-[var(--color-mist)]">Kho đăng ký từ trước: sửa để khớp workflow đang chạy.</p>
                </div>
              )}
            </div>
          )}
          <div>
            <label className="label" htmlFor="station-daily-pushes">Giới hạn lượt đẩy mỗi ngày cho mỗi kho phụ{!station && " (tuỳ chọn)"}</label>
            <input id="station-daily-pushes" name="dailyPushes" type="number" min={MIN_DAILY_PUSHES} max={MAX_DAILY_PUSHES} step={1}
              className="input w-full max-w-[10rem] font-mono" defaultValue={station?.dailyPushes ?? ""} placeholder={String(DEFAULT_DAILY_PUSHES)} required={!!station} />
            <p className="mt-1 text-xs text-[var(--color-mist)]">
              {MIN_DAILY_PUSHES}–{MAX_DAILY_PUSHES}; mặc định {DEFAULT_DAILY_PUSHES}. Chọn 0 để tạm dừng nuôi kho phụ. Model không phải đẩy đủ số lượt.
            </p>
          </div>
          {station && (
            <>
              <p className="text-xs text-[var(--color-mist)]">
                Đang giữ {station.companionRepos.length} kho phụ. <Link className="underline" href={`/admin/github/${encodeURIComponent(station.owner)}/${encodeURIComponent(station.repo)}`}>Quản lý kho phụ tại trang chi tiết</Link>.
              </p>
              <input type="hidden" name="enabledPresent" value="1" />
              <label className="flex items-center gap-2 text-sm" htmlFor="station-enabled">
                <input id="station-enabled" name="enabled" type="checkbox" defaultChecked={station.enabled} />
                Nằm trong vòng nuôi hằng ngày
              </label>
            </>
          )}
          <div className="flex flex-wrap gap-3">
            <button type="submit" className="btn btn-gold" disabled={pending}>
              {pending ? station ? "Đang cập nhật…" : "Đang tạo repo + workflow…" : station ? "Cập nhật kho" : "Tạo repo + workflow"}
            </button>
            {station && <button type="button" className="btn btn-ghost" onClick={onNew}>Tạo kho mới</button>}
          </div>
        </fieldset>
        {pending && <p role="status" className="mt-3 text-sm text-[var(--color-mist)]">{station ? "Đang lưu và kiểm tra workflow…" : "Đang tạo repo, đẩy workflow và đăng ký kho. Lượt tạo có thể mất tối đa 4 phút."}</p>}
      </form>
    </section>
  );
}
