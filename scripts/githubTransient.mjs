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

/**
 * `gh repo create` hỏng — có được phép GỌI LẠI không?
 *
 * Câu hỏi này KHÁC「có phải nhịp nấc không」, và chỗ khác nhau ấy tốn tiền thật: `gh repo create
 * --source . --push` làm HAI việc (tạo kho, rồi đẩy mã). Một cú 5xx có thể rơi trước cú tạo
 * (chưa có gì — gọi lại là đúng) hoặc SAU nó (kho đã nằm trên tài khoản — gọi lại chỉ nhận
 * 422「name already exists」rồi che mất sự thật là ta vừa để lại một kho rỗng).
 *
 * Nên phép quyết định hỏi thêm một sự thật ngoài đời: kho ấy CÓ trên GitHub chưa.
 *
 *   `"no"`      chưa có     → nấc thì gọi lại, an toàn tuyệt đối
 *   `"yes"`     đã có       → KHÔNG gọi lại; người gọi đi ngả dọn dẹp
 *   `"unknown"` không hỏi được (GitHub cũng đang nấc ở chính lời hỏi ấy) → KHÔNG gọi lại
 *
 * Ngả `"unknown"` là ngả dễ viết sai nhất: coi「không hỏi được」thành「chưa có」là đúng cái cách
 * người ta tạo ra hai kho trong một lượt chạy, giữa lúc GitHub đang sự cố — mà tên kho thì
 * ngẫu nhiên nên cái thứ hai không va vào cái thứ nhất để mà lộ ra.
 */
export function shouldRetryCreate({ why, existence }) {
  if (existence !== "no") return false;
  return looksTransient(why);
}

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
