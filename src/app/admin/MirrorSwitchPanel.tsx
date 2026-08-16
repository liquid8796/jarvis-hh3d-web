"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  abortSwitchAction,
  beginSwitchAction,
  flipSwitchAction,
  stepSwitchAction,
  switchStateForAdmin,
  type SwitchResult,
  type SwitchView,
} from "@/app/actions/mirrorSwitch";
import { registerSelfAction, type MirrorView } from "@/app/actions/mirrors";

/**
 * Bảng điều khiển lượt chuyển trạm — deploy/mirror/README.md §6.
 *
 * Máy trạng thái nằm ở server (app_settings.mirrorSwitch); panel này chỉ LÁI nó: gọi
 * `stepSwitchAction` lặp lại cho tới khi phase là `done` hoặc `failed`. Mỗi nhịp là một
 * request ngắn, nên thanh tiến độ dưới đây là tiến độ THẬT — đóng tab rồi mở lại vẫn đi
 * tiếp được, vì trạng thái sống trong database chứ không trong state của React.
 *
 * Vòng lặp CHỦ ĐỘNG DỪNG ở `done`: bước lật bảng là thao tác bứng cả tông môn sang tài khoản
 * khác, nên nó phải là một cú bấm riêng của người, không được nối đuôi tự động.
 */
