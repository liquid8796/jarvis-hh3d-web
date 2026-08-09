/**
 * Ảnh này có NHIỀU KHUNG không — đọc bằng cấu trúc container, không giải mã pixel.
 *
 * Sinh ra cho đúng một quyết định ở AvatarPicker: ảnh động thì gửi NGUYÊN BẢN, ảnh tĩnh thì
 * cho qua canvas để thu về vuông 512px. Đoán sai chiều nào cũng đau: đoán "tĩnh" cho một tệp
 * động là lặng lẽ giết phần động của nó (canvas chỉ vẽ được khung đầu); đoán "động" cho một
 * tấm ảnh 8MB là để nó đâm vào trần 2MB của server với một lời từ chối vô cớ.
 *
 * VÌ SAO KHÔNG DÙNG `ImageDecoder` — API của trình duyệt trả lời sẵn `animated`/`frameCount`:
 * Firefox chưa có nó. Một API vắng mặt sẽ khiến nhánh miễn trừ im lặng không chạy, tức người
 * dùng Firefox mất phần động mà không có gì trên màn hình nói vì sao. Đọc container thì cho
 * CÙNG một câu trả lời ở mọi trình duyệt, và kiểm chứng được bằng script không cần dựng gì.
 *
 * Ba định dạng động mà trình duyệt vẽ được, và dấu hiệu của từng cái:
 *   GIF  — ĐẾM số Image Descriptor (0x2C). Phải đi theo cấu trúc block thật: quét thô byte
 *          0x2C sẽ trúng cả dữ liệu pixel nén và báo động cho một tấm ảnh tĩnh.
 *   WebP — cờ ANIM trong chunk `VP8X`, hoặc có chunk `ANIM`/`ANMF`.
 *   APNG — có chunk `acTL` NẰM TRƯỚC `IDAT` đầu tiên.
 * JPEG không có khái niệm nhiều khung ở đây nên luôn là tĩnh.
 *
 * Mọi hàm dưới đây phải chịu được tệp CẮT CỤT và tệp rác: chúng trả về `false` chứ không ném,
 * vì người gọi còn một đường lui đầy đủ (canvas thử giải mã, và nó có lời báo lỗi riêng nếu
 * tệp không phải ảnh). Không có vòng lặp nào không chặn trên — một trường độ dài bằng 0 trong
 * tệp rác là cách quay vòng vô tận ngay trong tab người dùng.
 */

/** Đủ để "động": hai khung. */
const MIN_ANIMATED_FRAMES = 2;

/**
 * Trần số block/chunk mỗi lần đi. Một tấm ảnh đại diện có hàng trăm khung là chuyện có thật;
 * một trăm nghìn thì không phải ảnh nữa mà là một tệp cố tình làm ta quay vòng.
 */
const MAX_BLOCKS = 100_000;

const GIF_HEADER_BYTES = 6;
/** Logical Screen Descriptor: rộng 2, cao 2, packed 1, màu nền 1, tỉ lệ điểm 1. */
const GIF_SCREEN_DESCRIPTOR_BYTES = 7;
const GIF_EXTENSION = 0x21;
const GIF_IMAGE_DESCRIPTOR = 0x2c;
const GIF_TRAILER = 0x3b;
/** Bit "có bảng màu" trong byte packed, dùng cho cả bảng chung và bảng riêng của từng khung. */
const GIF_COLOR_TABLE_FLAG = 0x80;
const GIF_COLOR_TABLE_SIZE_MASK = 0x07;

/** Cờ ANIM trong byte flags của chunk VP8X. */
const WEBP_ANIMATION_FLAG = 0x02;

const PNG_SIGNATURE_BYTES = 8;
/** Một chunk PNG: 4 byte độ dài + 4 byte kiểu + dữ liệu + 4 byte CRC. */
const PNG_CHUNK_OVERHEAD = 12;

function matchesAscii(bytes: Uint8Array, offset: number, text: string): boolean {
  if (bytes.length < offset + text.length) return false;
  for (let i = 0; i < text.length; i++) {
    if (bytes[offset + i] !== text.charCodeAt(i)) return false;
  }
  return true;
}

function readAscii(bytes: Uint8Array, offset: number, length: number): string {
  let out = "";
  for (let i = 0; i < length; i++) out += String.fromCharCode(bytes[offset + i]);
  return out;
}

function readU32LittleEndian(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset] + bytes[offset + 1] * 0x100 + bytes[offset + 2] * 0x10000 + bytes[offset + 3] * 0x1000000
  );
}

function readU32BigEndian(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset] * 0x1000000 + bytes[offset + 1] * 0x10000 + bytes[offset + 2] * 0x100 + bytes[offset + 3]
  );
}

/** Số byte của một bảng màu GIF, suy từ byte packed. */
function gifColorTableBytes(packed: number): number {
  return (packed & GIF_COLOR_TABLE_FLAG) === 0
    ? 0
    : 3 * (1 << ((packed & GIF_COLOR_TABLE_SIZE_MASK) + 1));
}

