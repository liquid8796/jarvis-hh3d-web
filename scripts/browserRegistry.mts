/**
 * SỔ TRÌNH DUYỆT — nhớ những Chromium mà `npm run shot` đã tự tay mở ra, để còn dọn được
 * những cái sống sót qua một lần treo hay một cú Ctrl-C.
 *
 * VÌ SAO CẦN MỘT CUỐN SỔ, thay vì quét tiến trình như mọi người vẫn làm:
 *
 *   • Quét theo TÊN (`taskkill /IM chrome.exe`) là giết luôn Chrome thật của chủ máy. Tên
 *     tiến trình của Chromium do Playwright tải về cũng đúng là `chrome.exe`.
 *   • Quét theo ĐƯỜNG DẪN thì an toàn hơn, nhưng đo ngày 09/08/2026 trong môi trường này:
 *     `tasklist` và `Get-CimInstance Win32_Process` đều trả về RỖNG ngay cả khi Chromium
 *     đang chạy. Một phép dọn dựa vào thứ có lúc không nhìn thấy gì là một phép dọn không
 *     kiểm chứng được.
 *
 * Cuốn sổ này không cần nhìn thấy tiến trình nào cả. Nó nhớ PID và `wsEndpoint`, còn lúc dọn
 * thì BẮT TAY qua chính endpoint ấy: chỉ thứ trả lời được giao thức của Playwright mới bị
 * đụng tới. PID có thể bị hệ điều hành cấp lại cho một tiến trình khác — nhưng cái bắt tay
 * mới là thứ quyết định, và một tiến trình lạ thì không bao giờ trả lời nó.
 *
 * Sổ nằm ở thư mục tạm của máy, KHÔNG nằm trong repo: đây là trạng thái của một cái máy cụ
 * thể, không phải của dự án.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type BrowserRecord = {
  pid: number;
  wsEndpoint: string;
  /** Epoch ms lúc mở. Là thứ giữ cho phép dọn không giết nhầm một lượt chụp đang chạy. */
  startedAt: number;
};

const REGISTRY_PATH = join(tmpdir(), "jarvis-hh3d-shot", "browsers.json");

/**
 * Chỉ dọn những bản ghi CŨ hơn ngần này.
 *
 * Đây là hàng rào chống tự bắn vào chân: hai phiên cùng chạy `npm run shot` thì bản ghi của
 * phiên kia đang nằm trong sổ, và một phép dọn không phân biệt tuổi sẽ giết trình duyệt của
 * họ giữa chừng. Một lượt chụp có trần 90 giây × 2 lượt, nên mười phút là dư sức xa.
 */
export const ORPHAN_AGE_MS = 10 * 60_000;

function readRaw(): BrowserRecord[] {
  try {
    const parsed: unknown = JSON.parse(readFileSync(REGISTRY_PATH, "utf8"));
    if (!Array.isArray(parsed)) return [];
    // Lọc từng bản ghi: sổ là tệp trên đĩa, và một tệp hỏng không được làm ngã lượt chụp.
    return parsed.filter(
      (entry): entry is BrowserRecord =>
        typeof entry === "object" &&
        entry !== null &&
        Number.isInteger((entry as BrowserRecord).pid) &&
        typeof (entry as BrowserRecord).wsEndpoint === "string" &&
        Number.isFinite((entry as BrowserRecord).startedAt),
    );
  } catch {
    // Chưa có sổ, hoặc sổ rác — cả hai đều là "không nhớ gì cả", không phải lỗi.
    return [];
  }
}

function writeRaw(records: BrowserRecord[]): void {
  try {
    mkdirSync(join(tmpdir(), "jarvis-hh3d-shot"), { recursive: true });
    writeFileSync(REGISTRY_PATH, JSON.stringify(records, null, 2));
  } catch (err) {
    // Không ghi được sổ thì lượt chụp vẫn phải chạy: hậu quả tệ nhất là một orphan không ai
    // nhớ, còn ném ở đây là hỏng cả việc chính vì một việc phụ.
    console.log(`⚠ Không ghi được sổ trình duyệt (${err instanceof Error ? err.message : String(err)}).`);
  }
}

export function registryPath(): string {
  return REGISTRY_PATH;
}

export function remember(record: BrowserRecord): void {
  // Gạt sạch bản ghi cùng PID trước khi ghi: PID được hệ điều hành cấp lại là chuyện thường,
  // và hai dòng cùng PID thì dòng cũ chỉ dẫn phép dọn đi nhầm chỗ.
  writeRaw([...readRaw().filter((entry) => entry.pid !== record.pid), record]);
}

export function forget(pid: number): void {
  writeRaw(readRaw().filter((entry) => entry.pid !== pid));
}

/** Mọi bản ghi. `olderThanMs` lọc theo tuổi — xem `ORPHAN_AGE_MS`. */
export function listRecords(olderThanMs = 0): BrowserRecord[] {
  const cutoff = Date.now() - olderThanMs;
  return readRaw().filter((entry) => entry.startedAt <= cutoff);
}