export function MirrorSwitchPanel({ mirrors, initial }: { mirrors: MirrorView[]; initial: SwitchView }) {
  const router = useRouter();
  const [view, setView] = useState<SwitchView>(initial);
  const [notice, setNotice] = useState<SwitchResult | null>(null);
  const [running, setRunning] = useState(false);
  const [pending, startTransition] = useTransition();
  const candidates = mirrors.filter((m) => m.id !== initial.currentSiteId);
  const [targetId, setTargetId] = useState(candidates[0]?.id ?? "");
  const [confirmText, setConfirmText] = useState("");

  const busy = view.phase === "draining" || view.phase === "syncing" || view.phase === "verifying";
  /**
   * Không có lượt chuyển nào đang dở — chỗ để MỞ một lượt mới.
   *
   * Tách tên ra vì nó gác hai khối loại trừ nhau ở cuối tệp (form mở lượt / hàng nút điều khiển
   * lượt đang chạy). Viết lại điều kiện ở cả hai nơi là hẹn ngày chúng lệch nhau rồi cùng hiện
   * hoặc cùng biến mất.
   */
  const ranh = view.phase === "idle" || view.phase === "failed";

  // Vòng lặp nhịp. Chạy khi người bấm「Chạy tiếp」và tự dừng ở done/failed — hoặc khi phase
  // rời khỏi nhóm đang-làm-việc, phòng trường hợp một nhịp đưa thẳng tới kết thúc.
  useEffect(() => {
    if (!running) return;
    let alive = true;

    const pump = async () => {
      while (alive) {
        const res = await stepSwitchAction();
        if (!alive) return;
        setNotice(res);
        const next = await switchStateForAdmin();
        if (!alive) return;
        setView(next);
        if (next.phase === "done" || next.phase === "failed" || next.phase === "idle") break;
        // Nhịp "chờ đàn cạn" không có việc gì để làm — nghỉ 5 giây thay vì quay tít.
        if (next.phase === "draining") await new Promise((r) => setTimeout(r, 5_000));
      }
      if (alive) {
        setRunning(false);
        router.refresh();
      }
    };

    void pump().catch((err: unknown) => {
      if (!alive) return;
      setNotice({ ok: false, message: `Nhịp chuyển trạm hỏng: ${err instanceof Error ? err.message : "lỗi mạng"}` });
      setRunning(false);
    });
    return () => {
      alive = false;
    };
  }, [running, router]);

  const refresh = () =>
    startTransition(async () => {
      setView(await switchStateForAdmin());
      router.refresh();
    });

  const phaseLabel: Record<SwitchView["phase"], string> = {
    idle: "Chưa có lượt chuyển nào",
    draining: "Đang chờ đàn cạn",
    syncing: "Đang chép dữ liệu",
    verifying: "Đang đối chiếu",
    done: "Đối chiếu xanh — chờ lật bảng",
    failed: "Hỏng giữa chừng",
  };

  const tone =
    view.phase === "failed"
      ? "border-[rgba(255,120,120,0.45)] text-[#f2a0a0]"
      : view.phase === "done"
        ? "border-[rgba(76,201,154,0.45)] text-[var(--color-jade-300)]"
        : "border-[rgba(232,194,92,0.3)] text-[var(--color-mist)]";

  return (
    <section className="card card-hairline p-6">
      <h2 className="h-display mb-2 text-lg font-semibold text-gilded">Chuyển trạm</h2>
      <p className="mb-5 text-xs text-[var(--color-mist)]">
        Đóng cửa phát việc → chờ đàn cạn → chép Postgres + MongoDB → đối chiếu → lật bảng điều phối.
        Bảng chỉ lật ở bước cuối, nên hỏng ở đâu thì trạm này vẫn đang phục vụ.
      </p>

      {notice && (
        <p className={`mb-4 rounded-lg border px-4 py-2 text-sm ${notice.ok ? "border-[rgba(76,201,154,0.4)] text-[var(--color-jade-300)]" : "border-[rgba(255,120,120,0.4)] text-[#f2a0a0]"}`}>
          {notice.message}
        </p>
      )}

      <div className={`mb-5 rounded-xl border px-4 py-3 ${tone}`}>
        <p className="font-semibold">
          {phaseLabel[view.phase]}
          {view.targetId && ` → ${view.targetName}`}
        </p>
        {view.note && <p className="mt-1 text-xs">{view.note}</p>}
        {busy && (
          <p className="mt-2 text-xs">
            Bảng {Math.min(view.tableIndex + 1, view.tableCount)}/{view.tableCount}
            {view.currentTable && ` (${view.currentTable})`} · đã chép {view.copiedRows.toLocaleString("vi-VN")} dòng
            {view.phase === "draining" && ` · còn ${view.drain.running} đàn đang chạy`}
          </p>
        )}
      </div>

      {/* THỨ TỰ HAI NHÁNH NÀY LÀ PHẦN QUAN TRỌNG, không phải chi tiết trình bày.

          Câu「trạm này KHÔNG phải trạm đang hoạt động」chỉ đúng khi nơi đây THẬT SỰ là một trạm.
          Đọc nhầm thứ tự thì backend trên VM — nơi duy nhất còn phục vụ — bị chính trang này
          buộc tội là một trạm đã nghỉ, kèm lời khuyên「hãy sang trạm đang phục vụ mà thao tác」,
          tức bảo người ta đi tới đúng chỗ họ đang đứng. Đó là bản đã sống trên production từ
          16/08/2026 tới khi được vá. */}
      {!view.backendIsStation ? (
        <div className="mb-4 rounded-lg border border-[rgba(232,194,92,0.35)] px-4 py-3 text-sm">
          <p className="text-[var(--color-gold-300)]">Lượt chuyển trạm đã hết việc từ 16/08/2026.</p>
          <p className="mt-1 text-xs text-[var(--color-mist)]">
            Nơi bạn đang đứng là backend trên VM: cả năm trạm Vercel chỉ chuyển tiếp request về đây, và
            database nằm ngay cạnh nó. Không còn「trạm đang hoạt động」nào để chuyển đi, cũng không còn
            bảng nào để lật — nên bảng điều khiển này chỉ giữ lại phần dọn dẹp một lượt chuyển cũ.
          </p>
          <p className="mt-1 text-xs text-[var(--color-mist)]">
            Sổ gương bên dưới thì VẪN DÙNG: nó là danh mục năm tài khoản Vercel giữ các vỏ, và bảng
            hạn mức đọc chìa từ chính sổ ấy.
          </p>
        </div>
      ) : !view.isActiveSite ? (
        <p className="mb-4 rounded-lg border border-[rgba(255,120,120,0.45)] px-4 py-2 text-sm text-[#f2a0a0]">
          Trạm này ({view.currentSiteId}) KHÔNG phải trạm đang hoạt động. Lệnh chuyển phải phát từ trạm
          đang phục vụ — phát từ đây sẽ chép một database đã nghỉ đè lên trạm đích.
        </p>
      ) : null}

      {view.isActiveSite && !view.selfInBook && view.currentSiteId && (
        <div className="mb-4 rounded-lg border border-[rgba(232,194,92,0.45)] px-4 py-3 text-sm">
          <p className="text-[var(--color-gold-300)]">
            Sổ chưa có entry cho chính trạm này ({view.currentSiteId}).
          </p>
          <p className="mt-1 text-xs text-[var(--color-mist)]">
            Sổ đi theo dữ liệu sang trạm mới mỗi lượt chuyển. Thiếu entry của trạm này thì sau khi chuyển đi,
            bên kia không còn ai để pick mà quay về.
          </p>
          <button
            type="button"
            className="btn btn-ghost mt-2 text-sm"
            onClick={() =>
              startTransition(async () => {
                const res = await registerSelfAction();
                setNotice(res);
                setView(await switchStateForAdmin());
                router.refresh();
              })
            }
            disabled={pending}
          >
            Ghi trạm này vào sổ
          </button>
        </div>
      )}

      {/* Backend không phải một trạm thì KHÔNG dựng form: một cái form không bao giờ bấm được
          chỉ mời người ta điền vào rồi thất vọng, mà tệ hơn là nó gợi ý rằng vẫn còn một lượt
          chuyển đáng phát nếu gỡ được cái chặn. Phần dọn lượt chuyển dở bên dưới vẫn ở lại. */}
      {ranh && view.backendIsStation && (
        <form
          className="flex flex-col gap-3"
          action={async (fd) => {
            const res = await beginSwitchAction(null, fd);
            setNotice(res);
            setView(await switchStateForAdmin());
            if (res.ok) setConfirmText("");
            router.refresh();
          }}
        >
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="label" htmlFor="switch-target">Chuyển sang trạm</label>
              <select
                id="switch-target"
                name="targetId"
                className="input"
                value={targetId}
                onChange={(e) => setTargetId(e.target.value)}
                required
              >
                {candidates.length === 0 && <option value="">(sổ chưa có trạm nào khác)</option>}
                {candidates.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} — {m.id}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="switch-confirm">Gõ lại mã trạm để xác nhận</label>
              <input
                id="switch-confirm"
                name="confirm"
                className="input font-mono"
                placeholder={targetId || "mã trạm"}
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                autoComplete="off"
                required
              />
            </div>
            <button type="submit" className="btn btn-primary" disabled={candidates.length === 0 || confirmText !== targetId || !view.isActiveSite}>
              Bắt đầu chuyển
            </button>
          </div>
          <p className="text-xs text-[var(--color-mist)]">
            Bấm là tông môn bế quan ngay. Đàn đang chạy vẫn đi hết vòng, đàn trong hàng chờ đứng lại.
          </p>
        </form>
      )}

      {!ranh && (
        <div className="flex flex-wrap gap-3">
          {busy && (
            <button type="button" className="btn btn-primary" onClick={() => setRunning((r) => !r)}>
              {running ? "Tạm dừng" : "Chạy tiếp"}
            </button>
          )}
          {/* Đích trùng chính trạm này thì nút vô nghĩa — server cũng chặn, đây chỉ là để
              người ta khỏi bấm vào một cú bấm không đi tới đâu. Cùng lý do với `backendIsStation`:
              trên VM thì không có bảng nào để lật, chỉ còn「Huỷ lượt chuyển」là việc thật. */}
          {view.backendIsStation && view.phase === "done" && !(view.currentSiteId && view.targetId === view.currentSiteId) && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                if (!confirmFlip(view.targetName)) return;
                startTransition(async () => {
                  const res = await flipSwitchAction();
                  setNotice(res);
                  setView(await switchStateForAdmin());
                  router.refresh();
                });
              }}
              disabled={pending}
            >
              Lật sang trạm mới
            </button>
          )}
          <button type="button" className="btn btn-ghost" onClick={refresh} disabled={pending}>
            Xem lại trạng thái
          </button>
          <button
            type="button"
            className="btn btn-ghost text-[#f2a0a0]"
            onClick={() => {
              setRunning(false);
              startTransition(async () => {
                const res = await abortSwitchAction();
                setNotice(res);
                setView(await switchStateForAdmin());
                router.refresh();
              });
            }}
            disabled={pending}
          >
            Huỷ lượt chuyển
          </button>
        </div>
      )}
    </section>
  );
}

/** Xác nhận lần cuối trước cú bấm không quay lại được bằng một cú bấm khác. */
function confirmFlip(name: string): boolean {
  return window.confirm(
    `Lật bảng điều phối sang「${name}」?\n\n` +
      "Sau lệnh này, người dùng mở URL trạm hiện tại sẽ bị chuyển hướng sang trạm mới trong ~30 giây. " +
      "Quay về được, nhưng phải chạy một lượt chuyển ngược đầy đủ.",
  );
}
