"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { CHANGELOG_SEEN_KEY, hasUnseenNote, type ReleaseNote } from "@/lib/changelog";

/**
 * DẤU BẢN, nay bấm được: mở ra bản tin cập nhật của những lượt phát hành gần đây.
 *
 * Trước bản này nó là một dòng chữ chết ở góc màn hình — đúng số bản, mà số bản thì chẳng nói
 * cho ai điều gì. Đạo hữu mở trang lên chỉ thấy「v0.84.0」và không có đường nào biết hôm nay
 * cái gì vừa đổi.
 *
 * CHẤM BÁO TIN, và vì sao nó đọc localStorage chứ không hỏi server: câu hỏi ở đây là「MÁY NÀY
 * đã xem tin của bản này chưa」, không phải「người này đã xem chưa」. Người dùng mở trang trên
 * điện thoại rồi trên máy bàn là hai lần đáng báo. Nó cũng là thứ không đáng tốn một cột
 * database và một lượt ghi mỗi khi có người liếc qua.
 *
 * Đọc kho trong `useEffect`, KHÔNG đọc lúc dựng state: localStorage không tồn tại phía server,
 * nên đọc sớm là lượt render đầu ở hai bên lệch nhau và React kêu hydration mismatch. Lượt
 * render đầu vì thế luôn「chưa có chấm」rồi chấm mới hiện ra — đúng thứ tự an toàn.
 */
export function ChangelogTag({ version, notes }: { version: string; notes: readonly ReleaseNote[] }) {
  const latest = notes[0] ?? null;
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    // `undefined` = không đọc nổi kho. Giữ nguyên giá trị ấy chứ đừng hạ xuống `null`: hai
    // thứ dẫn tới hai hành vi khác nhau ở `hasUnseenNote`.
    try {
      setSeen(window.localStorage.getItem(CHANGELOG_SEEN_KEY));
    } catch {
      setSeen(undefined);
    }
  }, []);

  // Đóng bằng Escape — một hộp phủ mà chỉ đóng được bằng cách nhắm trúng cái nút thì phiền,
  // nhất là trên màn hẹp. Cùng lối với popup mức dùng bên tab Gương Trạm.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const unseen = hasUnseenNote(seen, latest?.version ?? null);

  const openPanel = () => {
    setOpen(true);
    if (!latest) return;
    // Ghi mốc đã đọc NGAY lúc mở, không đợi lúc đóng: người ta đọc xong rồi bỏ tab đó đi là
    // chuyện thường, và khi ấy một cái chấm vẫn còn nguyên nghĩa là tin đã đọc vẫn kêu.
    setSeen(latest.version);
    try {
      window.localStorage.setItem(CHANGELOG_SEEN_KEY, latest.version);
    } catch {
      // Kho bị chặn thì chấm cũng đã tắt cho phiên này (state ở trên). Không có gì để cứu, và
      // một tính năng trang trí không được phép làm vỡ trang vì chuyện ấy.
    }
  };

  // Chưa có tin nào thì dấu bản trở lại đúng thứ nó vốn là: một dòng chữ. Một cái nút bấm vào
  // không ra gì còn tệ hơn không có nút.
  if (notes.length === 0) {
    return <p className="app-version">v{version}</p>;
  }

  return (
    <>
      {/* `--interactive` trả độ mờ về cho chính cái nút: `.app-version` mờ 0.55 cho DẠNG CHỮ,
          mà đổ độ mờ ấy lên cả khối thì chấm báo tin cũng mờ theo — một tín hiệu mờ đi một nửa
          là một tín hiệu người ta không thấy. */}
      <div className="app-version app-version--interactive">
        <button
          type="button"
          className="app-version__btn"
          onClick={openPanel}
          aria-haspopup="dialog"
          aria-expanded={open}
        >
          v{version}
          {unseen && <span className="app-version__dot" aria-label="có tin mới" />}
        </button>
      </div>

      {/* Cổng ra `document.body` vì `.app-version` là một khối `position: fixed` mang z-index
          riêng — vẽ hộp thoại bên trong nó là tự nhốt hộp vào đúng cái tầng ấy. Cùng lý do đã
          chép ở popup mức dùng Vercel. */}
      {open &&
        createPortal(
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(6,8,20,0.72)] p-4"
            onClick={(event) => {
              if (event.target === event.currentTarget) setOpen(false);
            }}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-label="Bản tin cập nhật"
              className="card card-hairline max-h-[80vh] w-full max-w-md overflow-y-auto p-6"
            >
              <div className="mb-4 flex items-start justify-between gap-4">
                <h2 className="h-display text-lg font-semibold text-gilded">Có gì mới</h2>
                <button
                  type="button"
                  className="btn btn-ghost px-2 py-0.5 text-sm"
                  onClick={() => setOpen(false)}
                >
                  ✕
                </button>
              </div>

              <div className="flex flex-col gap-5">
                {notes.map((note) => (
                  <section key={note.version}>
                    <p className="mb-1 flex items-baseline gap-2 text-xs text-[var(--color-mist)]">
                      <span className="font-mono text-[var(--color-gold-300)]">v{note.version}</span>
                      <span>{note.date}</span>
                    </p>
                    <ul className="flex list-disc flex-col gap-1 pl-4 text-sm">
                      {note.lines.map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
