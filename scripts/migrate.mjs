#!/usr/bin/env node
/**
 * Áp mọi migration trong ./drizzle lên DATABASE_URL.
 *
 * Chạy được cả trên máy nhà lẫn trong build của Vercel, và chỉ cần đúng một biến môi
 * trường. Neon-http là driver duy nhất ở đây (giống hệt runtime), nên không có chuyện
 * "migrate bằng đường này, chạy bằng đường khác" rồi lệch nhau về SSL hay pooling.
 */
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { migrate } from "drizzle-orm/neon-http/migrator";
import { loadEnv } from "./loadEnv.mjs";

// Nạp TRƯỚC khi kiểm tra. Thứ tự ngược lại khiến script luôn báo "chưa đặt" dù .env có đủ —
// đúng lỗi đã xảy ra ở lần chạy đầu tiên.
loadEnv();

if (!process.env.DATABASE_URL) {
  console.error(
    "DATABASE_URL chưa được đặt.\n" +
      "Database trên Vercel? Kéo biến của môi trường production về:\n" +
      "  vercel env pull .env --environment=production",
  );
  process.exit(1);
}

// Nói RA đang sắp sửa database nào, trước khi sửa. `loadEnv()` đọc `.env.local` trước rồi
// mới tới `.env`, nên hai tệp lỡ trỏ hai nơi khác nhau thì cái được chọn không hiện ra ở đâu
// cả — và một migration chạy nhầm database là loại sai lầm không có nút hoàn tác. In host
// thì người bấm lệnh nhìn thấy ngay mình đang đứng trước cửa nào.
let target;
try {
  const parsed = new URL(process.env.DATABASE_URL);
  target = `${parsed.host}${parsed.pathname}`;
} catch {
  // Dừng NGAY tại đây thay vì để `neon()` phân xử, vì CẢ HAI đường phía sau đều dán nguyên
  // chuỗi kết nối — kèm mật khẩu — ra console và log CI: `new URL` ném TypeError mang chuỗi
  // trong thuộc tính `input` (Node in thuộc tính ấy khi lỗi không được bắt), còn `neon()`
  // thì viết thẳng "Connection string: <nguyên văn>". Cả hai đều đã đo, không phải phòng xa.
  console.error(
    "DATABASE_URL không phải một URL hợp lệ.\n" +
      "Không in giá trị ra đây vì nó chứa mật khẩu — hãy tự soi .env.local rồi tới .env " +
      "(tệp trước thắng tệp sau).",
  );
  process.exit(1);
}
console.log(`• Áp migration lên ${target}`);

const db = drizzle(neon(process.env.DATABASE_URL));

await migrate(db, { migrationsFolder: "./drizzle" });
console.log("✔ Migration đã áp xong.");
