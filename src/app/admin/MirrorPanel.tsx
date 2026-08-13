"use client";

import { useActionState, useState } from "react";
import { MirrorSwitchPanel } from "./MirrorSwitchPanel";
import { MirrorUsage } from "./MirrorUsage";
import type { SwitchView } from "@/app/actions/mirrorSwitch";
import {
  deleteMirrorAction,
  probeMirrorAction,
  saveMirrorAction,
  type MirrorResult,
  type MirrorView,
} from "@/app/actions/mirrors";

/**
 * Số trạm mỗi trang của sổ. Chọn 4 chứ không phải 5, và lý do rất cụ thể: sổ hôm nay có ĐÚNG 5
 * trạm, nên đặt 5 là dựng một thanh lật trang không bao giờ hiện ra trên chính dữ liệu thật —
 * một tính năng chỉ tồn tại trong lý thuyết.
 *
 * Ràng buộc thật đứng sau con số: bên dưới sổ là form「Ghi trạm mới」, và đó mới là thứ người
 * vận hành xuống đây để dùng. Sổ dài vô hạn nằm trên nó là cách chắc chắn nhất để chôn nó.
 */
const MIRRORS_PER_PAGE = 4;

/**
 * Tab Gương Trạm — sổ trạm dự phòng (deploy/mirror/README.md §4). Tab CHỈ hiện với người
 * mang `site.switch` (page.tsx lọc), nên panel không tự gác nữa — action phía server mới là
 * hàng rào thật.
 *
 * Chuỗi kết nối chỉ ĐI LÊN qua form, không bao giờ đi xuống: server phát MirrorView đã che
 * (host trần), và ô sửa để trống nghĩa là "giữ phong bì cũ".
 *
 * Bảng điều khiển lượt chuyển đứng TRÊN cái sổ (MirrorSwitchPanel): lúc đang chuyển thì nó
 * là thứ duy nhất đáng nhìn, còn lúc rảnh nó chỉ cao vài dòng.
 */
