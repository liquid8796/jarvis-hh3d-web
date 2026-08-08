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
