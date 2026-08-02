"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { issueLinhPhuAction, revokeLinhPhuAction } from "@/app/actions/linhsu";

/**
 * Mục LINH SỨ — nơi đạo hữu thấy ai đang trực và tự cài linh sứ cho máy của mình.
 *
 * Hai sự thật hiển thị ở đây đều đến từ sổ điểm danh phía server, không phải từ trí nhớ
 * của trình duyệt: linh sứ tông môn (do tông môn nuôi, trực cho tất cả) và linh sứ riêng
 * của đạo hữu. Lệnh cài chứa linh phù CHỈ HIỆN MỘT LẦN ngay sau khi phát — tàng khố không
 * giữ bản rõ, nên rời trang là không xem lại được, chỉ có thể phát linh phù mới.
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
      className={`inline-block h-2 w-2 rounded-full ${
        on ? "bg-[var(--color-jade-400)]" : "bg-[var(--color-ink-600)]"
      }`}
    />
  );
}

function CopyBlock({ label, command }: { label: string; command: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="mt-3">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-xs font-semibold text-[var(--color-parchment)]">{label}</span>
        <button
          type="button"
          className="rounded-md border border-[var(--color-ink-600)] px-2 py-0.5 text-xs text-[var(--color-mist)] hover:text-[var(--color-gold-300)]"
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
      <pre className="overflow-x-auto rounded-lg border border-[var(--color-ink-600)]/60 bg-[var(--color-ink-900)]/60 p-3 text-xs leading-relaxed text-[var(--color-mist)]">
        {command}
      </pre>
    </div>
  );
}

export function LinhSuPanel({ hasToken: initialHasToken }: { hasToken: boolean }) {
  const [presence, setPresence] = useState<Presence | null>(null);
  const [hasToken, setHasToken] = useState(initialHasToken);
  const [token, setToken] = useState<string | null>(null);
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

  return (
    <section className="rise-in rounded-2xl border border-[var(--color-ink-600)]/60 bg-[var(--color-ink-800)]/40 p-5">
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
            {presence == null ? "— đang xem sổ điểm danh…" : presence.sectOnline ? "— đang trực, phục vụ mọi đạo hữu" : "— vắng mặt"}
          </span>
        </div>

        {(presence?.mine ?? []).map((w) => (
          <div key={w.id} className="flex items-center gap-2">
            <Dot on={w.online} />
            <span className="text-[var(--color-parchment)]">「{w.id}」</span>
            <span className="text-xs text-[var(--color-mist)]">
              {w.online ? "— đang trực" : `— lần cuối điểm danh ${timeAgo(w.lastSeen)}`}
            </span>
          </div>
        ))}

        {presence != null && presence.mine.length === 0 && (
          <p className="text-xs text-[var(--color-mist)]">
            Đạo hữu chưa có linh sứ riêng. Không sao cả khi linh sứ tông môn đang trực — nhưng
            một linh sứ ngay trên máy mình thì lượt chạy mang địa chỉ nhà mình, và không phải
            xếp hàng chung với ai.
          </p>
        )}
      </div>

      {/* ------------------------------------------------------- Linh phù + cài */}
      <div className="mt-5 border-t border-[var(--color-ink-600)]/40 pt-4">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={issue}
            disabled={pending}
            className="rounded-lg bg-[var(--color-jade-400)]/15 px-4 py-2 text-sm font-semibold text-[var(--color-jade-400)] transition-colors hover:bg-[var(--color-jade-400)]/25 disabled:opacity-50"
          >
            {hasToken ? "Phát linh phù mới" : "Cài linh sứ cho máy của tôi"}
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
          <div className="mt-3 rounded-xl border border-[var(--color-gold-300)]/30 bg-[var(--color-ink-900)]/40 p-4">
            <p className="text-xs text-[var(--color-gold-300)]">
              Lệnh cài dưới đây mang linh phù của đạo hữu và CHỈ HIỆN LẦN NÀY — rời trang là
              không xem lại được. Dán vào máy định cho linh sứ trực (mở PowerShell trên
              Windows, Terminal trên Linux/macOS), chờ vài phút là xong.
            </p>
            <CopyBlock label="Windows (PowerShell)" command={psCommand} />
            <CopyBlock label="Linux / macOS (Terminal)" command={shCommand} />
            <p className="mt-3 text-xs text-[var(--color-mist)]">
              Linh sứ sẽ tự trực lại mỗi lần mở máy. Muốn tiễn nó đi: chạy uninstall trong thư
              mục cài (lệnh hiện ra ở cuối phần cài đặt).
            </p>
          </div>
        ) : (
          hasToken && (
            <p className="mt-2 text-xs text-[var(--color-mist)]">
              Linh phù đã phát từ trước. Cần cài thêm máy hoặc lỡ quên lệnh? Phát linh phù mới
              — cái cũ tự hết hiệu lực.
            </p>
          )
        )}
      </div>
    </section>
  );
}
