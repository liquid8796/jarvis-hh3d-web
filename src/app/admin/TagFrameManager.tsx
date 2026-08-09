"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { MAX_TAG_LENGTH, type TagFrame } from "@/lib/validation/tags";

/**
 * Sổ KHUNG TAG — thẻ trong tab Đàm Đạo, cạnh hạn lưu và nút thanh tẩy: khung là chuyện của
 * Phòng Chat, nên nó ở cùng chỗ với mọi núm khác của Phòng Chat. (Trước 09/08/2026 thẻ này
 * nằm dưới bảng môn đồ ở tab Môn Đồ, vì đó là nơi đặt tag cho người.)
 *
 * Upload đi qua /api/admin/tag-frames chứ không phải server action: bài vị nặng vài MB, vượt
 * trần 1MB của action — xem ghi chú tại route.
 *
 * SỔ ĐI VÀO BẰNG PROP, không tự fetch. Bản đầu thẻ này tự GET lấy sổ, hợp lý khi nó đứng một
 * mình; nhưng chip tag trong hộp Sửa (tab Môn Đồ) cũng cần đúng sổ ấy, mà hai tab là hai
 * nhánh cây khác nhau — để mỗi bên tự fetch là hai bản sao của cùng một thứ, và chúng LỆCH
 * NHAU thật: `AdminTabs` chỉ bật `hidden` chứ không unmount, nên thêm một khung ở tab này rồi
 * sang tab kia sẽ thấy danh sách cũ nằm nguyên đó. Trang admin vốn đã đọc `getAppSettings()`
 * để lấy hạn lưu, nên sổ nằm sẵn trong tay server — truyền xuống là xong.
 *
 * Sau mỗi lần ghi thì `router.refresh()`: route đã `revalidatePath("/admin")` nhưng một route
 * handler không tự làm client vẽ lại (khác server action). Refresh chạy lại server component,
 * và CẢ thẻ này lẫn chip bên tab Môn Đồ cùng nhận sổ mới từ một nguồn.
 */
export function TagFrameManager({ frames }: { frames: TagFrame[] }) {
  const router = useRouter();
  const [notice, setNotice] = useState<{ ok: boolean; message: string } | null>(null);
  const [label, setLabel] = useState("");
  const [isDefault, setIsDefault] = useState(false);
  const [sending, setSending] = useState(false);
  const [refreshing, startRefresh] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  /**
   * Khoá nút cho tới khi server vẽ lại XONG, không chỉ tới khi fetch xong. Giữa hai mốc ấy
   * danh sách trên màn hình vẫn là sổ cũ — cho bấm tiếp là cho bấm lên dữ liệu đã lỗi thời.
   */
  const busy = sending || refreshing;

  const upload = async () => {
    const file = fileRef.current?.files?.[0];
    const cleanLabel = label.trim().replace(/\s+/g, " ");
    if (!file || !cleanLabel) {
      setNotice({ ok: false, message: "Cần đủ hai thứ: nhãn tag và tệp khung." });
      return;
    }

    setSending(true);
    setNotice(null);
    try {
      const body = new FormData();
      body.set("file", file);
      body.set("label", cleanLabel);
      if (isDefault) body.set("isDefault", "1");

      const res = await fetch("/api/admin/tag-frames", { method: "POST", body });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setNotice({ ok: false, message: String(data.error ?? `Upload trượt (HTTP ${res.status}).`) });
        return;
      }

      const frame = data.frame as TagFrame | undefined;
      setLabel("");
      setIsDefault(false);
      if (fileRef.current) fileRef.current.value = "";
      setNotice({
        ok: true,
        message: `Đã thêm khung「${frame?.label ?? cleanLabel}」${frame?.isDefault ? " (mặc định)" : ""}.`,
      });
      startRefresh(() => router.refresh());
    } finally {
      setSending(false);
    }
  };

  const remove = async (frame: TagFrame) => {
    if (!window.confirm(`Gỡ khung「${frame.label}」? Ai đeo tag này sẽ thấy tag dạng chữ như trước.`)) return;

    setSending(true);
    setNotice(null);
    try {
      const res = await fetch("/api/admin/tag-frames", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: frame.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // Gồm cả ca người khác vừa gỡ mất nó (404) — refresh vẫn chạy để sổ trên màn hình
        // thôi hiện một khung không còn tồn tại.
        setNotice({ ok: false, message: String(data.error ?? `Gỡ trượt (HTTP ${res.status}).`) });
        startRefresh(() => router.refresh());
        return;
      }
      setNotice({ ok: true, message: `Đã gỡ khung「${frame.label}」.` });
      startRefresh(() => router.refresh());
    } finally {
      setSending(false);
    }
  };

  return (
    <section className="card card-hairline p-6">
      <h2 className="h-display mb-2 text-lg font-semibold text-gilded">Khung Tag</h2>
      <p className="mb-5 text-sm text-[var(--color-mist)]">
        Bài vị hoa văn hiện cạnh tên trong Phòng Chat. Đạo hữu đeo tag trùng nhãn nào thì mang
        khung ấy; khung đánh dấu <span className="text-gilded">mặc định</span> dành cho người
        chưa có tag. Ảnh nên là webp/png nền trong suốt, ngang ~3:1, chữ khắc sẵn trong ảnh.
      </p>

      {frames.length === 0 ? (
        <p className="mb-4 text-sm text-[var(--color-mist)]">
          Sổ còn trống. Gieo bộ khung gốc bằng <code className="font-mono text-xs">npm run seed:tag-frames</code>,
          hoặc upload tấm đầu tiên ngay dưới đây.
        </p>
      ) : (
        <ul className="mb-6 grid gap-3 sm:grid-cols-2">
          {frames.map((frame) => (
            <li key={frame.id} className="tagframe-row">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={frame.url} alt={frame.label} loading="lazy" decoding="async" />
              <span className="tagframe-row-label">
                {frame.label}
                {frame.isDefault && <i>mặc định — cho người chưa có tag</i>}
              </span>
              <button
                type="button"
                className="btn btn-danger"
                disabled={busy}
                onClick={() => void remove(frame)}
              >
                Gỡ
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="label" htmlFor="frame-label">
            Nhãn tag của khung mới
          </label>
          <input
            id="frame-label"
            className="input max-w-[16rem]"
            value={label}
            maxLength={MAX_TAG_LENGTH}
            placeholder="Ví dụ: Hộ pháp"
            onChange={(e) => setLabel(e.target.value)}
          />
        </div>
        <div>
          <label className="label" htmlFor="frame-file">
            Tệp khung
          </label>
          <input id="frame-file" ref={fileRef} type="file" accept="image/*" className="input" />
        </div>
        <label className="flex items-center gap-2 pb-2 text-sm">
          <input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} />
          Làm khung mặc định
        </label>
        <button type="button" className="btn btn-gold" disabled={busy} onClick={() => void upload()}>
          {busy ? "Đang khắc…" : "Thêm Khung"}
        </button>
      </div>

      {notice && (
        <p role="status" className={`mt-3 text-sm ${notice.ok ? "text-[var(--color-jade-300)]" : "text-[#f2a0a0]"}`}>
          {notice.message}
        </p>
      )}
    </section>
  );
}
