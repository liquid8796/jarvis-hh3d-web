"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { issueLinhPhuAction, revokeLinhPhuAction } from "@/app/actions/linhsu";

/**
 * Mục LINH SỨ — nơi đạo hữu thấy ai đang trực và, NẾU MUỐN, tự nuôi một linh sứ riêng.
 *
 * Thứ tự trình bày ở đây là một quyết định, không phải tuỳ tiện: câu trả lời đúng cho hầu
 * hết mọi người là "đạo hữu không cần làm gì cả" — linh sứ tông môn trực sẵn cho tất cả.
 * Nên phần đó lên trước, và phần cài đặt chỉ là lối rẽ cho người muốn lượt chạy đi từ máy
 * mình. Đặt ngược lại là bắt mọi người tưởng mình phải cài gì đó mới dùng được.
 *
 * Và khi đã rẽ vào lối ấy thì đường ngắn nhất là TẢI MỘT TỆP RỒI BẤM ĐÚP, không phải dán
 * một dòng lệnh 300 ký tự vào PowerShell. Tệp được dựng NGAY TRONG TRÌNH DUYỆT bằng Blob:
 * linh phù vốn đã nằm sẵn ở client (action vừa trả về), nên không cần thêm một endpoint,
 * và bí mật không bao giờ phải đi qua một URL để rồi nằm lại trong log máy chủ.
 */

type PresenceWorker = { id: string; lastSeen: string; online: boolean };
type Presence = { sectOnline: boolean; mine: PresenceWorker[] };

const POLL_MS = 12_000;

