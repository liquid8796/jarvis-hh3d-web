/**
 * ĐỌC VÀ VÁ TỆP .env — phần THUẦN, không chạm đĩa.
 *
 * VÌ SAO TÁCH RA: `syncActiveStationEnv.mts` gọi `loadEnv()` rồi đọc bảng điều phối ngay ở thân
 * module, nên nhập nó vào để thử một hàm là chạy luôn cả lượt đồng bộ. Cùng lý do đã tách
 * `usageMeters.mts` khỏi `vercelUsageFull.mts`: một đoạn mã sống trong tệp tự chạy là đoạn mã
 * KHÔNG phép kiểm nào với tới được — mà phép vá `.env.local` thì đúng là chỗ không được sai, vì
 * nó ghi đè tệp giữ TOÀN BỘ chìa khoá của máy này.
 *
 * ── NGỮ NGHĨA PHẢI KHỚP `loadEnv.mjs`, KHÔNG ĐƯỢC TỰ BỊA ───────────────────────────────────
 *
 * `loadEnv` cắt dòng theo `\n`, bỏ dòng trống và dòng mở đầu bằng `#`, tách ở dấu `=` ĐẦU TIÊN,
 * trim hai vế, rồi bóc ĐÚNG MỘT lớp nháy bao ngoài mà KHÔNG xử lý ký tự thoát. Bản đọc ở đây đi
 * đúng từng bước ấy — lệch một bước là công cụ đọc ra một giá trị, còn app đọc ra giá trị khác.
 */

/** Dòng có dạng gán biến hay không, theo đúng luật `loadEnv`: bỏ trống, bỏ chú thích, cần `=`. */
function assignmentKey(line: string): string | null {
  const trimmed = line.trim();
  if (trimmed.length === 0 || trimmed.startsWith("#")) return null;
  const eq = trimmed.indexOf("=");
  if (eq < 1) return null;
  return trimmed.slice(0, eq).trim();
}

/** Bóc đúng một lớp nháy bao ngoài — y hệt `loadEnv`, và cũng KHÔNG xử lý ký tự thoát. */
function unquote(raw: string): string {
  const value = raw.trim();
  const quoted =
    value.length >= 2 &&
    ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")));
  return quoted ? value.slice(1, -1) : value;
}

/**
 * Đọc một tệp .env thành bảng.
 *
 * Khoá TRÙNG thì giữ lần xuất hiện ĐẦU, vì `loadEnv` chỉ gán khi khoá chưa có trong `process.env`
 * — tức lần đầu thắng. (Còn dotenv của Next thì lần CUỐI thắng; hai bên bất đồng ở đúng chỗ này,
 * và đó là lý do `mergeEnvFile` bên dưới thay MỌI lần xuất hiện thay vì thay một.)
 */
export function parseEnvFile(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of text.split("\n")) {
    const key = assignmentKey(line);
    if (key === null || out.has(key)) continue;
    const trimmed = line.trim();
    out.set(key, unquote(trimmed.slice(trimmed.indexOf("=") + 1)));
  }
  return out;
}

/**
 * Một giá trị viết ra tệp thì phải đọc lại được y nguyên — bởi CẢ `loadEnv` LẪN dotenv của Next.
 *
 * Luôn bao nháy, không "chỉ bao khi cần": Vercel cũng ghi `KEY="giá trị"`, và một chuỗi kết nối
 * không nháy mà chứa `#` thì dotenv cắt cụt tại đó (nó coi `#` giữa dòng là mở đầu chú thích) —
 * còn `loadEnv` lại đọc trọn. Một giá trị đọc ra hai kiểu tuỳ công cụ là dạng lỗi tệ nhất ở đây.
 *
 * NÉM chứ không đoán khi giá trị chứa cả hai loại nháy, hoặc chứa xuống dòng: định dạng này (bóc
 * một lớp nháy, KHÔNG xử lý ký tự thoát) không biểu diễn nổi chúng. Ghi bừa một chuỗi sai rồi để
 * người ta phát hiện lúc database từ chối kết nối thì đắt hơn nhiều một lời từ chối ngay tại đây.
 */
