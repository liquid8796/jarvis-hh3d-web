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
import { sqlTag } from "./pgTag.mjs";
import { SignJWT } from "jose";
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { forget, remember } from "./browserRegistry.mjs";
import { killByPid, stillAlive } from "./killBrowser.mjs";
import { sweepOrphans } from "./sweepBrowsers.mjs";
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
 * Mọi lần xuất hiện của một cờ, theo đúng thứ tự gõ — cho những cờ LẶP ĐƯỢC.
 *
 * Sinh ra vì `--click` một lần là không đủ, và điều đó đã chặn hai lượt kiểm chứng khác nhau:
 * trang Tông Môn bày nội dung theo tab, nên mở tab đã tiêu mất cú bấm duy nhất và cái nút cần
 * thử thì không ai bấm tới được. Playwright tôn trọng actionability nên không thể nhắm thẳng
 * vào nút nằm trong khối `hidden` — đường duy nhất là bấm lần lượt như người thật.
 */
function args(name: string): string[] {
  const found: string[] = [];
  for (let i = 0; i < process.argv.length; i++) {
    if (process.argv[i] === `--${name}` && process.argv[i + 1] !== undefined) found.push(process.argv[i + 1]);
  }
  return found;
}

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

/**
 * Bấm một thứ trước khi chụp — cần cho mọi giao diện có TAB, vì tab là state của client nên
 * URL không chở tới đó được. Nhận cả selector CSS lẫn `text=…` của Playwright:
 *
 *   npm run shot -- --path admin --click "text=Đàm Đạo" --out anh.png
 */
// Bấm lần lượt theo đúng thứ tự gõ — `--click "text=Bảo Trì" --click "text=Lưu Hạn Lưu"`.
const clicks = args("click");

/**
 * Chụp ĐÚNG MỘT VÙNG thay vì cả khung nhìn: `--clip x,y,rộng,cao` (đơn vị CSS pixel).
 *
 * Cần cho việc so từng chi tiết hoa văn: một tấm 1450px thu về vừa màn hình thì nét viền chỉ
 * còn vài pixel, nhìn không phán được gì. Cắt vùng rồi vẫn chụp ở 2× là soi được từng nét.
 */
const clipArg = arg("clip");
const clip = clipArg
  ? (() => {
      const parts = clipArg.split(",").map((n) => Number(n.trim()));
      if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
        throw new Error(`--clip cần đúng bốn số "x,y,rộng,cao", nhận「${clipArg}」.`);
      }
      const [x, y, w, h] = parts;
      return { x, y, width: w, height: h };
    })()
  : undefined;

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
const sql = sqlTag(process.env.DATABASE_URL);
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
  // `"admin"` bên PHẢI là claim của JWT phiên (`user | admin`), KHÔNG phải mã vai — vai
  // `admin` đã bị gỡ khỏi thang vai, claim này thì giữ nguyên.
  role: roles.some((r) => ["gia-chu", "chuong-mon", "thai-thuong-truong-lao"].includes(r)) ? "admin" : "user",
})
  .setProtectedHeader({ alg: "HS256" })
  .setSubject(user.id as string)
  .setIssuedAt()
  .setExpirationTime(`${TTL_MINUTES}m`)
  .sign(new TextEncoder().encode(process.env.AUTH_SECRET));

mkdirSync(dirname(out), { recursive: true });

/**
 * ĐỒNG HỒ CANH GIỜ, và vì sao script này cần một cái.
 *
 * Trước bản này nó treo THẬT — và treo im lặng: nhật ký dừng ở dòng cuối cùng nó kịp in, rồi
 * ngồi đó mãi, để lại một tiến trình Chromium mà chủ máy phải mở Task Manager giết bằng tay.
 * Chỗ treo đã tìm ra và vá bên dưới (xem phép chờ ảnh), nhưng một script tự khởi động trình
 * duyệt thì không được phép chỉ dựa vào việc "đã sửa cái treo đã biết": lần sau sẽ là một
 * chỗ khác. Nên: mỗi lượt có hạn chót, hụt hạn thì GIẾT rồi thử lại, và hết lượt thì chết
 * hẳn với mã thoát khác 0 chứ không treo.
 */
