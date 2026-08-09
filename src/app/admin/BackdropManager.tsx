"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import {
  BACKDROP_PAGES,
  DEFAULT_SLOT,
  type BackdropChoice,
  type BackdropImage,
  backdropDisplayName,
} from "@/lib/validation/backdrops";

/**
 * Kho ẢNH NỀN và bảng gán nền cho từng trang — thẻ của tab Giao Diện.
 *
 * Ba khối, và thứ tự ấy là thứ tự người ta làm việc: tải một tấm lên → thấy nó trong lưới →
 * gán nó cho một trang.
 *
 * LƯỚI ẢNH ĐỌC THẲNG TỪ KHO, không từ một sổ trong app_settings — khác hẳn Khung Tag. Nghĩa
 * là không có hai bản danh sách để mà lệch nhau, và một tấm tải lên là thấy ngay dù chưa gán
 * cho trang nào. Cái giá: kho không giữ nhãn, nên tên hiển thị phải suy từ key
 * (`backdropDisplayName`), và dung lượng thì server đã đọc sẵn khi liệt kê nên nó gửi xuống
 * dạng CHỮ — phép đổi byte thành「1.8 MB」nằm trong media.ts, một module kéo theo cả SDK của
 * S3 nên tuyệt đối không được import vào bundle trình duyệt.
 *
 * Upload đi qua /api/admin/backdrops chứ không phải server action: ảnh nền là thứ nặng nhất
 * trong hệ thống, vượt xa trần 1MB của action.
 *
 * Mọi phép ghi xong đều `router.refresh()`, cùng lý do đã ghi ở TagFrameManager: route handler
 * không tự làm client vẽ lại (khác server action), mà lưới ảnh lẫn bảng gán đều tới từ server.
 */