export function formatEnvValue(value: string): string {
  if (/[\r\n]/.test(value)) {
    throw new Error("Giá trị chứa ký tự xuống dòng — tệp .env một-dòng-một-biến không chứa nổi.");
  }
  if (!value.includes('"')) return `"${value}"`;
  if (!value.includes("'")) return `'${value}'`;
  throw new Error(
    "Giá trị chứa CẢ nháy đơn lẫn nháy kép — định dạng .env ở kho này bóc một lớp nháy và không " +
      "xử lý ký tự thoát, nên không viết ra an toàn được. Đổi mật khẩu/chuỗi kết nối cho bớt nháy.",
  );
}

export type EnvMergeResult = {
  /** Nội dung mới. Bằng đúng `original` khi không có gì phải đổi. */
  text: string;
  /** Khoá đã có sẵn và giá trị ĐÃ ĐỔI. */
  replaced: string[];
  /** Khoá chưa có, thêm vào cuối tệp. */
  added: string[];
  /** Khoá đã có sẵn và giá trị vốn đã đúng — không đụng tới dòng ấy. */
  unchanged: string[];
  /** Khoá xuất hiện NHIỀU LẦN trong tệp gốc. Người gọi nên kêu lên, xem `mergeEnvFile`. */
  duplicated: string[];
};

/**
 * Vá các khoá trong `updates` vào nội dung một tệp .env, GIỮ NGUYÊN mọi thứ còn lại.
 *
 * Giữ nguyên là yêu cầu cứng, không phải phép lịch sự: `.env.local` dưới máy này còn giữ chìa
 * OCI, chìa Vercel của từng tài khoản, `ENCRYPTION_KEY`, token khôi lỗi… Dựng lại tệp từ bảng đã
 * đọc là mất sạch chú thích, mất thứ tự, và mất luôn những dòng mà phép đọc bỏ qua.
 *
 * THAY MỌI LẦN XUẤT HIỆN của một khoá, không thay mỗi lần đầu: `loadEnv` lấy lần ĐẦU còn dotenv
 * của Next lấy lần CUỐI, nên một khoá trùng mà chỉ vá một chỗ là dựng sẵn cảnh「công cụ nối vào
 * trạm mới, app nối vào trạm cũ」— đúng loại lỗi im lặng mà cả tầng gương trạm này sinh ra để
 * tránh. Khoá trùng vẫn được BÁO ra ngoài qua `duplicated`, vì tự nó đã là một dấu hiệu xấu.
 *
 * Xuống dòng theo ĐÚNG tệp gốc: cây làm việc này là Windows và `.env.local` thường mang CRLF —
 * viết LF vào giữa một tệp CRLF là đẻ ra một diff bẩn và một dòng mà mắt người không thấy khác.
 */
export function mergeEnvFile(original: string, updates: ReadonlyMap<string, string>): EnvMergeResult {
  const seen = new Map<string, number>();
  const replaced = new Set<string>();
  const unchanged = new Set<string>();

  const lines = original.split("\n");
  const patched = lines.map((line) => {
    const key = assignmentKey(line);
    if (key === null) return line;
    seen.set(key, (seen.get(key) ?? 0) + 1);
    if (!updates.has(key)) return line;

    const trimmed = line.trim();
    const current = unquote(trimmed.slice(trimmed.indexOf("=") + 1));
    const wanted = updates.get(key)!;
    if (current === wanted) {
      unchanged.add(key);
      return line;
    }
    replaced.add(key);
    // Giữ lại `\r` cuối dòng của chính dòng ấy — xem ghi chú xuống dòng ở đầu hàm.
    return `${key}=${formatEnvValue(wanted)}${line.endsWith("\r") ? "\r" : ""}`;
  });

  const added = [...updates.keys()].filter((key) => !seen.has(key));

  if (added.length > 0) {
    const cr = original.includes("\r\n") ? "\r" : "";
    const fresh = added.map((key) => `${key}=${formatEnvValue(updates.get(key)!)}${cr}`);
    // Tệp kết thúc bằng dòng mới thì `split("\n")` để lại một ô RỖNG ở cuối — chèn TRƯỚC ô ấy để
    // dòng kết cuối tệp còn nguyên. Tệp thiếu dòng kết thì thêm vào rồi tự đóng lại bằng ô rỗng.
    if (patched[patched.length - 1] === "") patched.splice(patched.length - 1, 0, ...fresh);
    else patched.push(...fresh, "");
  }

  return {
    text: patched.join("\n"),
    replaced: [...replaced],
    added,
    unchanged: [...unchanged],
    duplicated: [...seen.entries()].filter(([, n]) => n > 1).map(([key]) => key),
  };
}