const ATTEMPT_TIMEOUT_MS = Number(arg("timeout", "90000"));
const MAX_ATTEMPTS = 2;
/** Trần chờ ảnh trong trang tải xong. Xem chỗ dùng — đây chính là chỗ từng treo vô hạn. */
const IMAGE_WAIT_MS = 4000;
/** `kill()` của Playwright cũng là một lời hứa, và lời hứa nào cũng có thể không về. */
const KILL_TIMEOUT_MS = 5000;

if (!Number.isInteger(ATTEMPT_TIMEOUT_MS) || ATTEMPT_TIMEOUT_MS < 5000) {
  throw new Error(`--timeout phải là số mili-giây nguyên từ 5000 trở lên, nhận ${arg("timeout")}.`);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Dừng trình duyệt cho BẰNG ĐƯỢC, và không bao giờ ném.
 *
 * Ba nấc, mỗi nấc phòng cho nấc trên hụt:
 *   1. `server.kill()` — đường chính thức, đo được 101ms, và gọi lần hai trên một server đã
 *      chết là một phép rỗng (không ném). Nhờ vậy gọi từ nhiều đường ra đều an toàn.
 *   2. Hạn chót cho chính lời hứa ấy — nếu `kill()` cũng treo thì ta không đứng đợi nó.
 *   3. `taskkill /T /F` theo PID: giết CẢ CÂY, vì Chromium đẻ ra một đàn tiến trình con và
 *      giết mỗi tiến trình chính có thể để lại renderer mồ côi.
 *
 * Giết theo PID chứ TUYỆT ĐỐI KHÔNG quét theo tên: trên máy này còn `next dev` của người
 * khác, còn Chrome thật của chủ máy. Một lệnh `taskkill /IM chrome.exe` là giết luôn tab
 * ngân hàng của họ.
 */
async function hardStop(server: Awaited<ReturnType<typeof chromium.launchServer>>): Promise<void> {
  const pid = server.process().pid;
  try {
    await Promise.race([server.kill(), sleep(KILL_TIMEOUT_MS)]);
  } catch {
    // Nuốt có chủ ý: đây là đường dọn dẹp, và nó chạy cả khi mọi thứ khác đã hỏng.
  }
  if (pid !== undefined) {
    if (stillAlive(pid) && !killByPid(pid)) {
      console.log(`⚠ Chromium (pid ${pid}) không chết cả bằng taskkill — giết tay nếu còn thấy.`);
    }
    // Xoá khỏi sổ SAU CÙNG: chết giữa chừng ở trên thì dòng sổ còn nguyên, và `shot:clean`
    // của lượt sau sẽ nhặt nốt. Xoá trước là tự tay vứt mất manh mối duy nhất.
    forget(pid);
  }
}

/** Chụp một lượt. Người gọi lo hạn chót và lo dọn dẹp — hàm này chỉ lo chụp. */
async function shoot(server: Awaited<ReturnType<typeof chromium.launchServer>>): Promise<void> {
  const browser = await chromium.connect(server.wsEndpoint());
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

  // `networkidle` là mốc chờ TỐT NHẤT khi tới được: nó đợi cả ảnh và các lượt fetch sau khi
  // hydrate. Nhưng có trang KHÔNG BAO GIỜ tới được nó — Phòng Chat poll `/api/chat` mỗi 2,5
  // giây, nên dưới máy (nơi Mongo `mongodb+srv://` treo ~50s vì resolver không trả SRV) mạng
  // không có lấy một khoảng 500ms nào lặng. Chờ cứng ở đó là script chết vì hết giờ và không
  // chụp được gì, dù trang đã vẽ xong từ lâu. Nên: hụt thì lùi một nấc rồi chụp tiếp, và NÓI
  // RA đã lùi — phần chờ ảnh `decode()` bên dưới vẫn giữ cho tấm ảnh không bị bấm sớm.
  let res: Awaited<ReturnType<typeof page.goto>>;
  try {
    res = await page.goto(`${origin}${path}`, { waitUntil: "networkidle", timeout: 45_000 });
  } catch {
    console.log("⚠ mạng không lặng (trang có poll?) — lùi về `load` rồi chụp.");
    res = await page.goto(`${origin}${path}`, { waitUntil: "load", timeout: 45_000 });
  }
  console.log(`• ${path} → HTTP ${res?.status()} (đóng vai @${user.username}${roles.length ? ` [${roles.join(", ")}]` : ""})`);

  for (const selector of clicks) {
    await page.click(selector, { timeout: 20_000 });
    console.log(`• đã bấm「${selector}」`);
  }
  if (waitFor) {
    await page.waitForSelector(waitFor, { timeout: 20_000 });
  }
  /**
   * Ảnh trong trang tải xong hẳn rồi mới bấm máy — không thì bài vị/ảnh đại diện ra ô trống.
   *
   * ĐÂY LÀ CHỖ TỪNG TREO VÔ HẠN, và cái bẫy đáng ghi lại: `.catch(() => {})` chỉ bắt lời hứa
   * BỊ TỪ CHỐI, nó không cứu được một lời hứa KHÔNG BAO GIỜ NGÃ NGŨ. Mà `img.decode()` của
   * một ảnh `loading="lazy"` chưa từng vào khung nhìn thì đúng là như vậy — nó nằm đó mãi.
   *
   * Trang Tông Môn có đủ điều kiện: `AdminTabs` vẽ MỌI tab rồi chỉ `hidden` những tab không
   * hoạt động, nên ảnh trong tab đang ẩn không bao giờ được tải. Đo ngày 09/08/2026: lượt
   * chụp `/admin` in ra「đã bấm」rồi đứng im hơn ba phút, không tệp nào được ghi.
   *
   * Nên phép chờ có TRẦN, và trần ấy nằm TRONG trang: hết giờ thì chụp với những gì đã tải
   * được. Một tấm ảnh thiếu vài hình còn hơn không có tấm nào.
   */
  await page.evaluate(async (limitMs) => {
    const pending = [...document.images]
      .filter((image) => !image.complete)
      .map((image) => image.decode().catch(() => {}));
    if (pending.length === 0) return;
    await Promise.race([
      Promise.all(pending),
      new Promise((resolve) => setTimeout(resolve, limitMs)),
    ]);
  }, IMAGE_WAIT_MS);
  await page.waitForTimeout(400);

  await page.screenshot({ path: out, fullPage: flag("full"), clip });
  console.log(`✔ Đã chụp → ${out}`);

  // Lỗi console/mạng NÓI RA chứ không nuốt: một tấm ảnh đẹp che được rất nhiều thứ hỏng.
  if (problems.length > 0) {
    console.log(`⚠ ${problems.length} lỗi trong trang:`);
    for (const p of problems.slice(0, 8)) console.log(`   ${p}`);
  }
}

/**
 * Vòng thử lại. Mỗi lượt dựng một trình duyệt RIÊNG rồi dẹp hẳn nó — không dùng lại cái của
 * lượt trước, vì lượt trước hụt giờ nghĩa là ta không biết nó đang ở trạng thái nào.
 *
 * Ctrl-C cũng đi qua đúng đường dọn ấy: bỏ nó ra thì mỗi lần người dùng sốt ruột bấm huỷ là
 * một Chromium mồ côi nữa nằm lại — chính là cảnh đã phải mở Task Manager để dọn.
 */
let running: Awaited<ReturnType<typeof chromium.launchServer>> | null = null;
let interrupted = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    interrupted = true;
    console.log(`\n⚠ Nhận ${signal} — đang dẹp trình duyệt trước khi thoát.`);
    void (async () => {
      if (running) await hardStop(running);
      process.exit(130);
    })();
  });
}

