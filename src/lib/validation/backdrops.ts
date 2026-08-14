/**
 * Luật của TẤM NỀN — sổ trang chọn được nền riêng, và phép dựng CSS từ phép gán ấy.
 *
 * Tệp này KHÔNG import gì cả, và phải giữ nguyên như vậy — cùng lý do đã ghi ở đầu
 * `validation/tags.ts`: tab Giao Diện là component `"use client"`, nên mọi thứ nó import đều
 * đi thẳng vào bundle của trình duyệt. Sổ trang thì cả hai phía đều cần (giao diện vẽ bảng
 * chọn, layout gốc dựng CSS), nên nó phải sống ở một chỗ không kéo theo zod hay driver nào.
 */

/**
 * Ảnh nền CỨU HỘ, nằm trong `public/` của chính repo.
 *
 * Nó là đáy của thang rơi, và cái thang ấy có ba nấc: nền của trang → nền mặc định → tấm này.
 * Giữ một tấm trong repo là chủ ý: tàng khố OCI chưa cấu hình, hoặc kho tạm không với tới
 * được, hoặc ai đó lỡ xoá ảnh đang dùng — cả ba đều không được phép biến tông môn thành một
 * khung màu đen trơn. Đây là tấm gốc「Nam Cung Uyển dưới trăng」.
 */
export const RESCUE_BACKDROP_URL = "/backdrop.png";

/**
 * Những trang chọn được nền RIÊNG.
 *
 * TRANG CHỦ cố ý vắng mặt: nó không phải một mục trong bảng chọn, nó CHÍNH LÀ nền mặc định.
 * Đổi nền mặc định là đổi nền trang chủ, và cũng là đổi nền của mọi trang chưa ai chọn gì —
 * một khái niệm, một ô để bấm, không phải hai thứ phải nhớ giữ cho khớp nhau.
 *
 * `key` là thứ đi vào `data-backdrop` trên trang và vào khoá của phép gán trong app_settings,
 * nên nó là một MÃ ỔN ĐỊNH: đổi nó là làm mồ côi phép gán đã lưu dưới database thật. `path`
 * chỉ để giao diện chỉ đường cho người quản, không có luật nào đọc nó.
 */
export const BACKDROP_PAGES = [
  { key: "dashboard", label: "Auto", path: "/dashboard" },
  { key: "hang-doi", label: "Hàng Đợi", path: "/hang-doi" },
  { key: "chat", label: "Phòng Chat", path: "/chat" },
  { key: "admin", label: "Tông Môn", path: "/admin" },
  { key: "profile", label: "Hồ Sơ", path: "/profile" },
  { key: "login", label: "Đăng nhập", path: "/login" },
  { key: "register", label: "Bái sư", path: "/register" },
  { key: "pending", label: "Hàng chờ", path: "/pending" },
  { key: "be-quan", label: "Bế quan", path: "/be-quan" },
] as const;

export type BackdropPageKey = (typeof BACKDROP_PAGES)[number]["key"];

/**
 * Tên ô của NỀN MẶC ĐỊNH khi giao diện và cửa ghi nói chuyện với nhau.
 *
 * Một chuỗi riêng chứ không phải `null`, vì `null` trong cùng một trường còn mang nghĩa "bỏ
 * chọn" — hai ý nghĩa chồng lên nhau ở một chỗ là cách sinh ra lỗi không ai đọc ra được. Nó
 * cố tình KHÔNG trùng mã trang nào (sổ trên không có trang nào tên "default").
 */
export const DEFAULT_SLOT = "default";

const PAGE_KEYS: ReadonlySet<string> = new Set(BACKDROP_PAGES.map((page) => page.key));

/** Mã trang này có thật trong sổ không — phép gán mồ côi (trang đã gỡ) bị bỏ qua nhờ nó. */
export function isBackdropPageKey(value: string): value is BackdropPageKey {
  return PAGE_KEYS.has(value);
}