export function MirrorPanel({ mirrors, switchState }: { mirrors: MirrorView[]; switchState: SwitchView }) {
  const [saveState, saveAction, saving] = useActionState<MirrorResult | null, FormData>(saveMirrorAction, null);
  const [probeState, probeAction, probing] = useActionState<MirrorResult | null, FormData>(probeMirrorAction, null);
  const [deleteState, deleteAction, deleting] = useActionState<MirrorResult | null, FormData>(deleteMirrorAction, null);
  /** id đang sửa — đổ sẵn tên/URL vào form; chuỗi kết nối thì không bao giờ đổ lại. */
  const [editing, setEditing] = useState<MirrorView | null>(null);
  /**
   * Trang đang xem. Cố ý KHÔNG đẩy lên URL như ô tìm kiếm ở bảng Môn Đồ: sổ này đã nằm sẵn trọn
   * vẹn trong tay trình duyệt (MirrorSwitchPanel cần cả mảng), nên một `router.replace` mỗi lượt
   * lật trang chỉ đổi lấy một vòng dựng lại trang server mà không đọc thêm được gì.
   */
  const [pageWanted, setPageWanted] = useState(1);

  const notice = [saveState, probeState, deleteState].find((s) => s !== null);

  const totalPages = Math.max(1, Math.ceil(mirrors.length / MIRRORS_PER_PAGE));
  /**
   * Kẹp trang NGAY LÚC VẼ, không bằng `useEffect`: xoá trạm cuối cùng của trang cuối thì `mirrors`
   * co lại ngay ở lượt render kế, mà effect chỉ chạy SAU khi đã vẽ xong — tức người vận hành kịp
   * thấy một cái sổ trống rỗng rồi mới bị kéo về. Kẹp tại chỗ thì không có khung hình nào sai.
   */
  const page = Math.min(pageWanted, totalPages);
  // Ghi lại luôn giá trị đã kẹp. Thiếu dòng này thì xoá-rồi-ghi-trạm-mới làm sổ tự nhảy về đúng
  // cái trang mà người ta vừa bị đá ra khỏi — React cho phép sửa state khi vẽ, miễn là có điều kiện.
  if (pageWanted !== page) setPageWanted(page);

  const firstIndex = (page - 1) * MIRRORS_PER_PAGE;
  const shown = mirrors.slice(firstIndex, firstIndex + MIRRORS_PER_PAGE);

  return (
    <div className="flex flex-col gap-6">
      {notice && (
        <p className={`rounded-lg border px-4 py-2 text-sm ${notice.ok ? "border-[rgba(76,201,154,0.4)] text-[var(--color-jade-300)]" : "border-[rgba(255,120,120,0.4)] text-[#f2a0a0]"}`}>
          {notice.message}
        </p>
      )}

      <MirrorSwitchPanel mirrors={mirrors} initial={switchState} />

      <section className="card card-hairline p-6">
        <h2 className="h-display mb-2 text-lg font-semibold text-gilded">Sổ gương trạm</h2>
        <p className="mb-5 text-xs text-[var(--color-mist)]">
          Mỗi trạm một tài khoản Vercel riêng, database riêng (Neon <code>jarvis-hh3d</code>, Atlas{" "}
          <code>atlas-jarvis-chat</code>) — chỉ VM khôi lỗi và tàng khố OCI là của chung.
        </p>

        {mirrors.length === 0 ? (
          <p className="text-sm text-[var(--color-mist)]">Sổ còn trống — ghi trạm dự phòng đầu tiên ở form dưới.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {shown.map((m) => (
              <div key={m.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-[rgba(232,194,92,0.18)] px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">
                    {m.name} <span className="ml-1 font-mono text-xs text-[var(--color-mist)]">{m.id}</span>
                    {m.id === switchState.currentSiteId && (
                      <span className="ml-2 rounded-full border border-[rgba(76,201,154,0.5)] px-2 py-0.5 text-xs text-[var(--color-jade-300)]">
                        trạm đang phục vụ
                      </span>
                    )}
                  </p>
                  <p className="truncate text-xs text-[var(--color-mist)]">
                    {m.url} · PG {m.pgHost} · Mongo {m.mongoHost}
                  </p>
                  <p className={`text-xs ${m.lastProbeOk ? "text-[var(--color-jade-300)]" : m.lastProbeOk === false ? "text-[#f2a0a0]" : "text-[var(--color-mist)]"}`}>
                    {m.lastProbeAt
                      ? `Kiểm mạch ${new Date(m.lastProbeAt).toLocaleString("vi-VN")}: ${m.lastProbeNote}`
                      : "Chưa kiểm mạch lần nào."}
                  </p>
                  <MirrorUsage mirror={m} />
                </div>
                <form action={probeAction}>
                  <input type="hidden" name="id" value={m.id} />
                  <button type="submit" className="btn btn-ghost text-sm" disabled={probing}>
                    {probing ? "Đang kiểm…" : "Kiểm mạch"}
                  </button>
                </form>
                <button type="button" className="btn btn-ghost text-sm" onClick={() => setEditing(m)}>
                  Sửa
                </button>
                <form
                  action={deleteAction}
                  onSubmit={(e) => {
                    // Xoá là mất phong bì credential — một cú bấm nhầm không được phép đủ.
                    if (!confirm(`Xoá trạm「${m.name}」khỏi sổ? Chuỗi kết nối đã mã hoá sẽ mất theo.`)) e.preventDefault();
                  }}
                >
                  <input type="hidden" name="id" value={m.id} />
                  <button type="submit" className="btn btn-ghost text-sm text-[#f2a0a0]" disabled={deleting}>
                    Xoá
                  </button>
                </form>
              </div>
            ))}
          </div>
        )}

        {/* Sổ một trang thì thanh lật trang chỉ là tiếng ồn — nó mọc đúng từ trạm thứ NĂM.
            Đánh số thẳng, không có「trước/sau」: ở cỡ này (vài trạm) một cú bấm là tới bất kỳ
            trang nào, và không nút nào bị tắt lúc đang mang focus — bấm「sau」để tới trang cuối
            rồi thấy chính nút vừa bấm hoá xám là cách chắc chắn nhất để người đi bằng phím mất
            dấu mình đang đứng đâu. */}
        {totalPages > 1 && (
          <nav
            aria-label="Lật trang sổ gương trạm"
            className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-[rgba(232,194,92,0.14)] pt-3"
          >
            <p className="text-xs tabular-nums text-[var(--color-mist)]">
              Trạm {firstIndex + 1}–{firstIndex + shown.length} trong {mirrors.length}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {Array.from({ length: totalPages }, (_, i) => i + 1).map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setPageWanted(n)}
                  aria-label={`Trang ${n}`}
                  aria-current={n === page ? "page" : undefined}
                  className={`h-9 min-w-[2.25rem] rounded-lg border px-2 text-sm font-semibold tabular-nums transition-colors ${
                    n === page
                      ? "border-[rgba(232,194,92,0.5)] bg-[rgba(232,194,92,0.14)] text-[var(--color-gold-300)]"
                      // Trang KHÔNG đứng vẫn phải mang viền: mọi thứ bấm được trên tab này đều có
                      // viền vàng, nên một con số trần nằm cạnh「Kiểm mạch / Sửa / Xoá」đọc ra là
                      // chữ chết chứ không phải nút. Nhạt hơn hẳn ô đang đứng là đủ để phân cấp.
                      : "border-[rgba(232,194,92,0.22)] text-[var(--color-mist)] hover:border-[rgba(232,194,92,0.5)] hover:text-[var(--color-gold-300)]"
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
          </nav>
        )}
      </section>

      <section className="card card-hairline max-w-2xl p-6">
        <h2 className="h-display mb-5 text-lg font-semibold text-gilded">
          {editing ? `Sửa trạm「${editing.name}」` : "Ghi trạm mới"}
        </h2>
        {/* key ép React dựng lại form khi đổi giữa thêm/sửa — defaultValue chỉ đọc lúc mount. */}
        <form key={editing?.id ?? "new"} action={saveAction} className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-4">
            <div>
              <label className="label" htmlFor="mirror-id">Mã trạm (SITE_ID bên kia)</label>
              <input id="mirror-id" name="id" className="input font-mono" placeholder="mirror-b"
                defaultValue={editing?.id ?? ""} readOnly={editing !== null} required />
            </div>
            <div className="min-w-[16rem] flex-1">
              <label className="label" htmlFor="mirror-name">Tên gọi</label>
              <input id="mirror-name" name="name" className="input w-full" placeholder="Trạm B — tài khoản dự phòng"
                defaultValue={editing?.name ?? ""} required />
            </div>
          </div>
          <div>
            <label className="label" htmlFor="mirror-url">URL trạm</label>
            <input id="mirror-url" name="url" type="url" className="input w-full font-mono"
              placeholder="https://<project>.vercel.app" defaultValue={editing?.url ?? ""} required />
          </div>
          <div>
            <label className="label" htmlFor="mirror-pg">
              DATABASE_URL (Neon jarvis-hh3d của trạm kia){editing && " — để trống là giữ phong bì cũ"}
            </label>
            <input id="mirror-pg" name="pg" type="password" className="input w-full font-mono"
              placeholder={editing ? `đang giữ ${editing.pgHost}` : "postgresql://…"} autoComplete="off" />
          </div>
          <div>
            <label className="label" htmlFor="mirror-mongo">
              MONGODB_URI (Atlas atlas-jarvis-chat của trạm kia){editing && " — để trống là giữ phong bì cũ"}
            </label>
            <input id="mirror-mongo" name="mongo" type="password" className="input w-full font-mono"
              placeholder={editing ? `đang giữ ${editing.mongoHost}` : "mongodb+srv://…"} autoComplete="off" />
          </div>
          <div>
            <label className="label" htmlFor="mirror-vercel">
              Vercel API token của tài khoản giữ trạm này — để đọc mức dùng 30 ngày
              {editing && (editing.hasVercelToken ? " (để trống là giữ token cũ)" : " (chưa có)")}
            </label>
            <input id="mirror-vercel" name="vercelToken" type="password" className="input w-full font-mono"
              placeholder={editing?.hasVercelToken ? "đang giữ một token — dán cái mới để thay" : "vercel_…"}
              autoComplete="off" />
            {/* Nói ngay chỗ lấy: token này KHÔNG phải thứ ai cũng biết đào ở đâu, và một cái
                token dán nhầm tài khoản thì bảng usage nói về một trạm khác mà không ai hay. */}
            <p className="mt-1 text-xs text-[var(--color-mist)]">
              Lấy ở <code>vercel.com/account/tokens</code> — phải đăng nhập ĐÚNG tài khoản giữ trạm
              này. Tuỳ chọn: thiếu nó thì trạm vẫn chuyển được, chỉ là không đọc được mức dùng.
            </p>
          </div>
          <div className="flex gap-3">
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? "Đang ghi + kiểm mạch…" : editing ? "Cập nhật trạm" : "Ghi vào sổ"}
            </button>
            {editing && (
              <button type="button" className="btn btn-ghost" onClick={() => setEditing(null)}>
                Thôi, ghi trạm mới
              </button>
            )}
          </div>
        </form>
      </section>
    </div>
  );
}