/**
 * Đặt hạn cho một lời hứa. Không huỷ được nó (JS không có phép ấy) — chỉ thôi đứng đợi, và
 * người gọi chịu trách nhiệm dọn thứ đang treo.
 */
function withDeadline<T>(work: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  return Promise.race([
    work,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${what} hụt hạn ${ms}ms`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

/**
 * Dọn orphan CŨ trước khi mở thêm một cái mới — để một lần treo hôm qua không nằm lại ăn RAM
 * tới hôm nay. Chỉ xét bản ghi cũ hơn mười phút, nên một lượt chụp của phiên khác đang chạy
 * song song không bao giờ bị đụng vào (xem `ORPHAN_AGE_MS`).
 *
 * Hỏng thì KỆ: đây là việc dọn nhà, không phải việc chính. Một cuốn sổ rác hay một endpoint
 * cứng đầu không có quyền chặn người ta chụp một tấm ảnh.
 */
try {
  const swept = await sweepOrphans();
  const total = swept.killed + swept.stale;
  if (total > 0) {
    console.log(`• Dọn ${total} trình duyệt bỏ lại từ lượt trước (${swept.killed} còn sống).`);
  }
} catch (err) {
  console.log(`⚠ Dọn orphan không xong (${err instanceof Error ? err.message : String(err)}) — vẫn chụp tiếp.`);
}

let lastError: unknown = null;
for (let attempt = 1; attempt <= MAX_ATTEMPTS && !interrupted; attempt++) {
  /**
   * Chính phép KHỞI ĐỘNG cũng có hạn, và khe này suýt bị bỏ sót: nếu `launchServer()` treo
   * thì chưa có PID nào để mà giết, tức không một hàng rào nào phía dưới với tới được. Hụt
   * hạn ở đây thì đành chịu mất tiến trình con (nếu có), nhưng script CHẾT thay vì đứng im —
   * và đứng im chính là cái phải dẹp.
   */
  let server: Awaited<ReturnType<typeof chromium.launchServer>>;
  try {
    server = await withDeadline(chromium.launchServer({ headless: true }), ATTEMPT_TIMEOUT_MS, "khởi động trình duyệt");
    const pid = server.process().pid;
    // Ghi sổ NGAY, trước cả lượt chụp: cuốn sổ chỉ có giá trị cho những lần script không về
    // được tới đường dọn của chính nó (treo, Ctrl-C, máy sập). Ghi muộn là đúng những lần ấy
    // không có gì trong sổ.
    if (pid !== undefined) remember({ pid, wsEndpoint: server.wsEndpoint(), startedAt: Date.now() });
  } catch (err) {
    lastError = err;
    console.log(`✗ Lượt ${attempt}/${MAX_ATTEMPTS}: ${err instanceof Error ? err.message : String(err)}`);
    if (attempt < MAX_ATTEMPTS) console.log("• Thử lại với một trình duyệt mới…");
    continue;
  }
  running = server;
  const startedAt = Date.now();
  try {
    /**
     * `Promise.race` chứ không phải một cách nào tinh vi hơn: lượt chụp hụt giờ thì lời hứa
     * của nó vẫn còn treo đâu đó, ta KHÔNG huỷ được nó. Thứ cứu ta là `hardStop` ngay dưới —
     * giết trình duyệt là mọi thao tác đang chờ nó đều ngã, và lời hứa mồ côi tan theo.
     */
    await withDeadline(shoot(server), ATTEMPT_TIMEOUT_MS, "lượt chụp");

    await hardStop(server);
    running = null;
    // Thoát TƯỜNG MINH: `connect()` để lại socket, và một tiến trình node nằm lại sau khi đã
    // in「Đã chụp」là đúng thứ phiền toái mà bản này sinh ra để dẹp.
    process.exit(0);
  } catch (err) {
    lastError = err;
    const spent = Date.now() - startedAt;
    console.log(`✗ Lượt ${attempt}/${MAX_ATTEMPTS} hỏng sau ${spent}ms: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    await hardStop(server);
    running = null;
  }

  if (attempt < MAX_ATTEMPTS) console.log("• Thử lại với một trình duyệt mới…");
}

console.error(`✗ Không chụp được sau ${MAX_ATTEMPTS} lượt. Lỗi cuối: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
process.exit(1);