/**
 * Nhảy qua một chuỗi sub-block của GIF (mỗi block mở đầu bằng độ dài, chuỗi kết thúc bằng 0).
 * Trả về vị trí ngay sau chuỗi, hoặc `-1` khi tệp cắt cụt giữa chuỗi.
 */
function skipGifSubBlocks(bytes: Uint8Array, start: number): number {
  let cursor = start;
  for (let block = 0; block < MAX_BLOCKS; block++) {
    if (cursor >= bytes.length) return -1;
    const length = bytes[cursor++];
    if (length === 0) return cursor;
    cursor += length;
  }
  return -1;
}

function gifIsAnimated(bytes: Uint8Array): boolean {
  const screenDescriptor = GIF_HEADER_BYTES + GIF_SCREEN_DESCRIPTOR_BYTES;
  if (bytes.length < screenDescriptor) return false;

  // Byte packed của màn hình logic nằm ngay sau hai cặp rộng/cao.
  let cursor = screenDescriptor + gifColorTableBytes(bytes[GIF_HEADER_BYTES + 4]);
  let frames = 0;

  for (let block = 0; block < MAX_BLOCKS; block++) {
    if (cursor >= bytes.length) break; // Cắt cụt: tin những khung đã đếm được, không đoán thêm.
    const marker = bytes[cursor++];

    if (marker === GIF_TRAILER) break;

    if (marker === GIF_EXTENSION) {
      cursor++; // nhãn của extension
      cursor = skipGifSubBlocks(bytes, cursor);
      if (cursor < 0) break;
      continue;
    }

    if (marker === GIF_IMAGE_DESCRIPTOR) {
      frames++;
      if (frames >= MIN_ANIMATED_FRAMES) return true; // Đủ rồi, không cần đọc hết tệp.
      // 9 byte mô tả khung; byte packed là byte thứ 9 và nó quyết định bảng màu RIÊNG của khung.
      if (cursor + 9 > bytes.length) break;
      cursor += 9 + gifColorTableBytes(bytes[cursor + 8]);
      cursor++; // LZW minimum code size
      cursor = skipGifSubBlocks(bytes, cursor);
      if (cursor < 0) break;
      continue;
    }

    break; // Byte lạ ở vị trí đáng ra là một marker — thôi không đoán nữa.
  }

  return frames >= MIN_ANIMATED_FRAMES;
}

function webpIsAnimated(bytes: Uint8Array): boolean {
  let cursor = 12; // "RIFF" + độ dài + "WEBP"

  for (let chunk = 0; chunk < MAX_BLOCKS; chunk++) {
    if (cursor + 8 > bytes.length) return false;

    const tag = readAscii(bytes, cursor, 4);
    const size = readU32LittleEndian(bytes, cursor + 4);
    const payload = cursor + 8;

    // `ANMF` là một khung động; `ANIM` là tham số của chuỗi khung. Có cái nào cũng là động.
    if (tag === "ANMF" || tag === "ANIM") return true;

    if (tag === "VP8X" && payload < bytes.length) {
      // VP8X mở đầu bằng một byte cờ; ANIM là bit thứ hai.
      return (bytes[payload] & WEBP_ANIMATION_FLAG) !== 0;
    }

    // Chunk RIFF luôn đệm cho chẵn byte.
    const next = payload + size + (size % 2);
    if (next <= cursor || next > bytes.length) return false; // rác hoặc cắt cụt
    cursor = next;
  }

  return false;
}

function pngIsAnimated(bytes: Uint8Array): boolean {
  let cursor = PNG_SIGNATURE_BYTES;

  for (let chunk = 0; chunk < MAX_BLOCKS; chunk++) {
    if (cursor + 8 > bytes.length) return false;

    const length = readU32BigEndian(bytes, cursor);
    const type = readAscii(bytes, cursor + 4, 4);

    if (type === "acTL") return true;

    // `acTL` PHẢI đứng trước `IDAT` đầu tiên. Một chunk đứng sau đó là APNG hỏng, và trình
    // duyệt vẽ tệp ấy thành ảnh tĩnh — nên ta cũng phải gọi nó là tĩnh, không thì ta giữ
    // nguyên bản một tệp mà người dùng vẫn thấy đứng im.
    if (type === "IDAT" || type === "IEND") return false;

    const next = cursor + PNG_CHUNK_OVERHEAD + length;
    if (next <= cursor || next > bytes.length) return false; // rác hoặc cắt cụt
    cursor = next;
  }

  return false;
}

/**
 * Tệp này có nhiều khung không. `false` cho mọi thứ không phải ảnh động — kể cả tệp rác, tệp
 * cắt cụt, và JPEG.
 */
export function isAnimatedImage(bytes: Uint8Array): boolean {
  if (bytes.length < 12) return false;

  if (matchesAscii(bytes, 0, "GIF87a") || matchesAscii(bytes, 0, "GIF89a")) {
    return gifIsAnimated(bytes);
  }
  if (matchesAscii(bytes, 0, "RIFF") && matchesAscii(bytes, 8, "WEBP")) {
    return webpIsAnimated(bytes);
  }
  if (
    bytes[0] === 0x89 &&
    matchesAscii(bytes, 1, "PNG") &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return pngIsAnimated(bytes);
  }

  return false;
}
