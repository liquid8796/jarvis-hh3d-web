"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
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
  MAX_DAILY_PUSHES,
  MIN_DAILY_PUSHES,
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
 * Thứ đáng nhìn nhất trên tab này là ĐẾM NGƯỢC của từng kho, nên nó đứng ngay cạnh tên. Màn
 * tổng quan chỉ giữ trạng thái, số kho phụ và lỗi cần xem; tên/note từng kho phụ đã có trang
 * chi tiết, bung lại ở đây chỉ bắt người vận hành cuộn qua cùng một dữ liệu hai lần.
 *
 * Sổ được CẮT TRANG (`@/components/Pager`), và chính cái lệ「liếc một cái là thấy kho sắp chết」
 * ở trên là thứ phải trả giá cho phép cắt ấy: một kho đỏ nằm ở trang hai thì không ai liếc thấy.
 * Nên trang nào giấu kho đang đếm ngược thì nói thẳng ra — xem `offPageParts` bên dưới.
 */

/** Khoá riêng cho lựa chọn số kho mỗi trang, để không giẫm lên sổ môn đồ hay hàng đợi. */
const STATIONS_PAGE_SIZE_KEY = "jarvis:admin-github-stations:per-page";

/** Thang riêng bắt đầu từ 5 để màn tổng quan vẫn là một lượt quét ngắn trên điện thoại. */
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

