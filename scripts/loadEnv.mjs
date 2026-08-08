import { readFileSync } from "node:fs";

/**
 * Nạp biến môi trường vào process.env cho các script chạy bằng Node thuần (migrate, seed,
 * verify) — Next.js tự lo phần này, còn script thì không.
 *
 * Dùng chung cho mọi script thay vì mỗi file chép một bản: bản chép tay trong migrate.mjs
 * từng đặt phép kiểm tra DATABASE_URL LÊN TRƯỚC đoạn nạp file, nên nó luôn báo "chưa đặt"
 * dù .env có đủ. Một hàm, một thứ tự đúng, gọi ở dòng đầu tiên.
 *
 * Đọc CẢ HAI tệp theo đúng thứ tự ưu tiên của Next.js — `.env.local` thắng `.env` — và đó là
 * một cái bẫy đã cắn thật, không phải phòng xa. `vercel env pull` ghi vào `.env.local`, Next
 * đọc `.env.local`, nhưng hàm này từng chỉ đọc `.env`. Hậu quả: kéo biến về xong thì `next
 * dev` thấy đủ kho, còn `npm run verify:media` vẫn một mực báo "kho chưa khai mở" — cùng một
 * máy, cùng một lúc, hai câu trả lời trái ngược, và không có gì trên màn hình gợi ý vì sao.
 *
 * Biến đã có sẵn trong môi trường luôn THẮNG cả hai tệp — nhờ vậy CI hay Vercel ghi đè được
 * mà không cần sửa file. Chính luật "không ghi đè" ấy làm nên thứ tự trên: nạp `.env.local`
 * trước thì giá trị của nó chiếm chỗ, và `.env` chỉ điền vào những khoá còn trống.
 */
const DEFAULT_FILES = [".env.local", ".env"];

export function loadEnv(path) {
  for (const file of path === undefined ? DEFAULT_FILES : [path]) {
    loadEnvFile(file);
  }
}

function loadEnvFile(path) {
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return; // Vắng một tệp là chuyện bình thường — Vercel không có tệp nào cả.
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
