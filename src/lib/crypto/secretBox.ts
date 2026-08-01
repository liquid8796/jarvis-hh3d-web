import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Mã hoá at-rest cho những bí mật của người dùng — hiện là cookie đăng nhập game.
 *
 * Vì sao cần: cookie game là chìa khoá vào tài khoản thật của một người. Nếu nó nằm
 * plaintext trong JSONB thì bất cứ ai đọc được database — một bản backup thất lạc, một
 * connection string rò rỉ, một truy vấn admin vô ý — là cầm luôn tài khoản của mọi thành
 * viên. Mã hoá ở tầng ứng dụng khiến quyền đọc database KHÔNG còn đồng nghĩa với quyền
 * dùng, vì chìa nằm ở biến môi trường chứ không nằm trong database.
 *
 * AES-256-GCM: có sẵn trong Node, không thêm dependency (quan trọng với bundle serverless),
 * và là AEAD — GCM tag phát hiện mọi sửa đổi, nên một ciphertext bị đổi một bit sẽ báo lỗi
 * chứ không âm thầm giải ra rác rồi được đem đi đăng nhập.
 *
 * Phong bì: `v1.<iv>.<tag>.<ciphertext>`, base64url. Có số phiên bản ngay từ đầu để đổi
 * thuật toán về sau vẫn đọc được dữ liệu cũ — thứ rất khó thêm vào sau khi đã có dữ liệu.
 */

const VERSION = "v1";
const IV_BYTES = 12; // GCM chuẩn 96-bit
const b64 = (b: Buffer) => b.toString("base64url");

let cachedKey: Buffer | null = null;

/**
 * Khoá phải là ĐÚNG 32 byte, đưa vào dạng hex hoặc base64. Cố ý không tự "băm cho vừa" một
 * chuỗi ngắn: làm thế sẽ biến một mật khẩu yếu thành khoá trông-có-vẻ-hợp-lệ mà không ai
 * hay. Thà chết ngay lúc khởi động với hướng dẫn rõ ràng.
 */
function key(): Buffer {
  if (cachedKey) {
    return cachedKey;
  }

  const raw = process.env.ENCRYPTION_KEY;
  if (!raw || raw === "change-me") {
    throw new Error(
      "ENCRYPTION_KEY chưa được đặt. Sinh khoá: " +
        `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`,
    );
  }

  const decoded = /^[0-9a-fA-F]{64}$/.test(raw)
    ? Buffer.from(raw, "hex")
    : Buffer.from(raw, "base64");

  if (decoded.length !== 32) {
    throw new Error(
      `ENCRYPTION_KEY phải là 32 byte (64 ký tự hex, hoặc base64) — hiện dài ${decoded.length} byte.`,
    );
  }

  cachedKey = decoded;
  return cachedKey;
}

/** Chuỗi rỗng đi vào, chuỗi rỗng đi ra — "chưa có cookie" không phải là một bí mật. */
export function encryptSecret(plain: string): string {
  if (plain.length === 0) {
    return "";
  }

  // IV mới cho MỖI lần mã hoá. Dùng lại IV trong GCM là lỗi chí mạng: hai bản mã cùng IV
  // đủ để lộ nội dung, nên nó phải sinh ở đây chứ không bao giờ là hằng số cấu hình.
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return `${VERSION}.${b64(iv)}.${b64(cipher.getAuthTag())}.${b64(ct)}`;
}

/**
 * Giải mã. Ném lỗi nếu phong bì hỏng hoặc tag không khớp — im lặng trả về chuỗi rỗng sẽ
 * biến một khoá sai thành "cookie trống", và người dùng sẽ đi sửa nhầm chỗ.
 */
export function decryptSecret(envelope: string): string {
  if (envelope.length === 0) {
    return "";
  }

  const parts = envelope.split(".");
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error("Bí mật không đúng định dạng phong bì.");
  }

  const [, ivB64, tagB64, ctB64] = parts;
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(ivB64, "base64url"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ctB64, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

/**
 * Nhận diện phong bì. Dùng để đọc được cả dữ liệu ghi TRƯỚC khi có mã hoá: giá trị nào chưa
 * đóng phong bì thì coi là plaintext cũ, đọc bình thường, và lần lưu kế tiếp sẽ tự động
 * được mã hoá. Migration không cần downtime, cũng không cần script.
 */
export function isEncrypted(value: string): boolean {
  return value.startsWith(`${VERSION}.`) && value.split(".").length === 4;
}
