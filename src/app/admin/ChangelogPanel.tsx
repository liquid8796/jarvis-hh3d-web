"use client";

import { useActionState, useState } from "react";
import { saveChangelogAction, type AdminResult } from "@/app/actions/admin";
import { MAX_LINES_PER_NOTE, MAX_LINE_LENGTH, formatNotesText, parseNotesText, type ReleaseNote } from "@/lib/changelog";

/**
 * SỬA BẢN TIN CẬP NHẬT — thứ đạo hữu đọc khi bấm vào dấu bản ở góc màn hình.
 *
 * MỘT Ô CHỮ, không phải một biểu mẫu lặp. Bốn việc người ta cần làm ở đây — sửa lời, thêm mục,
 * bỏ mục, đổi thứ tự — trong một biểu mẫu lặp là bốn cụm nút và một mớ state; trong một ô chữ
 * thì là gõ. Cái giá phải trả là một cú pháp, nên cú pháp ấy được giữ đúng bằng thứ người ta
 * vốn viết trong ghi chú, và lỗi thì mang SỐ DÒNG.
 *
 * XEM TRƯỚC ngay dưới ô: bản tin là chữ người lạ đọc, mà người gõ thì không thấy nó cho tới khi
 * bấm Lưu rồi mở dấu bản lên xem. Khối xem trước đọc bằng CHÍNH `parseNotesText` mà server dùng,
 * nên thứ hiện ra ở đây là thứ sẽ được lưu — không phải một phép dựng lại gần đúng.
 */
export function ChangelogPanel({ notes, appVersion }: { notes: readonly ReleaseNote[]; appVersion: string }) {
  const [state, action, pending] = useActionState<AdminResult | null, FormData>(saveChangelogAction, null);
  const [text, setText] = useState(() => formatNotesText(notes));

  const parsed = parseNotesText(text);
  const preview = parsed.ok ? parsed.notes : [];
  const hasVersionNote = preview.some((note) => note.version === appVersion);

  return (
    <section className="card card-hairline p-6">
      <h2 className="h-display mb-1 text-lg font-semibold text-gilded">Bản tin cập nhật</h2>
      <p className="mb-4 text-xs leading-relaxed text-[var(--color-mist)]">
        Đây là thứ đạo hữu đọc khi bấm số hiệu bản ở góc màn hình. Viết ngắn, đủ ý, bằng tiếng
        người — kể cái người ta THẤY, đừng kể cách nó chạy bên trong.
      </p>

      <form action={action}>
        <label className="label" htmlFor="changelogNotes">
          Mỗi mục mở đầu bằng「số bản · ngày」, mỗi ý một dòng bắt đầu bằng dấu −
        </label>
        <textarea
          id="changelogNotes"
          name="notes"
          className="input min-h-[16rem] font-mono text-xs leading-relaxed"
          value={text}
          onChange={(event) => setText(event.target.value)}
          spellCheck={false}
        />

        <p className="mt-2 text-xs text-[var(--color-mist)]">
          Tối đa {MAX_LINES_PER_NOTE} dòng mỗi mục, mỗi dòng dưới {MAX_LINE_LENGTH} ký tự. Thứ tự
          tự xếp lại theo số bản khi lưu, khỏi phải tự sắp.
        </p>

        {/* Ba điều dễ hiểu sai, nói tại chỗ thay vì để người ta tự phát hiện bằng cách mất công. */}
        <ul className="mt-3 flex list-disc flex-col gap-1 pl-4 text-xs text-[var(--color-mist)]">
          <li>
            Xoá sạch ô rồi Lưu = bỏ hết phần sửa tay, bản tin trở lại đúng danh sách đi kèm bản
            phát hành.
          </li>
          <li>
            Gỡ một mục khỏi ô rồi Lưu là <strong className="text-[var(--color-parchment)]">gỡ hẳn</strong> — nó
            không mọc lại. Muốn lấy lại thì gõ lại số bản ấy vào ô.
          </li>
          <li>
            Mục của những bản phát hành SAU vẫn tự hiện ra, kể cả khi đã có sửa tay ở đây.
          </li>
          <li>Mục cho bản mới nhất nên có mặt: người ta bấm vào số hiệu bản là để tìm đúng nó.</li>
        </ul>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button type="submit" className="btn btn-gold" disabled={pending || !parsed.ok}>
            {pending ? "Đang lưu…" : "Lưu bản tin"}
          </button>
          {!parsed.ok && <span className="text-xs text-[#f2a0a0]">{parsed.message}</span>}
          {parsed.ok && !hasVersionNote && (
            <span className="text-xs text-[var(--color-gold-300)]">
              Chưa có mục nào cho v{appVersion} — bản đang chạy sẽ không có tin nào để đọc.
            </span>
          )}
          {state && (
            <span className={`text-xs ${state.ok ? "text-[var(--color-jade-300)]" : "text-[#f2a0a0]"}`}>
              {state.message}
            </span>
          )}
        </div>
      </form>

      <div className="mt-6 border-t border-[rgba(232,194,92,0.18)] pt-4">
        <p className="mb-3 text-xs text-[var(--color-mist)]">
          Xem trước — đúng thứ sẽ hiện trong hộp「Có gì mới」:
        </p>
        {preview.length === 0 ? (
          <p className="text-xs text-[var(--color-mist)]">
            {parsed.ok
              ? "Ô đang trống: bản tin sẽ lấy nguyên danh sách đi kèm bản phát hành."
              : "Chưa đọc được — sửa lỗi ở trên rồi phần xem trước hiện lại."}
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            {preview.map((note) => (
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
        )}
      </div>
    </section>
  );
}
