/**
 * Luật của phần đàm đạo mà CẢ HAI phía đều phải biết — form gõ ra nó, action đọc lại nó.
 *
 * Câu xác nhận sống ở đây chứ không nằm hai bản trong hai file: hai bản sao lệch nhau một
 * dấu cách là một nút thanh tẩy không bao giờ bấm được, và không ai đoán ra vì sao.
 */

/**
 * Gõ đúng câu này mới thanh tẩy được sảnh đàm đạo.
 *
 * KHÔNG DẤU là chủ ý: một nút xoá sạch không thể phụ thuộc vào việc bộ gõ tiếng Việt của
 * người bấm có đang bật hay không.
 */
export const CHAT_PURGE_PHRASE = "XOA HET";

/**
 * Câu người dùng gõ có khớp không. Rộng tay với khoảng trắng thừa và chữ hoa/thường — hàng
 * rào này để chặn cú bấm nhầm, không phải để bắt lỗi chính tả; bắt gõ y từng ký tự chỉ khiến
 * người ta copy-paste, tức là mất luôn giây dừng lại mà cả hàng rào sinh ra để mua.
 */
export function matchesChatPurgePhrase(raw: string): boolean {
  return raw.trim().replace(/\s+/g, " ").toUpperCase() === CHAT_PURGE_PHRASE;
}

/**
 * URL đính kèm có AN TOÀN để đem gắn vào `href`/`src` không — tức có phải `https:` không.
 *
 * Sinh ra từ một lỗ hổng CÓ THẬT, không phải phòng xa: `z.string().url()` của Zod NHẬN
 * `javascript:alert(1)`, `data:text/html,<script>…</script>` và `vbscript:` — đo được ngày
 * 09/08/2026. Mà bong bóng tin vẽ mọi đính kèm thành `<a href={url}>`, nên một môn đồ bất kỳ
 * chỉ cần POST thẳng vào /api/chat một đính kèm mang `javascript:` là gài được mã chạy TRÊN
 * TÊN MIỀN CỦA CHÍNH CHÚNG TA trong trình duyệt của người bấm vào — kể cả một Trưởng môn.
 * Cookie phiên là httpOnly nên không đọc trộm được, nhưng mã ấy gọi được mọi action/API dưới
 * danh nghĩa nạn nhân, và đó đã là chiếm quyền.
 *
 * Chốt ở `https:` chứ không phải "chặn javascript:": danh sách CHO PHÉP thì một lược đồ lạ
 * (`vbscript:`, `filesystem:`, một thứ trình duyệt thêm vào năm sau) mặc định nằm ngoài, còn
 * danh sách CẤM thì mặc định nằm trong. Mọi URL hợp lệ của hệ thống đều là https: tàng khố OCI
 * và CDN của GIPHY.
 *
 * Dùng ở CẢ HAI phía và đó là chủ ý: server chặn lúc GHI, client chặn lúc VẼ. Lớp thứ hai
 * không thừa — nó phủ cả những tin đã nằm sẵn trong kho từ trước khi có lớp thứ nhất.
 */
export function isSafeAttachmentUrl(raw: unknown): raw is string {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 2048) return false;
  try {
    return new URL(raw).protocol === "https:";
  } catch {
    // Không phân tích nổi thành URL thì càng không đem gắn vào href được.
    return false;
  }
}
