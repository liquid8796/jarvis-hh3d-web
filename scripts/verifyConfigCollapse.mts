#!/usr/bin/env node
/**
 * Kiểm chứng phép GẤP KHỐI của Ngọc Giản Cấu Hình — trên trang thật, sau cửa đăng nhập.
 *
 *   npm run vm -- npm run verify:config-collapse -- --origin https://158.180.59.36.sslip.io
 *
 * ── THỨ NÀY CANH CÁI GÌ ──────────────────────────────────────────────────────────────────
 *
 * Ngọc giản là form UNCONTROLLED: giá trị sống trong DOM chứ không trong state (ghi chú đầu
 * `ConfigForm.tsx` nói thẳng điều đó). Nên phép gấp có đúng MỘT cách làm đúng — ẩn bằng thuộc
 * tính `hidden` — và một cách làm sai chết người: dựng lại thân khối theo điều kiện. Cách sai
 * ấy gỡ mọi input khỏi DOM, chúng không được nộp lên, zod ở máy chủ điền mặc định đè lên, và
 * **cấu hình của người dùng bị xoá sạch trong im lặng chỉ vì họ gấp một khối cho đỡ rối mắt**.
 * Cái sai ấy KHÔNG hiện ra trên ảnh chụp, không hiện ra ở `tsc`, và chỉ lộ khi có người mất
 * cấu hình. Nên nó phải có một phép đo riêng, và đây là phép đo ấy.
 *
 * Ba câu hỏi, hỏi trên trang production thật:
 *
 *  1. Gấp xong thì thân khối còn NHÌN THẤY không? (phải: không)
 *  2. Gấp xong thì những input MANG TÊN bên trong còn nằm trong DOM, đủ số, đủ giá trị, và
 *     không bị `disabled` không? (phải: còn nguyên — đây là câu quan trọng nhất)
 *  3. Cú bấm gấp có lỡ NỘP FORM không? (phải: không một POST nào — đó là việc của
 *     `type="button"`, thiếu nó thì mỗi cú gấp là một lần khắc ngọc giản)
 *
 * Và câu thứ tư sau một cú tải lại: trang có nhớ khối nào đã gấp không.
 */
import { sqlTag } from "./pgTag.mjs";
import { SignJWT } from "jose";
import { chromium } from "playwright-core";
import { loadEnv } from "./loadEnv.mjs";

loadEnv();

const COOKIE = "jarvis_session";
const TTL_MINUTES = 10;

function arg(name: string, fallback?: string): string | undefined {
  const at = process.argv.indexOf(`--${name}`);
  return at > -1 ? process.argv[at + 1] : fallback;
}

const origin = arg("origin", "http://localhost:3000")!;
const username = arg("user") ?? process.env.ADMIN_USERNAME ?? "admin";

/**
 * Bốn khối của tab VIP — tab mở sẵn. Khối tab Thường được thử riêng ở mục cuối.
 *
 * `ownsInputs` = thân khối có chứa CHÍNH những input được nộp lên hay không. Ba khối đầu thì
 * có: ô của chúng mang `name` và giá trị đi thẳng vào FormData. Hai lưới nhiệm-vụ-ngày thì
 * KHÔNG — ô tick của chúng không mang `name`, dữ liệu thật là những `<input type="hidden"
 * name="q_…">` mà form dựng ra ở NGOÀI mọi fieldset. Nên với chúng, câu hỏi đúng không phải
 * "input còn trong thân khối chứ?" mà là "mấy cái input thật ấy có nằm ngoài tầm với của phép
 * gấp không?" — hỏi ở mục riêng bên dưới. Trộn hai câu ấy làm một là phép thử hoặc đỏ oan,
 * hoặc đậu suông.
 */
const VIP_BLOCKS = [
  { key: "meCung", label: "Mê Cung", ownsInputs: true },
  { key: "luyenDan", label: "Luyện Đan Đường", ownsInputs: true },
  { key: "khoangMach", label: "Khoáng Mạch", ownsInputs: true },
  { key: "simpleVip", label: "Nhiệm vụ ngày", ownsInputs: false },
] as const;

