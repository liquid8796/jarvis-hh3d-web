import { readFileSync } from "node:fs";

/**
 * Nạp .env vào process.env cho các script chạy bằng Node thuần (migrate, seed) — Next.js tự
 * lo phần này, còn script thì không.
 *
 * Dùng chung cho mọi script thay vì mỗi file chép một bản: bản chép tay trong migrate.mjs
 * từng đặt phép kiểm tra DATABASE_URL LÊN TRƯỚC đoạn nạp file, nên nó luôn báo "chưa đặt"
 * dù .env có đủ. Một hàm, một thứ tự đúng, gọi ở dòng đầu tiên.
 *
 * Biến đã có sẵn trong môi trường luôn THẮNG giá trị trong file — nhờ vậy CI hay Vercel có
 * thể ghi đè mà không cần sửa file.
 */
export function loadEnv(path = ".env") {
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return; // Không có .env là chuyện bình thường khi biến đã nằm sẵn trong môi trường.
  }

  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) {
      continue;
    }

    const eq = trimmed.indexOf("=");
    if (eq < 1) {
      continue;
    }

    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();

    // Vercel ghi ra dạng KEY="value"; bóc đúng một lớp nháy bao ngoài, giữ nguyên phần
    // bên trong (chuỗi kết nối Postgres có thể chứa đủ thứ ký tự lạ).
    if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
      value = value.slice(1, -1);
    }

    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}
