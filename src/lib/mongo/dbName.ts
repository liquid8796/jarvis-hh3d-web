/**
 * Tên database Mongo của MỘT trạm — luật duy nhất, dùng chung cho cả sảnh đàm đạo lẫn máy
 * đồng bộ gương trạm.
 *
 * Tệp này ra đời từ một lượt chuyển trạm gãy thật (10/08/2026): `mirror/mongoSync.ts` đã tự
 * chép lại luật này thành một bản KHẮT KHE HƠN — chỉ đọc path của URI rồi ném lỗi nếu rỗng.
 * Mà chuỗi Atlas đưa cho («…mongodb.net/?retryWrites=true&w=majority») KHÔNG BAO GIỜ mang
 * tên database ở cuối, nên lượt chuyển gục ngay sau khi đã chép xong 11.458 dòng Postgres.
 * Bài học không phải "sửa cái regex" mà là: **một luật, một chỗ**. Ai cần tên database thì
 * gọi vào đây; đừng dựng bản thứ hai, vì bản thứ hai luôn lệch bản thật vào đúng ngày nó
 * được dùng lần đầu.
 *
 * Ba nấc, đúng thứ tự ứng dụng thật vẫn đi từ trước:
 *   1. biến môi trường `MONGODB_DB` — cửa duy nhất để đặt tên tường minh;
 *   2. path trong URI — có, nếu chuỗi được gõ tay thay vì lấy từ nút Connect của Atlas;
 *   3. mặc định `jarvis` — nấc mà tông môn đang thực sự đứng, vì (1) và (2) đều trống.
 */

/** Nấc cuối. Đổi hằng số này là đổi database của cả tông môn — đừng đổi để "cho gọn". */
export const MONGO_DEFAULT_DB = "jarvis";

/** Database hệ thống của Mongo — không bao giờ là nơi chứa sảnh đàm đạo. */
export const MONGO_SYSTEM_DBS = new Set(["admin", "local", "config"]);

/**
 * `explicit` là giá trị `MONGODB_DB` CỦA TRẠM ĐANG XÉT — truyền vào chứ không đọc thẳng từ
 * `process.env`, vì máy đồng bộ phải giải tên cho HAI trạm trong cùng một tiến trình và env
 * cục bộ chỉ nói thay được cho một trong hai.
 */
export function resolveMongoDbName(uri: string, explicit?: string | null): string {
  const named = explicit?.trim();
  if (named) return named;
  try {
    // URI mongodb+srv:// có thể mang đường dẫn database, và chuỗi từ Atlas thì không.
    const path = new URL(uri.replace(/^mongodb(\+srv)?:/, "http:")).pathname.replace(/^\//, "");
    if (path) return decodeURIComponent(path);
  } catch {
    // URI lạ thì thôi — dùng mặc định, và lỗi thật (nếu có) sẽ nổ ở lúc connect với nguyên văn.
  }
  return MONGO_DEFAULT_DB;
}