function timeAgo(iso: string): string {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s} giây trước`;
  if (s < 3600) return `${Math.floor(s / 60)} phút trước`;
  if (s < 86400) return `${Math.floor(s / 3600)} giờ trước`;
  return `${Math.floor(s / 86400)} ngày trước`;
}

function Dot({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden
      className={`inline-block h-2 w-2 shrink-0 rounded-full ${
        on ? "bg-[var(--color-jade-400)]" : "bg-[var(--color-ink-600)]"
      }`}
    />
  );
}

/** Đẩy một chuỗi xuống máy người dùng thành tệp, không qua máy chủ. */
function downloadText(filename: string, text: string, mime: string) {
  // CRLF cho tệp .cmd: cmd.exe của Windows đọc tệp chỉ có LF sai ở những chỗ khó đoán.
  // Chuẩn hoá về LF TRƯỚC rồi mới đổi — phép biến đổi phải bất biến, vì nếu người gọi đã
  // viết sẵn "\r\n" thì một lần thay `\n` mù quáng cho ra "\r\r\n" (đúng lỗi vừa đo được).
  const body = filename.endsWith(".cmd")
    ? text.replace(/\r\n/g, "\n").replace(/\n/g, "\r\n")
    : text.replace(/\r\n/g, "\n");
  const url = URL.createObjectURL(new Blob([body], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Thu hồi ở nhịp sau — thu ngay lập tức thì Safari huỷ luôn cú tải chưa kịp bắt đầu.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function CopyBlock({ label, command }: { label: string; command: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="mt-3 min-w-0">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-[var(--color-parchment)]">{label}</span>
        <button
          type="button"
          className="shrink-0 rounded-md border border-[var(--color-ink-600)] px-2 py-0.5 text-xs text-[var(--color-mist)] hover:text-[var(--color-gold-300)]"
          onClick={() => {
            void navigator.clipboard.writeText(command).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            });
          }}
        >
          {copied ? "Đã chép ✓" : "Chép lệnh"}
        </button>
      </div>
      {/* `min-w-0` + `whitespace-pre-wrap`: dòng lệnh không có chỗ ngắt tự nhiên, để nguyên
          `pre` là nó đẩy phình cả cột (xem ghi chú trong dashboard/page.tsx). */}
      <pre className="min-w-0 overflow-x-auto rounded-lg border border-[var(--color-ink-600)]/60 bg-[var(--color-ink-900)]/60 p-3 text-[11px] leading-relaxed break-all whitespace-pre-wrap text-[var(--color-mist)]">
        {command}
      </pre>
    </div>
  );
}

export function LinhSuPanel({ hasToken: initialHasToken }: { hasToken: boolean }) {
  const [presence, setPresence] = useState<Presence | null>(null);
  const [hasToken, setHasToken] = useState(initialHasToken);
  const [token, setToken] = useState<string | null>(null);
  const [showCommands, setShowCommands] = useState(false);
  const [pending, startTransition] = useTransition();

  const poll = useCallback(async () => {
    try {
      const res = await fetch("/api/linh-su", { cache: "no-store" });
      if (res.ok) setPresence((await res.json()) as Presence);
    } catch {
      /* mạng vấp một nhịp thì giữ màn hình cũ */
    }
  }, []);

  useEffect(() => {
    void poll();
    const timer = setInterval(() => void poll(), POLL_MS);
    return () => clearInterval(timer);
  }, [poll]);

  const issue = () => {
    // Phát lại là THAY linh phù: linh sứ đang chạy bằng linh phù cũ sẽ bị từ chối ngay.
    if (hasToken && !confirm("Phát linh phù mới sẽ vô hiệu linh phù cũ — linh sứ đang dùng nó phải cài lại. Tiếp tục?")) {
      return;
    }
    startTransition(async () => {
      const result = await issueLinhPhuAction();
      if (result.ok) {
        setToken(result.token);
        setHasToken(true);
        setShowCommands(false);
      }
    });
  };

  const revoke = () => {
    if (!confirm("Thu hồi linh phù? Linh sứ riêng của đạo hữu sẽ mất quyền ngay lập tức.")) {
      return;
    }
    startTransition(async () => {
      await revokeLinhPhuAction();
      setToken(null);
      setHasToken(false);
    });
  };

  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const psCommand = token
    ? `powershell -NoProfile -ExecutionPolicy Bypass -Command "$env:LINH_PHU='${token}'; $env:LINH_SU_URL='${origin}'; irm ${origin}/linh-su/install.ps1 | iex"`
    : "";
  const shCommand = token
    ? `LINH_PHU='${token}' LINH_SU_URL='${origin}' bash -c "$(curl -fsSL ${origin}/linh-su/install.sh)"`
    : "";

  const downloadWindows = () => {
    // Tệp .cmd phải THUẦN ASCII — đây không phải sở thích thẩm mỹ.
    //
    // cmd.exe phân giải tệp batch theo codepage ANSI của hệ thống, và nó làm việc đó TRƯỚC
    // khi dòng `chcp 65001` kịp có tác dụng. Một ký tự tiếng Việt trong tệp là cmd đếm sai
    // độ dài chuỗi byte rồi resume giữa dòng — đo được trên máy thật: `powershell` biến
    // thành lệnh `ershell`, `echo.` thành `o.`. Tiếng Việt mà người dùng thấy đến từ
    // install.ps1 tải qua HTTP (UTF-8, đã khai charset ở next.config.ts), không từ tệp này;
    // `chcp 65001` có mặt chính là để cửa sổ hiển thị được phần chữ ấy.
    //
    // Lọc thay vì tin: `origin` về lý thuyết có thể là tên miền IDN có dấu. Giữ lại "\n" —
    // nó nằm ngoài dải in được, và một bộ lọc quên nó sẽ ép cả tệp thành MỘT dòng.
    const asciiOnly = (s: string) => s.replace(/[^\n\x20-\x7E]/g, "");
    downloadText(
      "cai-linh-su.cmd",
      asciiOnly(
        `@echo off\nchcp 65001 >nul\ntitle Cai dat Linh Su - Auto HH3D\n` +
          `echo Dang cai linh su tuc truc, vui long doi vai phut...\necho.\n` +
          `${psCommand}\necho.\npause\n`,
      ),
      "application/octet-stream",
    );
  };

  const downloadUnix = () => {
    downloadText(
      "cai-linh-su.sh",
      `#!/usr/bin/env bash\n# Cai linh su tuc truc - Auto HH3D\n${shCommand}\n`,
      "application/x-sh",
    );
  };

  const noWorkerAtAll =
    presence != null && !presence.sectOnline && !presence.mine.some((w) => w.online);

  return (
    <section className="rise-in min-w-0 rounded-2xl border border-[var(--color-ink-600)]/60 bg-[var(--color-ink-800)]/40 p-5">
      <h2 className="h-display text-lg font-bold text-gilded">Linh Sứ</h2>
      <p className="mt-1 text-xs text-[var(--color-mist)]">
        Linh sứ là kẻ thay đạo hữu ngồi trước bàn đàn — đàn pháp lập xong phải có một linh sứ
        đang trực thì mới có người tiếp nhận.
      </p>

      {/* ------------------------------------------------------------ Điểm danh */}
      <div className="mt-4 space-y-2 text-sm">
        <div className="flex items-center gap-2">
          <Dot on={presence?.sectOnline ?? false} />
          <span className="text-[var(--color-parchment)]">Linh sứ tông môn</span>
          <span className="text-xs text-[var(--color-mist)]">
            {presence == null
              ? "— đang xem sổ điểm danh…"
              : presence.sectOnline
                ? "— đang trực, phục vụ mọi đạo hữu"
                : "— vắng mặt"}
          </span>
        </div>

        {(presence?.mine ?? []).map((w) => (
          <div key={w.id} className="flex items-center gap-2">
            <Dot on={w.online} />
            <span className="min-w-0 truncate text-[var(--color-parchment)]">「{w.id}」</span>
            <span className="shrink-0 text-xs text-[var(--color-mist)]">
              {w.online ? "— đang trực" : `— ${timeAgo(w.lastSeen)}`}
            </span>
          </div>
        ))}
      </div>

      {/* Câu trả lời đúng cho hầu hết mọi người, nói TRƯỚC phần cài đặt. */}
      {presence?.sectOnline && (
        <p className="mt-3 rounded-lg border border-[var(--color-jade-400)]/25 bg-[var(--color-jade-400)]/5 p-3 text-xs text-[var(--color-mist)]">
          Linh sứ tông môn đang trực — <span className="text-[var(--color-jade-400)]">đạo hữu
          không cần cài gì cả</span>, cứ Khai Đàn là có người tiếp nhận. Phần dưới chỉ dành cho
          ai muốn lượt chạy đi từ chính máy mình.
        </p>
      )}
      {noWorkerAtAll && (
        <p className="mt-3 rounded-lg border border-[var(--color-gold-300)]/25 bg-[var(--color-gold-300)]/5 p-3 text-xs text-[var(--color-mist)]">
          Hiện <span className="text-[var(--color-gold-300)]">chưa có linh sứ nào đang trực</span> —
          khai đàn lúc này thì đàn pháp sẽ nằm chờ. Nuôi một linh sứ ngay trên máy mình bằng
          vài cú bấm bên dưới là xong.
        </p>
      )}

      {/* ------------------------------------------------------- Linh phù + cài */}
      <div className="mt-5 border-t border-[var(--color-ink-600)]/40 pt-4">
        <h3 className="text-sm font-semibold text-[var(--color-parchment)]">
          Linh sứ riêng trên máy của đạo hữu
        </h3>
        <p className="mt-1 text-xs text-[var(--color-mist)]">
          Không cần cài sẵn gì — bộ cài tự mang theo mọi thứ nó cần. Máy bật thì linh sứ trực.
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={issue}
            disabled={pending}
            className="rounded-lg bg-[var(--color-jade-400)]/15 px-4 py-2 text-sm font-semibold text-[var(--color-jade-400)] transition-colors hover:bg-[var(--color-jade-400)]/25 disabled:opacity-50"
          >
            {hasToken ? "Phát linh phù mới" : "Tạo bộ cài cho máy của tôi"}
          </button>
          {hasToken && (
            <button
              type="button"
              onClick={revoke}
              disabled={pending}
              className="rounded-lg border border-[var(--color-ink-600)] px-4 py-2 text-sm text-[var(--color-mist)] transition-colors hover:text-[var(--color-parchment)] disabled:opacity-50"
            >
              Thu hồi linh phù
            </button>
          )}
        </div>

        {token ? (
          <div className="mt-3 min-w-0 rounded-xl border border-[var(--color-gold-300)]/30 bg-[var(--color-ink-900)]/40 p-4">
            <p className="text-xs text-[var(--color-gold-300)]">
              Bộ cài đã sẵn sàng và mang linh phù riêng của đạo hữu — <strong>chỉ tải được lần
              này</strong>, rời trang là phải phát linh phù mới.
            </p>

            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={downloadWindows}
                className="rounded-lg bg-[var(--color-gold-300)]/15 px-4 py-2 text-sm font-semibold text-[var(--color-gold-300)] transition-colors hover:bg-[var(--color-gold-300)]/25"
              >
                ⬇ Tải bộ cài cho Windows
              </button>
              <button
                type="button"
                onClick={downloadUnix}
                className="rounded-lg border border-[var(--color-ink-600)] px-4 py-2 text-sm text-[var(--color-mist)] transition-colors hover:text-[var(--color-parchment)]"
              >
                ⬇ Linux / macOS
              </button>
            </div>

            <ol className="mt-3 space-y-1 text-xs text-[var(--color-mist)]">
              <li>
                <span className="text-[var(--color-parchment)]">1.</span> Bấm nút trên — tệp{" "}
                <span className="font-mono text-[var(--color-parchment)]">cai-linh-su.cmd</span> về
                thư mục Tải xuống.
              </li>
              <li>
                <span className="text-[var(--color-parchment)]">2.</span> Bấm đúp vào tệp đó. Nếu
                Windows hỏi lại, chọn <span className="text-[var(--color-parchment)]">Run anyway</span>.
              </li>
              <li>
                <span className="text-[var(--color-parchment)]">3.</span> Đợi vài phút tới khi cửa
                sổ báo xong. Linh sứ sẽ hiện ở danh sách trên trong ~10 giây.
              </li>
            </ol>

            <p className="mt-3 text-xs text-[var(--color-mist)]">
              Linh sứ tự trực lại mỗi lần mở máy. Muốn tiễn nó đi: chạy{" "}
              <span className="font-mono">uninstall</span> trong thư mục cài (đường dẫn hiện ở
              cuối phần cài đặt).
            </p>

            <button
              type="button"
              onClick={() => setShowCommands((v) => !v)}
              className="mt-3 text-xs text-[var(--color-mist)] underline underline-offset-2 hover:text-[var(--color-gold-300)]"
            >
              {showCommands ? "Ẩn cách dùng lệnh" : "Hoặc cài bằng dòng lệnh (máy chủ, SSH…)"}
            </button>

            {showCommands && (
              <div className="min-w-0">
                <CopyBlock label="Windows (PowerShell)" command={psCommand} />
                <CopyBlock label="Linux / macOS (Terminal)" command={shCommand} />
              </div>
            )}
          </div>
        ) : (
          hasToken && (
            <p className="mt-2 text-xs text-[var(--color-mist)]">
              Linh phù đã phát từ trước. Cần cài thêm máy, hoặc lỡ đóng trang trước khi tải bộ
              cài? Phát linh phù mới — cái cũ tự hết hiệu lực.
            </p>
          )
        )}
      </div>
    </section>
  );
}
