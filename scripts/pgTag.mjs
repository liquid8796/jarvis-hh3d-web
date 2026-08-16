/**
 * TAGGED-TEMPLATE TRÊN `pg` — thế chỗ `neon()` cho mọi script vận hành, từ 16/08/2026.
 *
 * Chín script từng gọi `neon(url)` rồi hỏi bằng tagged template. Ngày backend về VM,
 * DATABASE_URL thành `127.0.0.1` và neon-http chế ra `https://api.0.0.1/sql` rồi chết —
 * còn `pg` thì nói giao thức Postgres chuẩn nên phủ cả localhost lẫn Neon (mirror cũ).
 *
 * Bề mặt GIỮ NGUYÊN cố ý: `sqlTag(url)` trả về đúng thứ `neon(url)` trả — một hàm tagged
 * template async cho ra MẢNG HÀNG — nên chỗ gọi chỉ đổi tên hàm, không đổi hình dạng.
 * `.mjs` chứ không `.mts` vì seed/resetPassword/cleanupSharedDb chạy bằng `node` trần.
 *
 * `allowExitOnIdle`: script vận hành xong việc là thoát; đừng bắt ai nhớ gọi pool.end().
 */
import pg from "pg";

/**
 * Bề mặt trả về chép ĐÚNG hai mặt mà chỗ gọi đang dùng của client Neon: gọi như tagged
 * template, hoặc `.query(text, params)` — cả hai cho ra mảng hàng.
 *
 * @param {string} url
 * @returns {((strings: TemplateStringsArray, ...values: unknown[]) => Promise<Array<Record<string, any>>>) & { query: (text: string, params?: unknown[]) => Promise<Array<Record<string, any>>> }}
 */
export function sqlTag(url) {
  const pool = new pg.Pool({ connectionString: url, max: 1, allowExitOnIdle: true });
  const tag = async (strings, ...values) => {
    const text = strings.reduce((acc, part, i) => `${acc}$${i}${part}`);
    const result = await pool.query(text, values);
    return result.rows;
  };
  tag.query = async (text, params = []) => {
    const result = await pool.query(text, params);
    return result.rows;
  };
  return tag;
}

/** DB đứng ngay cạnh (loopback) thì không có「trạm hoạt động」nào để đi tra cả. */
export function isLoopbackDatabaseUrl(url) {
  try {
    const host = new URL(url).hostname;
    return host === "127.0.0.1" || host === "localhost" || host === "::1";
  } catch {
    return false;
  }
}