export function BackdropManager({
  images,
  truncated,
  storeClosed,
  defaultBackdrop,
  pageBackdrops,
}: {
  images: BackdropChoice[];
  truncated: boolean;
  storeClosed: boolean;
  defaultBackdrop: BackdropImage | null;
  pageBackdrops: Record<string, BackdropImage>;
}) {
  const router = useRouter();
  const [notice, setNotice] = useState<{ ok: boolean; message: string } | null>(null);
  const [name, setName] = useState("");
  const [sending, setSending] = useState(false);
  const [refreshing, startRefresh] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  /** Khoá nút tới khi server vẽ lại XONG — giữa hai mốc ấy màn hình vẫn là dữ liệu cũ. */
  const busy = sending || refreshing;

  /** Ô nào đang dùng tấm này — vừa để vẽ huy hiệu, vừa để giải thích khi nút Xoá bị từ chối. */
  const slotsUsing = (key: string): string[] => {
    const used: string[] = [];
    if (defaultBackdrop?.key === key) used.push("Nền mặc định");
    for (const page of BACKDROP_PAGES) {
      if (pageBackdrops[page.key]?.key === key) used.push(page.label);
    }
    return used;
  };

  const upload = async () => {
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setNotice({ ok: false, message: "Chưa chọn tệp ảnh nào." });
      return;
    }

    setSending(true);
    setNotice(null);
    try {
      const body = new FormData();
      body.set("file", file);
      if (name.trim()) body.set("name", name.trim());

      const res = await fetch("/api/admin/backdrops", { method: "POST", body });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setNotice({ ok: false, message: String(data.error ?? `Tải lên trượt (HTTP ${res.status}).`) });
        return;
      }

      setName("");
      if (fileRef.current) fileRef.current.value = "";
      setNotice({ ok: true, message: "Đã thêm một tấm nền vào kho. Chọn trang cho nó ở bảng dưới." });
      startRefresh(() => router.refresh());
    } finally {
      setSending(false);
    }
  };

  const remove = async (image: BackdropChoice) => {
    const used = slotsUsing(image.key);
    if (used.length > 0) {
      setNotice({
        ok: false,
        message: `Tấm này đang dùng cho ${used.join(", ")} — đổi nền của những chỗ ấy trước đã.`,
      });
      return;
    }
    if (!window.confirm(`Xoá「${backdropDisplayName(image.key)}」khỏi tàng khố? Không có đường lui.`)) return;

    setSending(true);
    setNotice(null);
    try {
      const res = await fetch("/api/admin/backdrops", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key: image.key }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setNotice({ ok: false, message: String(data.error ?? `Xoá trượt (HTTP ${res.status}).`) });
        // Cả ca người khác vừa xoá mất nó — vẫn refresh để lưới thôi hiện một tấm không còn.
        startRefresh(() => router.refresh());
        return;
      }
      setNotice({ ok: true, message: "Đã xoá tấm nền khỏi tàng khố." });
      startRefresh(() => router.refresh());
    } finally {
      setSending(false);
    }
  };

  const assign = async (slot: string, key: string | null, label: string) => {
    setSending(true);
    setNotice(null);
    try {
      const res = await fetch("/api/admin/backdrops", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slot, key }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setNotice({ ok: false, message: String(data.error ?? `Đổi nền trượt (HTTP ${res.status}).`) });
        startRefresh(() => router.refresh());
        return;
      }
      setNotice({
        ok: true,
        message: key === null ? `${label} trở về nền mặc định.` : `Đã đổi nền cho ${label}.`,
      });
      startRefresh(() => router.refresh());
    } finally {
      setSending(false);
    }
  };

  /** Ô mặc định đứng đầu bảng: nó là nền trang chủ VÀ là chỗ mọi trang khác rơi về. */
  const slots = [
    {
      slot: DEFAULT_SLOT,
      label: "Nền mặc định",
      hint: "Trang chủ, và mọi trang chưa chọn riêng",
      chosen: defaultBackdrop,
    },
    ...BACKDROP_PAGES.map((page) => ({
      slot: page.key as string,
      label: page.label,
      hint: page.path,
      chosen: pageBackdrops[page.key] ?? null,
    })),
  ];

  return (
    <section className="card card-hairline p-6">
      <h2 className="h-display mb-2 text-lg font-semibold text-gilded">Ảnh Nền</h2>
      <p className="mb-5 text-sm text-[var(--color-mist)]">
        Tấm tranh nằm sau mọi nội dung. Ảnh nên ngang, tỉ lệ 16:9 và vùng bên trái tối màu — cột
        nội dung nằm ở đó. Trang chưa chọn riêng thì dùng nền mặc định; nếu cả nền mặc định cũng
        chưa đặt, tông môn dùng tấm gốc đi kèm mã nguồn.
      </p>

      {storeClosed ? (
        <p className="mb-5 text-sm text-[#f2a0a0]">
          Tàng khố media chưa mở — tông chủ cần tạo kho OCI Object Storage trước khi thêm ảnh nền.
          Trong lúc đó mọi trang dùng tấm nền gốc.
        </p>
      ) : (
        <>
          {images.length === 0 ? (
            <p className="mb-5 text-sm text-[var(--color-mist)]">
              Kho ảnh nền còn trống — tải tấm đầu tiên lên ngay dưới đây.
            </p>
          ) : (
            <ul className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {images.map((image) => {
                const used = slotsUsing(image.key);
                return (
                  <li key={image.key} className="card overflow-hidden p-0">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={image.url}
                      alt={backdropDisplayName(image.key)}
                      loading="lazy"
                      decoding="async"
                      className="aspect-video w-full object-cover"
                    />
                    <div className="flex items-center justify-between gap-2 px-3 py-2">
                      <span className="min-w-0">
                        <span className="block truncate text-sm">{backdropDisplayName(image.key)}</span>
                        <span className="block text-xs text-[var(--color-mist)]">
                          {image.sizeLabel}
                          {used.length > 0 && ` · đang dùng: ${used.join(", ")}`}
                        </span>
                      </span>
                      <button
                        type="button"
                        className="btn btn-danger shrink-0"
                        disabled={busy || used.length > 0}
                        title={used.length > 0 ? `Đang dùng cho ${used.join(", ")}` : undefined}
                        onClick={() => void remove(image)}
                      >
                        Xoá
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {truncated && (
            <p className="mb-4 text-sm text-[var(--color-mist)]">
              Kho còn nhiều ảnh hơn số hiện ở đây — lưới chỉ nạp một số lượng vừa đủ để chọn bằng
              mắt. Xoá bớt tấm không dùng nữa để thấy phần còn lại.
            </p>
          )}

          <div className="mb-8 flex flex-wrap items-end gap-3">
            <div>
              <label className="label" htmlFor="backdrop-name">
                Tên gợi nhớ (tuỳ chọn)
              </label>
              <input
                id="backdrop-name"
                className="input max-w-[16rem]"
                value={name}
                maxLength={48}
                placeholder="Ví dụ: Tử Linh Tiên Tử"
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div>
              <label className="label" htmlFor="backdrop-file">
                Tệp ảnh nền
              </label>
              <input id="backdrop-file" ref={fileRef} type="file" accept="image/*" className="input" />
            </div>
            <button type="button" className="btn btn-gold" disabled={busy} onClick={() => void upload()}>
              {busy ? "Đang treo tranh…" : "Thêm Ảnh Nền"}
            </button>
          </div>
        </>
      )}

      <h3 className="h-display mb-3 text-base font-semibold text-gilded">Nền của từng trang</h3>
      <ul className="flex flex-col gap-2">
        {slots.map((entry) => (
          <li key={entry.slot} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--color-gold-300)]/12 px-3 py-2">
            <span className="min-w-0">
              <span className="block text-sm">{entry.label}</span>
              <span className="block text-xs text-[var(--color-mist)]">{entry.hint}</span>
            </span>
            <select
              className="input max-w-[18rem]"
              aria-label={`Nền của ${entry.label}`}
              disabled={busy || storeClosed}
              value={entry.chosen?.key ?? ""}
              onChange={(e) => void assign(entry.slot, e.target.value || null, entry.label)}
            >
              <option value="">
                {entry.slot === DEFAULT_SLOT ? "— tấm gốc đi kèm mã nguồn —" : "— theo nền mặc định —"}
              </option>
              {/* Tấm đang được chọn có thể KHÔNG còn trong lưới (bị xoá ngoài luồng, hoặc lưới
                  đã chạm trần). Thêm nó vào danh sách để ô select không lặng lẽ nhảy về "theo
                  mặc định" — thứ khiến người ta tưởng mình chưa từng chọn gì. */}
              {entry.chosen && !images.some((image) => image.key === entry.chosen!.key) && (
                <option value={entry.chosen.key}>{backdropDisplayName(entry.chosen.key)} (ngoài lưới)</option>
              )}
              {images.map((image) => (
                <option key={image.key} value={image.key}>
                  {backdropDisplayName(image.key)}
                </option>
              ))}
            </select>
          </li>
        ))}
      </ul>

      {notice && (
        <p role="status" className={`mt-4 text-sm ${notice.ok ? "text-[var(--color-jade-300)]" : "text-[#f2a0a0]"}`}>
          {notice.message}
        </p>
      )}
    </section>
  );
}