/**
 * Một tấm nền đã chọn: `url` để vẽ, `key` để còn xoá được object trong kho và để biết ảnh nào
 * trong lưới đang được dùng. Giữ cả hai vì suy ngược URL ra key là một phép giải mã chạy
 * trước một lệnh XOÁ — cùng lý lẽ đã ghi ở cột `avatarKey` trong schema.ts.
 */
export type BackdropImage = { key: string; url: string };

/** Phép gán: mã trang → ảnh. Trang vắng mặt nghĩa là "theo mặc định", không phải "không nền". */
export type BackdropAssignments = Partial<Record<BackdropPageKey, BackdropImage>>;

/** Một tấm trong lưới chọn. `sizeLabel` do server dựng sẵn — xem ghi chú tại BackdropManager. */
export type BackdropChoice = BackdropImage & { sizeLabel: string };

/**
 * Tên hiển thị suy từ key: `backdrops/tu-linh-tien-tu-a1B2c3D4e5F6g7H8.png` → `tu-linh-tien-tu`.
 *
 * Lưới ảnh đọc thẳng từ kho nên không có sổ nào giữ nhãn — cái tên nằm trong key là thứ DUY
 * NHẤT phân biệt được hai tấm bằng mắt, và hậu tố ngẫu nhiên 16 ký tự thì chỉ làm rối.
 *
 * Cắt hụt cũng không sao: hàm này chỉ vẽ chữ, không có luật nào đọc kết quả của nó. Nên khi
 * hình dạng key lạ (object do người tạo tay trong console OCI chẳng hạn) thì nó trả về nguyên
 * phần tên tệp — vẫn đọc được, chỉ dài hơn.
 */
export function backdropDisplayName(key: string): string {
  const fileName = key.slice(key.lastIndexOf("/") + 1);
  const withoutExtension = fileName.replace(/\.[A-Za-z0-9]{1,16}$/, "");
  // Hậu tố là base64url của 12 byte = đúng 16 ký tự, luôn đứng sau một dấu gạch nối.
  const withoutSuffix = withoutExtension.replace(/-[A-Za-z0-9_-]{16}$/, "");
  return withoutSuffix.length > 0 ? withoutSuffix : fileName;
}

/**
 * Tên tệp khi lưu về máy: tên hiển thị CỘNG đuôi thật — `Tống_Ngọc-suM_mVW5XO1nVNi_.png`
 * → `Tống_Ngọc.png`.
 *
 * Vì sao không dùng thẳng `backdropDisplayName`: nó CẮT đuôi file (đúng với việc của nó — vẽ
 * chữ dưới ô ảnh). Lấy nguyên kết quả ấy làm tên tải về là ném cho đạo hữu một tệp không đuôi,
 * và Windows thì mở tệp bằng đuôi chứ không bằng nội dung.
 *
 * Vì sao không dùng thẳng tên tệp trong key: nó mang hậu tố ngẫu nhiên 16 ký tự, thứ chỉ có
 * nghĩa với tàng khố. Thư mục Downloads thì cần một cái tên người đọc được.
 *
 * Key lạ không có đuôi (object tạo tay trong console OCI) thì trả về tên trần, không bịa đuôi:
 * đoán sai đuôi còn tệ hơn không có, vì lúc ấy hệ điều hành mở nó bằng nhầm chương trình.
 */
export function backdropDownloadName(key: string): string {
  const fileName = key.slice(key.lastIndexOf("/") + 1);
  const extension = /\.[A-Za-z0-9]{1,16}$/.exec(fileName)?.[0] ?? "";
  return `${backdropDisplayName(key)}${extension}`;
}

