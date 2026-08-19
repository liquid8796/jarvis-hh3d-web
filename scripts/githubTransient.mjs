/**
 * MỘT NHỊP NẤC CỦA GITHUB CÓ ĐÁNG THỬ LẠI KHÔNG — thuần, không mạng, không trạng thái.
 *
 * Sống riêng thành `.mjs` vì `newGithubKhoiloi.mjs` chạy bằng `node` trần, không nhập nổi
 * TypeScript (cùng lẽ với `khoiloiNaming.mjs`); còn `verifyGithubDeploy.mts` thì nhập được cả
 * hai, nên luật ở đây có phép kiểm bao từng nhánh.
 *
 * ── VÌ SAO CẦN MỘT PHÉP PHÂN LOẠI RIÊNG ─────────────────────────────────────────────────────
 *
 * `explainFailure` (src/lib/validation/githubStations) phán trên `res.status` — số hiệu, thứ chỉ
 * có khi ta tự gọi `fetch`. Nhưng những bước nặng nhất của lượt DỰNG kho lại đi qua `gh`, và `gh`
 * chỉ để lại VĂN BẢN. Đo 17/08/2026 trên log của tông chủ: `gh secret set` trúng
 * `HTTP 503: No server is currently available to service your request…` và cả lượt dựng chết,
 * bỏ lại một kho CÔNG KHAI đã push mà không có secret — tức một khôi lỗi không bao giờ xác thực
 * nổi, nằm im trên tài khoản người ta.
 *
 * ── RANH GIỚI, VÀ NÓ KHÔNG ĐƯỢC NHÍCH ───────────────────────────────────────────────────────
 *
 * Chỉ hai họ được nhận: **5xx/429** và **mạng đứt**. 4xx thì KHÔNG, không bao giờ — một PAT sai
 * hay thiếu scope không tự đúng lên, nên thử lại chỉ bắt người đang đứng trước dấu nhắc chờ thêm
 * vài giây rồi vẫn đọc đúng câu lỗi ấy. Nới ranh giới này còn một cái giá thứ hai, kín hơn: ngả
 * DỌN RÁC của lượt dựng nằm sau cùng, nên mỗi lần thử lại thừa là mỗi lần cái kho hỏng dở nằm
 * lại lâu thêm.
 *
 * Cùng bộ lọc với `whoami` bên `newGithubStation.mts` — chỗ ấy đọc `res.status`, chỗ này đọc chữ.
 */

/** Có phải một nhịp hỏng THOÁNG QUA (đáng thử lại) không. Chuỗi rỗng/không rõ → KHÔNG. */
export function looksTransient(text) {
  const t = String(text ?? "").toLowerCase();
  // `gh` in nguyên văn câu của API, dạng "HTTP 503: …" — và cũng có bản in "http/2 503".
  if (/\bhttp[/\d.]*\s*(50[0-9]|429)\b/.test(t)) return true;
  if (t.includes("no server is currently available")) return true;
  if (t.includes("please try resubmitting")) return true;
  if (t.includes("secondary rate limit") || t.includes("rate limit exceeded")) return true;
  return /\b(econnreset|etimedout|econnrefused|eai_again|enotfound|socket hang up|timeout)\b/.test(t);
}