export function GithubStationPanel({ stations }: { stations: StationView[] }) {
  const [pingState, pingAction, pinging] = useActionState<StationResult | null, FormData>(pingGithubStationAction, null);
  const [deleteState, deleteAction, deleting] = useActionState<StationResult | null, FormData>(deleteGithubStationAction, null);
  const [loopState, loopAction, looping] = useActionState<StationResult | null, FormData>(runKeepaliveAction, null);
  const [editing, setEditing] = useState<StationView | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const editorTrigger = useRef<HTMLButtonElement | null>(null);
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

  function openEditor(station: StationView | null, trigger: HTMLButtonElement) {
    editorTrigger.current = trigger;
    setEditing(station);
    setEditorOpen(true);
  }

  function closeEditor() {
    setEditorOpen(false);
    requestAnimationFrame(() => editorTrigger.current?.focus());
  }

  useEffect(() => {
    if (!editorOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focus = requestAnimationFrame(() => document.getElementById("station-form-title")?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setEditorOpen(false);
        requestAnimationFrame(() => editorTrigger.current?.focus());
        return;
      }
      if (event.key !== "Tab") return;
      const dialog = document.getElementById("station-editor-dialog");
      const focusable = dialog
        ? [...dialog.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href]")]
        : [];
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && (document.activeElement === first || document.activeElement?.id === "station-form-title")) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      cancelAnimationFrame(focus);
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [editorOpen, editing?.slug]);

  return (
    <div className="flex flex-col gap-4">
      {notice && (
        <p
          role="status"
          className={`rounded-lg border px-4 py-2 text-sm ${notice.ok ? "border-[rgba(76,201,154,0.4)] text-[var(--color-jade-300)]" : "border-[rgba(255,120,120,0.4)] text-[#f2a0a0]"}`}
        >
          {notice.message}
        </p>
      )}

      <section className="card card-hairline p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="h-display text-lg font-semibold text-gilded">Kho chính</h2>
            <p className="mt-0.5 text-xs text-[var(--color-mist)]">
              {urgentInBook.critical > 0 || urgentInBook.warn > 0
                ? `${urgentInBook.critical} sắp tắt lịch · ${urgentInBook.warn} cần ghi mốc`
                : "Workflow và repo phụ đang được theo dõi"}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="btn btn-gold px-3 py-2 text-sm" onClick={(event) => openEditor(null, event.currentTarget)}>
              Tạo kho mới
            </button>
            <PageSizeSelect perPage={perPage} onPerPage={setPerPage} unit="kho" sizes={STATION_PAGE_SIZES} />
            <form action={loopAction}>
              <button type="submit" className="btn btn-ghost px-3 py-2 text-sm" disabled={looping}>
                {looping ? "Đang chạy · chờ Ollama…" : "Chạy vòng nuôi"}
              </button>
            </form>
          </div>
        </div>

        {stations.length === 0 ? (
          <p className="py-10 text-center text-sm text-[var(--color-mist)]">Chưa có kho GitHub.</p>
        ) : (
          <>
            {offPageParts && (
              /* `role="status"` là một vùng live lịch sự: bấm sang trang khác thì người dùng
                 trình đọc màn hình nghe được luôn là trang mới có giấu kho đang đếm ngược không,
                 mà không cắt ngang thứ họ đang nghe dở. */
              <p
                role="status"
                className={`mt-3 text-xs ${offPage.critical > 0 ? "text-[#f2a0a0]" : "text-[var(--color-gold-300)]"}`}
              >
                Ngoài trang này còn {offPageParts}.
              </p>
            )}
            <div className="mt-4 flex flex-col gap-2">
              {paged.items.map((station) => {
                const countdown = station.primaryDeferred
                  ? { text: "repo chính đang hoãn", className: "text-[var(--color-gold-300)]" }
                  : countdownTone(station.daysToDisable);
                const companionIssues = station.companionRepos.filter(
                  (companion) => companion.lastPushOk === false || companion.pendingDelete,
                ).length;
                const accountStations = stations.filter(
                  (candidate) => candidate.owner.toLowerCase() === station.owner.toLowerCase(),
                );
                const activePrimaryCount = accountStations.filter((candidate) => !candidate.primaryDeferred).length;
                const retainedCompanions = accountStations.reduce(
                  (total, candidate) => total + candidate.companionRepos.length,
                  0,
                );
                return (
                  <article
                    key={station.slug}
                    className="grid min-w-0 gap-3 rounded-xl border border-[rgba(232,194,92,0.18)] px-3 py-3 sm:px-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center"
                  >
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-baseline gap-x-2 font-semibold">
                        <Link href={`/admin/github/${encodeURIComponent(station.owner)}/${encodeURIComponent(station.repo)}`} className="truncate font-mono hover:text-[var(--color-gold-300)] hover:underline">{station.slug}</Link>
                        <span className={`text-sm font-normal ${countdown.className}`}>{countdown.text}</span>
                        {station.primaryDeferred && (
                          <span className="rounded-full border border-[rgba(232,194,92,0.5)] px-2 py-0.5 text-xs font-normal text-[var(--color-gold-300)]">
                            chỉ nuôi repo phụ
                          </span>
                        )}
                        {!station.enabled && (
                          <span className="rounded-full border border-[rgba(155,150,190,0.5)] px-2 py-0.5 text-xs font-normal text-[var(--color-mist)]">
                            đang tắt
                          </span>
                        )}
                      </p>
                      <p className={`mt-0.5 text-xs ${companionIssues > 0 ? "text-[var(--color-gold-300)]" : "text-[var(--color-mist)]"}`}>
                        {station.primaryDeferred ? "chưa tạo workflow chính" : workflowStateLabel(station.workflowState)} · {station.companionRepos.length} kho phụ
                        {companionIssues > 0 && <> · {companionIssues} cần xem</>}
                        {station.dailyPushes === 0 ? " · đã dừng nuôi" : ` · ${station.dailyPushes} lượt/kho/ngày`}
                      </p>
                      <p
                        className={`mt-0.5 truncate text-xs ${station.lastPingOk === false ? "text-[#f2a0a0]" : "text-[var(--color-mist)]"}`}
                        title={station.lastPingOk === false ? station.lastPingNote : undefined}
                      >
                        {station.lastPingAt ? `Ngó ${when(station.lastPingAt)}` : "Chưa ngó"} · mốc {when(station.lastCommitAt)}
                        {station.lastPingOk === false && station.lastPingNote ? ` · ${station.lastPingNote}` : ""}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2 lg:justify-end">
                      <Link href={`/admin/github/${encodeURIComponent(station.owner)}/${encodeURIComponent(station.repo)}`} className="btn btn-ghost px-3 py-1.5 text-xs">Chi tiết</Link>
                      <form action={pingAction}>
                        <input type="hidden" name="slug" value={station.slug} />
                        <input type="hidden" name="expectedGroup" value={githubPrimaryOwnerGroupFingerprint(accountStations, station.owner)} />
                        <button
                          type="submit"
                          className="btn btn-ghost px-3 py-1.5 text-xs"
                          disabled={pinging || station.primaryDeferred}
                          title={station.primaryDeferred ? "Repo chính đang hoãn; dùng Chạy vòng nuôi để chăm repo phụ." : undefined}
                        >
                          {station.primaryDeferred ? "Repo chính hoãn" : pinging ? "Đang nuôi…" : "Nuôi ngay"}
                        </button>
                      </form>
                      <button type="button" className="btn btn-ghost px-3 py-1.5 text-xs" onClick={(event) => openEditor(station, event.currentTarget)}>
                        Sửa
                      </button>
                      <form
                        action={deleteAction}
                        onSubmit={(e) => {
                          if (!confirm(
                            `XÓA VĨNH VIỄN ${activePrimaryCount} REPO CHÍNH của tài khoản GitHub「${station.owner}」?\n\n` +
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
                        <button type="submit" className="btn btn-danger px-3 py-1.5 text-xs" disabled={deleting}>
                          {deleting && deletingSlug === station.slug ? "Đang xoá…" : "Xoá"}
                        </button>
                      </form>
                    </div>
                  </article>
                );
              })}
            </div>
            <Pager paged={paged} unit="kho" />
          </>
        )}
      </section>

      {editorOpen && createPortal(
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(6,8,20,0.78)] p-3 sm:p-6"
          onClick={(event) => { if (event.target === event.currentTarget) closeEditor(); }}
        >
          <StationEditor
            key={editing?.slug ?? "new"}
            station={editing}
            onNew={() => setEditing(null)}
            onClose={closeEditor}
          />
        </div>,
        document.body,
      )}
    </div>
  );
}

/** A keyed editor keeps create/update action state and secret input isolated per station. */
function StationEditor({
  station,
  onNew,
  onClose,
}: {
  station: StationView | null;
  onNew: () => void;
  onClose: () => void;
}) {
  const [state, action, pending] = useActionState<StationResult | null, FormData>(
    station ? updateGithubStationAction : provisionGithubStationAction,
    null,
  );
  const managed = station?.provisionedBy === "jarvis";
  const [deferPrimary, setDeferPrimary] = useState(station?.primaryDeferred ?? false);
  return (
    <section
      id="station-editor-dialog"
      className="card card-hairline max-h-[85dvh] w-full max-w-2xl min-w-0 overflow-y-auto p-4 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="station-form-title"
    >
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 id="station-form-title" tabIndex={-1} className="h-display text-lg font-semibold text-gilded">
            {station ? "Sửa kho GitHub" : "Tạo kho GitHub mới"}
          </h2>
          <p className="mt-1 text-xs text-[var(--color-mist)]">{station ? "Tên kho và tài khoản được giữ nguyên." : "Tài khoản được xác định từ PAT."}</p>
        </div>
        <button type="button" className="btn btn-ghost px-2.5 py-1 text-sm" onClick={onClose} aria-label="Đóng form kho GitHub">✕</button>
      </div>
      {state && !pending && (
        <div role="status" className={`mb-4 rounded-lg border p-3 text-sm break-words ${state.ok ? "border-[rgba(76,201,154,0.4)] text-[var(--color-jade-300)]" : "border-[rgba(255,120,120,0.4)] text-[#f2a0a0]"}`}>
          <p>{state.message}</p>
          {state.slug && <p className="mt-1 break-all font-mono">{state.slug}</p>}
          {state.diagnosticId && (
            <p className="mt-1 font-mono text-xs text-[var(--color-mist)]">
              Mã chẩn đoán: {state.diagnosticId}{state.failureCode ? ` · ${state.failureCode}` : ""}
            </p>
          )}
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
                ? "PAT mới phải thuộc đúng tài khoản và đủ quyền GitHub."
                : <>Classic PAT cần <code>repo</code> · <code>workflow</code> · <code>delete_repo</code> · <code>user</code>.</>}
            </p>
            {station && <PatVault key={station.slug} slug={station.slug} />}
          </div>
          {!station && (
            <div>
              <label className="label" htmlFor="station-repo">Tên repo chính dự kiến (tuỳ chọn)</label>
              <input id="station-repo" name="repo" className="input w-full font-mono" maxLength={100}
                pattern={"[A-Za-z0-9._\\-]+"} title="Chỉ dùng chữ, số, dấu chấm, gạch ngang hoặc gạch dưới."
                placeholder="Để trống để Ollama tự đặt tên" />
              <p className="mt-1 text-xs text-[var(--color-mist)]">Để trống để Ollama đặt tên. Nếu hoãn repo chính, tên này được giữ chỗ trong sổ để tạo sau.</p>
            </div>
          )}
          {(!station || station.primaryDeferred) && (
            <div className="rounded-xl border border-[rgba(232,194,92,0.24)] bg-[rgba(232,194,92,0.04)] p-4">
              <input type="hidden" name="deferPrimaryPresent" value="1" />
              <label className="flex cursor-pointer items-start gap-3 text-sm" htmlFor="station-defer-primary">
                <input
                  id="station-defer-primary"
                  name="deferPrimary"
                  type="checkbox"
                  checked={deferPrimary}
                  onChange={(event) => setDeferPrimary(event.target.checked)}
                  className="mt-1 h-5 w-5 shrink-0"
                />
                <span>
                  <b className="text-[var(--color-parchment)]">Tạm thời chưa tạo repo chính / chưa chạy workflow khôi lỗi</b>
                  <span className="mt-1 block text-xs leading-relaxed text-[var(--color-mist)]">
                    Hệ thống vẫn đăng ký tài khoản và nuôi các repo phụ bằng Ollama. Khi bỏ tick rồi lưu, Jarvis mới tạo repo chính, cài WORKER_TOKEN và khởi chạy workflow.
                  </span>
                </span>
              </label>
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
                  pattern={"[A-Za-z0-9][A-Za-z0-9._\\-]*\\.(?:ya?ml)"}
                  title="Nhập một tên tệp .yml hoặc .yaml, không kèm đường dẫn."
                  defaultValue={station?.workflowFile ?? ""} placeholder={DEFAULT_WORKFLOW_FILE} required={!!station} />
                <p className="mt-1 text-xs text-[var(--color-mist)]">
                  {station ? "Tên workflow đang chạy." : `Mặc định: ${DEFAULT_WORKFLOW_FILE}.`}
                </p>
              </div>
              {station && (
                <div className="min-w-0 basis-48 flex-1">
                  <label className="label" htmlFor="station-worker">WORKER_ID (tuỳ chọn)</label>
                  <input id="station-worker" name="workerId" className="input w-full font-mono" maxLength={120} defaultValue={station.workerId} />
                  <p className="mt-1 text-xs text-[var(--color-mist)]">Dành cho kho đăng ký từ trước.</p>
                </div>
              )}
            </div>
          )}
          <div>
            <label className="label" htmlFor="station-daily-pushes">Giới hạn lượt đẩy mỗi ngày cho mỗi kho phụ{!station && " (tuỳ chọn)"}</label>
            <input id="station-daily-pushes" name="dailyPushes" type="number" min={MIN_DAILY_PUSHES} max={MAX_DAILY_PUSHES} step={1}
              className="input w-full max-w-[10rem] font-mono" defaultValue={station?.dailyPushes ?? ""} placeholder={String(DEFAULT_DAILY_PUSHES)} required={!!station} />
            <p className="mt-1 text-xs text-[var(--color-mist)]">
              {MIN_DAILY_PUSHES}–{MAX_DAILY_PUSHES} · mặc định {DEFAULT_DAILY_PUSHES} · 0 là tạm dừng.
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
              {pending
                ? station
                  ? station.primaryDeferred && !deferPrimary ? "Đang tạo repo chính + workflow…" : "Đang cập nhật…"
                  : deferPrimary ? "Đang đăng ký + tạo repo phụ…" : "Đang tạo repo + workflow…"
                : station
                  ? station.primaryDeferred && !deferPrimary ? "Tạo repo chính + chạy khôi lỗi" : "Cập nhật kho"
                  : deferPrimary ? "Chỉ nuôi repo phụ trước" : "Tạo repo + workflow"}
            </button>
            {station && <button type="button" className="btn btn-ghost" onClick={onNew}>Tạo kho mới</button>}
          </div>
        </fieldset>
        {pending && <p role="status" className="mt-3 text-sm text-[var(--color-mist)]">{station ? station.primaryDeferred && !deferPrimary ? "Đang tạo repo chính và khởi chạy workflow…" : "Đang lưu cấu hình…" : deferPrimary ? "Đang đăng ký tài khoản, cập nhật profile và khởi tạo vòng nuôi repo phụ…" : "Đang tạo repo, workflow và cập nhật profile; có thể mất đến 4 phút."}</p>}
      </form>
    </section>
  );
}
