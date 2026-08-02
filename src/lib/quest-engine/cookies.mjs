/**
 * Đọc chuỗi cookie người dùng dán. Module LÁ: không import gì, không đụng đĩa, không biết
 * Playwright — và đó là toàn bộ lý do nó tồn tại tách khỏi runCycle.mjs.
 *
 * Server action cần đúng hàm này để soát cookie ngay lúc dán. Ở v0.13.0 nó import thẳng từ
 * `runCycle.mjs`, và cái giá là cả bộ engine bị kéo vào bundle của Next — trong đó
 * `profile.mjs` đọc `profile.json` bằng `readFileSync(fileURLToPath(new URL(…)))` ngay ở
 * thân module. Turbopack thay `URL` bằng bản của nó, nên `fileURLToPath` của Node từ chối:
 *
 *     TypeError: The "path" argument must be of type string or an instance of URL.
 *                Received an instance of URL
 *
 * Module chết lúc nạp, kéo sập MỌI server action của /dashboard — kể cả những action chẳng
 * liên quan gì tới cookie (phát/thu hồi linh phù). Trên máy dev không bao giờ tái hiện.
 *
 * Bài học nằm ở ranh giới, không nằm ở cái polyfill: mã chạy TRONG function của Next và mã
 * chạy trong worker là hai thế giới khác nhau. Thứ nào cần đi qua cả hai thì phải sạch —
 * không đĩa, không phụ thuộc.
 */

/** Tên miền game. Site đổi TLD định kỳ (…mx → …am), nên đây phải là cấu hình, không phải hằng số. */
export const DEFAULT_GAME_BASE_URL = "https://hoathinh3d.am";

/**
 * Chuỗi cookie người dùng dán → mảng cookie của Playwright. Hiểu MỌI định dạng hợp lý:
 *
 *   • `document.cookie` / header: "wordpress_logged_in_…=…; wordpress_sec_…=…"
 *   • Bản xuất JSON của chính bản desktop: {"url": …, "cookies": [{name, value, domain, …}]}
 *   • Mảng JSON trần của các extension Cookie-Editor: [{name, value, …}]
 *   • Object phẳng: {"tên": "giá trị"}
 *
 * Dễ tính là BẮT BUỘC ở đây, vì bài học 02/08 (job 2d6d4a73): người dùng dán bản xuất JSON
 * từ desktop — hành động hợp lý nhất trần đời — và parser cũ chỉ hiểu dạng chuỗi nên trả về
 * MẢNG RỖNG, không một lời phàn nàn. Browser đi tay trắng, /me-cung đá về trang chủ, và lỗi
 * nổi lên tận `#lobby-overview` dưới cái tên một selector vô tội. Người gọi phải coi kết
 * quả rỗng là LỖI TO — một chuỗi 1.455 ký tự ra số không thì chắc chắn không phải ý người dán.
 */
export function parseCookieString(raw, url) {
  const text = String(raw ?? "").trim();
  if (!text) return [];

  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {
    /* url hỏng thì bỏ lọc theo domain */
  }

  if (text.startsWith("{") || text.startsWith("[")) {
    try {
      const parsed = JSON.parse(text);
      const list = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed?.cookies)
          ? parsed.cookies
          : null;

      if (list) {
        const cookies = [];
        for (const c of list) {
          if (!c || typeof c.name !== "string" || !c.name || typeof c.value !== "string") continue;

          // Chỉ giữ cookie thuộc đúng site đang nhắm tới: bản "export tất cả" của extension
          // không được phép tiêm cookie của site khác vào phiên game.
          const domain = typeof c.domain === "string" && c.domain ? c.domain : "";
          const bare = domain.replace(/^\./, "");
          if (bare && host && !host.endsWith(bare) && !bare.endsWith(host)) continue;

          const cookie = { name: c.name, value: c.value };
          if (domain) {
            cookie.domain = domain;
            cookie.path = typeof c.path === "string" && c.path ? c.path : "/";
          } else {
            cookie.url = url;
          }

          const expires = Number(c.expirationDate ?? c.expires);
          if (Number.isFinite(expires) && expires > 0) cookie.expires = Math.floor(expires);
          if (typeof c.secure === "boolean") cookie.secure = c.secure;
          if (typeof c.httpOnly === "boolean") cookie.httpOnly = c.httpOnly;
          cookies.push(cookie);
        }
        return cookies;
      }

      if (parsed && typeof parsed === "object") {
        return Object.entries(parsed)
          .filter(([name, value]) => name && typeof value === "string")
          .map(([name, value]) => ({ name, value, url }));
      }
    } catch {
      // Trông như JSON mà không parse được — rơi xuống đường chuỗi, biết đâu vẫn ra gì đó.
    }
  }

  // Dạng chuỗi: bỏ tiền tố "Cookie:" nếu người dùng copy nguyên header, nhận cả xuống dòng
  // làm dấu ngăn, chỉ tách ở dấu `=` ĐẦU TIÊN (giá trị cookie WordPress có chứa `=` bên trong).
  const cookies = [];
  for (const part of text.replace(/^cookie:\s*/i, "").split(/[;\n]/)) {
    const chunk = part.trim();
    if (!chunk) continue;

    const eq = chunk.indexOf("=");
    if (eq <= 0) continue;

    const name = chunk.slice(0, eq).trim();
    const value = chunk.slice(eq + 1).trim();
    if (!name) continue;

    cookies.push({ name, value, url });
  }
  return cookies;
}
