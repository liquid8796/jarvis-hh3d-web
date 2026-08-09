#!/usr/bin/env node
/**
 * Chụp ảnh MỘT trang của web đang chạy dưới máy, kể cả trang nằm sau cửa đăng nhập.
 *
 *   npm run shot -- --path /chat --out anh/chat.png
 *   npm run shot -- --path /admin --user admin --width 1600 --full
 *
 * VÌ SAO CẦN: Browser pane của Claude Code chỉ dựng frame khi nó đang HIỂN THỊ — pane ẩn thì
 * `screenshot` hết giờ, ảnh `loading="lazy"` không bao giờ tải, `img.decode()` treo. Tức mọi
 * lượt kiểm giao diện bằng MẮT đều phải nhờ tay người mở pane ra. Chromium do chính script
 * này khởi động thì không dính chuyện đó: nó luôn dựng frame, dù không ai nhìn.
 *
 * Playwright-core và bộ Chromium đã có sẵn trong repo (quest-engine dùng chúng để cày nhiệm
 * vụ), nên công cụ này không thêm một dependency nào.
 *
 * Phiên đăng nhập ký giống hệt `dev:session` — không ai phải gõ mật khẩu vào đâu, và hạn
 * dùng cố tình ngắn. Xem cảnh báo ở đầu scripts/devSession.mts về việc AUTH_SECRET dưới máy
 * chính là secret của production.
 */
import { neon } from "@neondatabase/serverless";
import { SignJWT } from "jose";
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { loadEnv } from "./loadEnv.mjs";

loadEnv();

const COOKIE = "jarvis_session";
/** Ngắn có chủ ý — một tấm ảnh không cần một phiên sống lâu. */
const TTL_MINUTES = 10;

function arg(name: string, fallback?: string): string | undefined {
  const at = process.argv.indexOf(`--${name}`);
  return at > -1 ? process.argv[at + 1] : fallback;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

/**
 * Đường dẫn trang. Nhận cả `chat` lẫn `/chat` — CỐ Ý, vì Git Bash trên Windows tự dịch một
 * đối số bắt đầu bằng `/` thành đường dẫn Windows: `--path /chat` tới tay script đã thành
 * `C:/Program Files/Git/chat`. Chấp nhận dạng không gạch chéo là lối thoát khỏi cái bẫy ấy
 * (cách khác: đặt `MSYS_NO_PATHCONV=1` trước lệnh).
 */
const rawPath = arg("path", "/")!;
const mangled = rawPath.match(/^[A-Za-z]:[\\/].*?[\\/]Git[\\/](.*)$/);
const path = mangled ? `/${mangled[1]}` : rawPath.startsWith("/") ? rawPath : `/${rawPath}`;
if (mangled) {
  console.log(`• Git Bash đã bẻ「${rawPath}」— hiểu lại thành「${path}」.`);
}
const out = resolve(arg("out", "shot.png")!);
const username = arg("user") ?? process.env.ADMIN_USERNAME ?? "admin";
const origin = arg("origin", "http://localhost:3000")!;
const width = Number(arg("width", "1440"));
const height = Number(arg("height", "1000"));
/** Chờ một phần tử cụ thể xuất hiện trước khi bấm máy — trang có poll thì HTML đầu còn trống. */
const waitFor = arg("wait");

if (!Number.isInteger(width) || !Number.isInteger(height) || width < 320 || height < 240) {
  throw new Error(`--width/--height phải là số nguyên hợp lý, nhận ${width}x${height}.`);
}
if (!process.env.AUTH_SECRET || process.env.AUTH_SECRET === "change-me") {
  throw new Error("Thiếu AUTH_SECRET — không ký được phiên nào (chạy `npm run env:pull`).");
}
if (!process.env.DATABASE_URL) {
  throw new Error("Thiếu DATABASE_URL — chạy `npm run env:pull` trước.");
}

// Vai đọc từ `user_roles` như guard đọc, không từ cột gương — cùng lý do đã ghi ở devSession.
const sql = neon(process.env.DATABASE_URL);
const rows = await sql`
  select u.id, u.username, u.display_name,
         coalesce((select array_agg(ur.role_code order by r.sort_order)
                     from user_roles ur join roles r on r.code = ur.role_code
                    where ur.user_id = u.id), '{}') as roles
    from users u where u.username = ${username.toLowerCase()} limit 1
`;
const user = rows[0];
if (!user) {
  console.error(`Không có đạo hữu nào tên「${username}」.`);
  process.exit(1);
}

const roles: string[] = user.roles ?? [];
const token = await new SignJWT({
  username: user.username,
  role: roles.some((r) => ["gia-chu", "admin", "chuong-mon", "thai-thuong-truong-lao"].includes(r)) ? "admin" : "user",
})
  .setProtectedHeader({ alg: "HS256" })
  .setSubject(user.id as string)
  .setIssuedAt()
  .setExpirationTime(`${TTL_MINUTES}m`)
  .sign(new TextEncoder().encode(process.env.AUTH_SECRET));

mkdirSync(dirname(out), { recursive: true });

const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({
    viewport: { width, height },
    // Chụp ở 2× cho chữ và hoa văn không bị răng cưa — ảnh để SOI, không phải để tiết kiệm byte.
    deviceScaleFactor: 2,
    colorScheme: "dark",
  });
  await context.addCookies([
    { name: COOKIE, value: token, url: origin, httpOnly: true, sameSite: "Lax" },
  ]);

  const page = await context.newPage();
  const problems: string[] = [];
  page.on("console", (m) => m.type() === "error" && problems.push(m.text().slice(0, 160)));
  page.on("requestfailed", (r) => problems.push(`${r.method()} ${r.url().slice(0, 90)} — ${r.failure()?.errorText}`));

  const res = await page.goto(`${origin}${path}`, { waitUntil: "networkidle", timeout: 45_000 });
  console.log(`• ${path} → HTTP ${res?.status()} (đóng vai @${user.username}${roles.length ? ` [${roles.join(", ")}]` : ""})`);

  if (waitFor) {
    await page.waitForSelector(waitFor, { timeout: 20_000 });
  }
  // Ảnh trong trang tải xong hẳn rồi mới bấm máy — không thì bài vị/ảnh đại diện ra ô trống.
  await page.evaluate(async () => {
    await Promise.all(
      [...document.images].filter((i) => !i.complete).map((i) => i.decode().catch(() => {})),
    );
  });
  await page.waitForTimeout(400);

  await page.screenshot({ path: out, fullPage: flag("full") });
  console.log(`✔ Đã chụp → ${out}`);

  // Lỗi console/mạng NÓI RA chứ không nuốt: một tấm ảnh đẹp che được rất nhiều thứ hỏng.
  if (problems.length > 0) {
    console.log(`⚠ ${problems.length} lỗi trong trang:`);
    for (const p of problems.slice(0, 8)) console.log(`   ${p}`);
  }
} finally {
  await browser.close();
}
