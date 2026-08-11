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

  const notice = [saveState, probeState, deleteState].find((s) => s !== null);

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
            {mirrors.map((m) => (
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