/**
 * URL có an toàn để nhét vào một thẻ `<style>` không.
 *
 * Đây là một RANH GIỚI TIN CẬY thật sự, không phải phòng xa: chuỗi này đi từ app_settings —
 * một document JSONB mà người có quyền vào database sửa tay được — thẳng vào HTML. Một URL
 * chứa `")}` là thoát khỏi luật CSS và viết luật của riêng nó; chứa `</style>` là thoát hẳn
 * khỏi thẻ và viết HTML. Nên chỗ này KHÔNG lọc ký tự xấu (danh sách đen luôn thiếu một cái),
 * mà chỉ CHO PHÉP đúng hình dạng đã biết:
 *
 *   • đường dẫn cùng gốc:  /backdrop.png
 *   • URL của tàng khố:    https://<host>/<đường dẫn đã mã hoá phần trăm>
 *
 * Không dấu ngoặc, không khoảng trắng, không dấu nháy, không `<`. Trả `null` nghĩa là "không
 * dùng được" — người gọi rơi xuống nấc dưới của thang, chứ không vẽ ra một luật CSS méo.
 */
/**
 * `(?!\/)` sau dấu gạch chéo đầu KHÔNG phải để cho đẹp: thiếu nó thì `//example.com/a.png`
 * lọt qua — dấu gạch chéo nằm trong bộ ký tự cho phép, nên chuỗi ấy vẫn là "gạch chéo rồi
 * toàn ký tự hợp lệ". Mà đó là URL theo GIAO THỨC TƯƠNG ĐỐI: trình duyệt tải tấm nền từ
 * `example.com`, không phải từ tông môn. Phép thử trong `verify:backdrops` bắt được đúng ngả
 * này, và nó là lý do dòng regex này trông kỳ.
 */
const SAME_ORIGIN_PATH = /^\/(?!\/)[A-Za-z0-9._~\-/%]*$/;
const HTTPS_URL = /^https:\/\/[A-Za-z0-9.\-]+(?::\d{1,5})?\/[A-Za-z0-9._~\-/%]*$/;

export function safeBackdropUrl(url: string): string | null {
  const trimmed = url.trim();
  if (trimmed.length === 0 || trimmed.length > 2048) return null;
  if (SAME_ORIGIN_PATH.test(trimmed) || HTTPS_URL.test(trimmed)) return trimmed;
  return null;
}

/**
 * Dựng phần CSS mà layout gốc rót vào `<head>`.
 *
 * Hình dạng luật giống hệt bản viết tay trước đây trong globals.css, và cách chọn cũng vậy:
 * trang đánh dấu `data-backdrop="<mã>"`, `body:has(...)` tìm dấu ấy. Cái đổi chỉ là URL giờ
 * đến từ cấu hình thay vì được gõ cứng — nên toàn bộ lý lẽ đã đo về `:has()` (vì sao không
 * dùng JS, và vì sao phải gửi HTML một cục) vẫn nguyên giá trị; xem chú thích tại `.backdrop`
 * trong globals.css.
 *
 * Trả về chuỗi RỖNG khi không có gì để đắp đè — lúc ấy luật gốc trong globals.css lo tất, và
 * `<head>` không phải cõng một thẻ style trống.
 */
export function backdropCss(
  defaultBackdrop: BackdropImage | null,
  assignments: BackdropAssignments,
): string {
  const rules: string[] = [];

  const fallback = defaultBackdrop && safeBackdropUrl(defaultBackdrop.url);
  if (fallback) {
    rules.push(`.backdrop{background-image:url("${fallback}")}`);
  }

  // Duyệt theo SỔ TRANG chứ không theo khoá của `assignments`: một mã lạ trong document JSONB
  // (trang đã gỡ, hoặc ai đó gõ tay) không được sinh ra luật CSS nào. Và thứ tự luật cũng ổn
  // định theo sổ, nên hai lần dựng cùng một cấu hình cho ra cùng một chuỗi.
  for (const page of BACKDROP_PAGES) {
    const chosen = assignments[page.key];
    if (!chosen) continue;
    const url = safeBackdropUrl(chosen.url);
    if (!url) continue;
    rules.push(`body:has([data-backdrop="${page.key}"]) .backdrop{background-image:url("${url}")}`);
  }

  return rules.join("");
}
