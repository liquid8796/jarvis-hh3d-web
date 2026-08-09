#!/usr/bin/env node
/**
 * Phát một phiên đăng nhập NGẮN HẠN để kiểm giao diện nằm sau cửa đăng nhập — không ai phải
 * gõ mật khẩu vào đâu cả.
 *
 * Vì sao tồn tại: mọi trang đáng xem của hệ thống đều nằm sau `requireActiveUser()`, nên
 * kiểm chứng bằng mắt luôn vướng một bước đăng nhập. Đường này không đụng tới mật khẩu: nó
 * ký đúng thứ mà `createSession()` ký — `AUTH_SECRET` đã có sẵn trên máy — rồi in ra giá trị
 * cookie để dán vào trình duyệt.
 *
 * Nó cũng làm được thứ mà đăng nhập bằng mật khẩu KHÔNG làm nổi: đóng vai BẤT KỲ đạo hữu nào
 * mà không cần biết mật khẩu của họ. Muốn kiểm ma trận quyền cho đúng thì phải nhìn cùng một
 * trang bằng mắt Gia chủ, mắt Trưởng môn thường và mắt môn đồ — ba người, ba mật khẩu không
 * ai biết. Đây mới là công cụ đúng cho việc ấy, không phải một bản thay thế cho tiện.
 *
 * CẢNH BÁO ĐÃ CÂN NHẮC: `AUTH_SECRET` dưới máy CHÍNH LÀ secret của production (kéo từ Vercel
 * về), nên token phát ra ở đây dùng được cả trên production. Script không mở thêm cửa nào —
 * ai cầm AUTH_SECRET thì vốn đã ký được phiên rồi — nhưng nó khiến việc đó tiện, và tiện thì
 * dễ buông tay. Vì vậy hạn dùng cố tình ngắn: một token lỡ lọt ra chỉ sống được ít phút.
 *
 *   npx tsx scripts/devSession.mts                 # đạo hiệu trong ADMIN_USERNAME, mặc định "admin"
 *   npx tsx scripts/devSession.mts --user someone  # đóng vai người khác
 */
import { neon } from "@neondatabase/serverless";
import { SignJWT } from "jose";
import { loadEnv } from "./loadEnv.mjs";

loadEnv();

/** Ngắn có chủ ý — xem cảnh báo ở đầu tệp. Đủ cho một lượt kiểm, không đủ để quên mất nó. */
const TTL_MINUTES = 30;

const COOKIE = "jarvis_session";

const argAt = process.argv.indexOf("--user");
const username = (argAt > -1 ? process.argv[argAt + 1] : undefined) ?? process.env.ADMIN_USERNAME ?? "admin";

if (!process.env.DATABASE_URL) throw new Error("Thiếu DATABASE_URL — chạy `npm run env:pull` trước.");
if (!process.env.AUTH_SECRET || process.env.AUTH_SECRET === "change-me") {
  throw new Error("Thiếu AUTH_SECRET — không ký được phiên nào.");
}

const sql = neon(process.env.DATABASE_URL);
// Vai đọc từ `user_roles` chứ không từ cột gương `users.roles` — phiên đóng vai phải nhìn
// đúng thứ mà guard nhìn, nếu không thì một lượt kiểm giao diện đang kiểm nhầm hệ thống.
const rows = await sql`
  select u.id, u.username, u.display_name, u.status,
         coalesce((select array_agg(ur.role_code order by r.sort_order)
                     from user_roles ur join roles r on r.code = ur.role_code
                    where ur.user_id = u.id), '{}') as roles
    from users u where u.username = ${username.toLowerCase()} limit 1
`;

const user = rows[0];
if (!user) {
  console.error(`Không có đạo hữu nào tên「${username}」. Xem danh sách: npm run db:seed đã chạy chưa?`);
  process.exit(1);
}

// Hỏi ma trận thay vì chép tay danh sách vai: bản chép tay ở đây từng chỉ biết hai vai, nên
// một phiên đóng vai Chưởng môn sẽ mang claim "user" — vô hại (không ai đọc claim ấy để phân
// quyền, guard đọc lại hàng user mỗi request) nhưng là một luật thứ hai sống lệch luật thật.
const { isAdminUser } = await import("../src/lib/auth/permissions.ts");
const token = await new SignJWT({
  username: user.username,
  role: isAdminUser({ roles: user.roles ?? [] }) ? "admin" : "user",
})
  .setProtectedHeader({ alg: "HS256" })
  .setSubject(user.id)
  .setIssuedAt()
  .setExpirationTime(`${TTL_MINUTES}m`)
  .sign(new TextEncoder().encode(process.env.AUTH_SECRET));

console.log(`• Đóng vai: ${user.display_name} (@${user.username}) — vai [${(user.roles ?? []).join(", ") || "môn đồ"}], trạng thái ${user.status}`);
console.log(`• Hạn dùng: ${TTL_MINUTES} phút.`);
console.log("");
console.log("Dán vào console của trình duyệt đang mở localhost:3000, rồi tải lại trang:");
console.log("");
console.log(`document.cookie = ${JSON.stringify(`${COOKIE}=${token}; path=/; max-age=${TTL_MINUTES * 60}`)}`);