const results: string[] = [];
const check = (name: string, ok: boolean, detail = "") => {
  results.push(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
};

if (!process.env.AUTH_SECRET || process.env.AUTH_SECRET === "change-me") {
  console.error("Thiếu AUTH_SECRET — không ký được phiên nào.");
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error("Thiếu DATABASE_URL.");
  process.exit(1);
}

const sql = sqlTag(process.env.DATABASE_URL);
const rows = await sql`
  select u.id, u.username,
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
  role: roles.some((r) => ["gia-chu", "chuong-mon", "thai-thuong-truong-lao"].includes(r)) ? "admin" : "user",
})
  .setProtectedHeader({ alg: "HS256" })
  .setSubject(user.id as string)
  .setIssuedAt()
  .setExpirationTime(`${TTL_MINUTES}m`)
  .sign(new TextEncoder().encode(process.env.AUTH_SECRET));

/** Ảnh chụp của MỘT thân khối: mọi control mang tên, kèm giá trị và cờ `disabled`. */
type Snapshot = { name: string; type: string; value: string; disabled: boolean }[];

const browser = await chromium.launch({ headless: true, channel: "chromium" });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: "dark" });
  await context.addCookies([{ name: COOKIE, value: token, url: origin, httpOnly: true, sameSite: "Lax" }]);
  const page = await context.newPage();

  /** Mọi POST trang tự bắn ra — dùng để bắt quả tang một cú bấm lỡ nộp form. */
  const posts: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "POST") posts.push(r.url().slice(0, 120));
  });

  const res = await page.goto(`${origin}/dashboard`, { waitUntil: "networkidle", timeout: 45_000 });
  check("mở được /dashboard sau cửa đăng nhập", res?.status() === 200, `HTTP ${res?.status()}`);

  const snapshot = (bodyId: string): Promise<Snapshot> =>
    page.evaluate((id) => {
      const body = document.getElementById(id);
      if (!body) return [];
      return Array.from(body.querySelectorAll<HTMLInputElement | HTMLSelectElement>("input[name], select[name]")).map(
        (el) => ({ name: el.name, type: (el as HTMLInputElement).type ?? "select", value: el.value, disabled: el.disabled }),
      );
    }, bodyId);

  const toggleOf = (key: string) => page.locator(`[aria-controls="${key}-body"]`).first();

  for (const { key, label, ownsInputs } of VIP_BLOCKS) {
    const bodyId = `${key}-body`;
    const body = page.locator(`#${bodyId}`);
    const toggle = toggleOf(key);

    check(`${label}: có nút gấp`, (await toggle.count()) === 1, `đếm được ${await toggle.count()}`);
    check(`${label}: thân khối đang mở`, await body.isVisible());
    check(`${label}: nút khai đang mở`, (await toggle.getAttribute("aria-expanded")) === "true");

    const before = await snapshot(bodyId);

    posts.length = 0;
    await toggle.click();
    await page.waitForTimeout(250);

    check(`${label}: bấm xong thì thân khối ẩn đi`, !(await body.isVisible()));
    check(`${label}: nút khai đã gấp`, (await toggle.getAttribute("aria-expanded")) === "false");
    // Câu hỏi số 3 — `type="button"`. Một cú nộp form ở đây là khắc ngọc giản sau lưng người dùng.
    check(`${label}: cú bấm KHÔNG nộp form`, posts.length === 0, posts.join(" · ") || "không POST nào");

    // Câu hỏi số 2 — câu quan trọng nhất.
    const after = await snapshot(bodyId);
    check(
      `${label}: gấp rồi mà mọi input mang tên VẪN nằm trong DOM`,
      JSON.stringify(after) === JSON.stringify(before) && after.every((c) => !c.disabled),
      `trước ${before.length} · sau ${after.length}`,
    );
    if (ownsInputs) {
      // Chốt chống ĐẬU SUÔNG: ba khối này phải thật sự có input mang tên, không thì phép so
      // ở trên chỉ đang so hai mảng rỗng với nhau và chẳng chứng minh điều gì.
      check(`${label}: …và thân khối thật sự có input mang tên để mà giữ`, before.length > 0, `${before.length} ô`);
    }
  }

  // ---- Nhớ qua một cú tải lại -------------------------------------------------------------
  {
    await page.reload({ waitUntil: "networkidle", timeout: 45_000 });
    const stillFolded: string[] = [];
    for (const { key } of VIP_BLOCKS) {
      if (!(await page.locator(`#${key}-body`).isVisible())) stillFolded.push(key);
    }
    check(
      "tải lại trang: cả bốn khối vẫn ở nguyên trạng thái đã gấp",
      stillFolded.length === VIP_BLOCKS.length,
      stillFolded.join(", "),
    );
  }

  // ---- Mở lại: phải mở được, và input vẫn không suy suyển ---------------------------------
  {
    const { key, label } = VIP_BLOCKS[0];
    const before = await snapshot(`${key}-body`);
    posts.length = 0;
    await toggleOf(key).click();
    await page.waitForTimeout(250);
    check(`${label}: bấm lần nữa thì mở lại được`, await page.locator(`#${key}-body`).isVisible());
    check(`${label}: mở lại cũng không nộp form`, posts.length === 0, posts.join(" · ") || "không POST nào");
    check(
      `${label}: input vẫn y nguyên sau một vòng gấp–mở`,
      JSON.stringify(await snapshot(`${key}-body`)) === JSON.stringify(before),
    );
  }

  // ---- Hai lưới nhiệm vụ ngày: dữ liệu thật nằm NGOÀI tầm với của phép gấp ------------------
  {
    // Ô tick trong lưới không mang `name`; thứ được nộp lên là các input ẩn `q_…` mà form dựng
    // ra ở ngoài mọi fieldset. Nên phép gấp không thể chạm tới chúng — và đây là chỗ đóng đinh
    // điều đó, thay cho phép đếm input trong thân khối vốn vô nghĩa với hai khối này.
    const q = await page.evaluate(() => {
      const all = Array.from(document.querySelectorAll<HTMLInputElement>('input[name^="q_"]'));
      const inside = all.filter((el) => el.closest("#simpleVip-body") || el.closest("#simpleFree-body"));
      return { total: all.length, inside: inside.length };
    });
    check("có ít nhất một ô nhiệm vụ ngày đang bật để mà kiểm", q.total > 0, `${q.total} ô ẩn q_*`);
    check(
      "…và KHÔNG ô nào nằm trong thân khối gấp được — phép gấp không với tới được dữ liệu",
      q.inside === 0,
      `${q.inside} ô nằm trong`,
    );
    // Lưới đang gấp mà ô tick vẫn còn trong DOM: người dùng mở ra lại thì thấy đúng cái mình để.
    const boxes = await page.evaluate(
      () => document.querySelectorAll('#simpleVip-body input[type="checkbox"]').length,
    );
    check("lưới đang gấp nhưng ô tick vẫn nằm nguyên trong DOM", boxes > 0, `${boxes} ô tick`);
  }

  // ---- Khối của tab Thường ------------------------------------------------------------------
  {
    // Hai bản Luyện Đan / Khoáng Mạch của tab Thường mang id RIÊNG, nên không đụng nhau với
    // tab VIP — đây là chỗ một selector chung sẽ khớp nhầm sang pane đang giấu.
    const ids = await page.evaluate(() =>
      Array.from(document.querySelectorAll("[id$='-body']")).map((el) => el.id).sort(),
    );
    check(
      "mỗi bản VIP/Thường một id riêng, không id nào trùng",
      new Set(ids).size === ids.length,
      ids.join(", "),
    );
    check(
      "có đủ id của cả hai tab",
      ["luyenDan-body", "luyenDanThuong-body", "khoangMach-body", "khoangMachThuong-body", "meCung-body", "simpleFree-body", "simpleVip-body"].every(
        (id) => ids.includes(id),
      ),
      ids.join(", "),
    );
  }
} finally {
  await browser.close();
}

for (const line of results) console.log(`  ${line}`);
const failed = results.filter((r) => r.startsWith("✗"));
if (failed.length > 0) {
  console.error(`\n✗ ${failed.length}/${results.length} phép thử hỏng.`);
  process.exit(1);
}
console.log(`\n✔ Gấp khối Ngọc Giản: ${results.length} phép thử thuận.`);
