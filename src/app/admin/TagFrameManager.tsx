"use client";

import { useEffect, useRef, useState } from "react";
import { MAX_TAG_LENGTH, type TagFrame } from "@/lib/validation/tags";

/**
 * Sổ KHUNG TAG — thẻ trong tab Môn Đồ, ngay dưới bảng: nơi đặt tag cho đạo hữu thì cũng là
 * nơi quản những bài vị mà tag ấy đeo. Upload đi qua /api/admin/tag-frames (route, không
 * phải action — bài vị nặng vài MB, vượt trần 1MB của server action; xem ghi chú tại route).
 *
 * Thẻ TỰ nuôi dữ liệu qua GET thay vì nhận prop từ trang: trang admin là server component
 * đang được nhiều phiên cùng sửa, và một thẻ tự lo thân thì không bắt ai chen thêm dòng nào
 * vào đó. Đổi lại là một lượt fetch lúc mở tab — rẻ, và sổ thì bé.
 *
 * Cha (UserTable) nhận `onFramesChange` để chip tag trong hộp Sửa mọc theo sổ: upload khung
 * 「Hộ pháp」xong là chip「Hộ pháp」xuất hiện, không cần deploy gì.
 */
export function TagFrameManager({ onFramesChange }: { onFramesChange?: (frames: TagFrame[]) => void }) {
  const [frames, setFrames] = useState<TagFrame[] | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; message: string } | null>(null);
  const [label, setLabel] = useState("");
  const [isDefault, setIsDefault] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const publish = (next: TagFrame[]) => {
    setFrames(next);
    onFramesChange?.(next);
  };

  useEffect(() => {
    let alive = true;
    fetch("/api/admin/tag-frames", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((data: { frames: TagFrame[] }) => {
        if (!alive) return;
        setFrames(data.frames);
        onFramesChange?.(data.frames);
      })
      .catch(() => {
        // Sổ không tải được thì thẻ nói thẳng thay vì giả vờ sổ trống — sổ trống là một
        // trạng thái thật (chưa gieo khung nào), không được trùng hình dạng với lỗi mạng.
        if (alive) setNotice({ ok: false, message: "Không tải được sổ khung — tải lại trang để thử lại." });
      });
    return () => {
      alive = false;
    };
    // onFramesChange là hàm inline của cha — đổi tham chiếu mỗi lượt vẽ, mà sổ thì chỉ cần
    // tải một lần. Đưa nó vào deps là poll vô hạn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const upload = async () => {
    const file = fileRef.current?.files?.[0];
    const cleanLabel = label.trim().replace(/\s+/g, " ");
    if (!file || !cleanLabel) {
      setNotice({ ok: false, message: "Cần đủ hai thứ: nhãn tag và tệp khung." });
      return;
    }

    setBusy(true);
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

      // Server là nguồn sự thật về cờ mặc định (nó vừa có thể giật cờ của khung cũ) — nên
      // dựng lại danh sách theo đúng luật ấy thay vì chỉ append.
      const frame = data.frame as TagFrame;
      publish([...(frames ?? []).map((f) => (frame.isDefault ? { ...f, isDefault: false } : f)), frame]);
      setLabel("");
      setIsDefault(false);
      if (fileRef.current) fileRef.current.value = "";
      setNotice({ ok: true, message: `Đã thêm khung「${frame.label}」${frame.isDefault ? " (mặc định)" : ""}.` });
    } finally {
      setBusy(false);
    }
  };

  const remove = async (frame: TagFrame) => {
    if (!window.confirm(`Gỡ khung「${frame.label}」? Ai đeo tag này sẽ thấy tag dạng chữ như trước.`)) return;

    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch("/api/admin/tag-frames", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: frame.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setNotice({ ok: false, message: String(data.error ?? `Gỡ trượt (HTTP ${res.status}).`) });
        return;
      }
      publish((frames ?? []).filter((f) => f.id !== frame.id));
      setNotice({ ok: true, message: `Đã gỡ khung「${frame.label}」.` });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card card-hairline mt-6 p-6">
      <h2 className="h-display mb-2 text-lg font-semibold text-gilded">Khung Tag</h2>
      <p className="mb-5 text-sm text-[var(--color-mist)]">
        Bài vị hoa văn hiện cạnh tên trong Phòng Chat. Đạo hữu đeo tag trùng nhãn nào thì mang
        khung ấy; khung đánh dấu <span className="text-gilded">mặc định</span> dành cho người
        chưa có tag. Ảnh nên là webp/png nền trong suốt, ngang ~3:1, chữ khắc sẵn trong ảnh.
      </p>

      {frames === null && !notice && <p className="text-sm text-[var(--color-mist)]">Đang mở sổ khung…</p>}

      {frames !== null && frames.length === 0 && (
        <p className="mb-4 text-sm text-[var(--color-mist)]">
          Sổ còn trống. Gieo bộ khung gốc bằng <code className="font-mono text-xs">npm run seed:tag-frames</code>,
          hoặc upload tấm đầu tiên ngay dưới đây.
        </p>
      )}

      {frames !== null && frames.length > 0 && (
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
