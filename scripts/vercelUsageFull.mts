#!/usr/bin/env node
/**
 * BẢNG USAGE ĐẦY ĐỦ của một trạm — dựng trang bằng trình duyệt thật rồi đọc, CHẠY TẠI MÁY
 * NGƯỜI VẬN HÀNH.
 *
 *   npm run usage:full -- --cookie "C:/…/cookie_vercel.txt" --team jarvis8796
 *   npm run usage:full -- --cookie … --team … --json     (in JSON để máy khác đọc)
 *
 * ── VÌ SAO PHẢI DỰNG TRÌNH DUYỆT, KHÔNG `fetch` CHO GỌN ──────────────────────────────────
 *
 * Bản đầu của tệp này `fetch` trang rồi bóc payload RSC. Nó CHẠY ĐƯỢC — một lần. Đo lại 8 lượt
 * liên tiếp trên cùng một request (11/08/2026):
 *
 *     49, 15, 7, 7, 7, 7, 7, 10 meter        `Fluid Active CPU` có mặt 1/8 lượt
 *
 * Trang stream và đẩy phần lớn thẻ meter sang render phía client, nên HTML server trả về hầu
 * như luôn THIẾU — và thiếu đúng mấy cột Fluid, thứ duy nhất đáng đọc. Một phép bóc đúng 1/8
 * lượt thì tệ hơn không có: nó im lặng trả về một bảng ngắn trông vẫn như thật.
 *
 * Trình duyệt thật thì chờ được client render xong, nên lấy đủ. Cái giá là phải mở Chromium —
 * và đó CHÍNH LÀ lý do thứ hai (sau chuyện credential) khiến việc này không thể là một tính
 * năng của web: function trên Vercel không nuôi nổi một phiên Chromium.
 *
 * ── VÌ SAO ĐỌC CHỮ ĐÃ RENDER, KHÔNG ĐỌC DOM/RSC ─────────────────────────────────────────
 *
 * Đọc `innerText` là đọc đúng thứ con người đọc. Nó không phụ thuộc tên class hay hình dạng
 * payload — hai thứ Vercel đổi lúc nào cũng được mà không báo ai. Hình dạng chữ thì ổn định vì
 * chính người dùng phải đọc được nó:
 *
 *     Fast Data Transfer          ← tên
 *     1,29 GB                     ← đã dùng
 *     /                           ← có hạn thì mới có dòng này
 *     100 GB                      ← hạn
 *     1 TB                        ← nấc kế (bỏ qua)
 *
 * ── CREDENTIAL ───────────────────────────────────────────────────────────────────────────
 *
 * Cookie phiên là chìa khoá TOÀN TÀI KHOẢN — cùng quyền `vercel env pull`, tức đọc được
 * `ENCRYPTION_KEY`, thứ mở phong bì cookie game của MỌI đạo hữu. Nó ở lại máy người vận hành,
 * đi qua đúng một tham số dòng lệnh, và không bao giờ được ghi vào database. Xuất tệp cookie
 * lúc cần, xoá ngay sau khi dùng.
 */
import { readFileSync } from "node:fs";
import { chromium } from "playwright-core";
import { type Meter, pushUsageReport } from "./usagePush.mts";

const arg = (name: string): string | undefined => {
  const at = process.argv.indexOf(`--${name}`);
  return at > -1 ? process.argv[at + 1] : undefined;
};

const cookieFile = arg("cookie");
/**
 * Trên CI thì cookie ĐI BẰNG BIẾN MÔI TRƯỜNG, không bằng tệp: một tệp credential nằm trên đĩa
 * của runner là một tệp có thể bị một bước sau vô tình `cat` ra log. Biến thì GitHub tự che.
 */
const cookieEnv = arg("cookie-env");
const team = arg("team");
if ((!cookieFile && !cookieEnv) || !team) {
  console.error(
    'Cách dùng: npm run usage:full -- --cookie "<đường/dẫn/cookie.json>" --team <slug>\n' +
      "          hoặc --cookie-env <TÊN_BIẾN> khi chạy trên CI\n" +
      "  đẩy lên web:  --push <https://trạm> --site <mã trạm>   (cần CRON_SECRET trong env)",
  );
  process.exit(1);
}

type RawCookie = { name: string; value: string; domain?: string; path?: string };
let raw: { cookies?: RawCookie[] };
try {
  const source = cookieEnv ? process.env[cookieEnv] : readFileSync(cookieFile!, "utf8");
  if (!source) throw new Error(`biến ${cookieEnv} rỗng hoặc chưa đặt`);
  raw = JSON.parse(source) as { cookies?: RawCookie[] };
} catch (err) {
  console.error(`Không đọc được cookie: ${err instanceof Error ? err.message : "lỗi lạ"}`);
  process.exit(1);
}
const cookies = raw.cookies ?? [];
if (!cookies.some((c) => c.name === "authorization")) {
  console.error("Tệp cookie thiếu `authorization` — xuất lại từ trình duyệt ĐANG đăng nhập Vercel.");
  process.exit(1);
}

/**
 * CHỜ TỚI KHI THÔI MỌC, không chờ một cái mốc.
 *
 * Bản trước chờ chuỗi「Fluid Active CPU」xuất hiện rồi đọc ngay. Sai hai lần một lúc: chuỗi ấy
 * có sẵn trong THANH ĐIỀU HƯỚNG bên trái nên phép chờ thoả mãn tức thì, và trang chỉ dựng thẻ
 * khi cuộn tới nên nửa dưới còn trống. Đo được: 11, 57, 32, 46 meter qua bốn lượt liên tiếp.
 *
 * Nên: cuộn hết trang, rồi đếm meter mỗi nhịp cho tới khi con số đứng yên đủ lâu. Đó là mốc
 * duy nhất không nói dối — nó đo chính thứ ta cần chứ không đo một chuỗi tình cờ.
 */
const SETTLE_POLL_MS = 600;
/** Bấy nhiêu nhịp liên tiếp không mọc thêm thì coi là xong. */
const SETTLE_STABLE_POLLS = 4;
const SETTLE_TIMEOUT_MS = 90_000;

/**
 * MƯỜI CỘT BẮT BUỘC — định nghĩa của「đã đủ」.
 *
 * Chỉ chờ「thôi mọc」thì vẫn hên xui: đo được 56/61/49/40 meter qua bốn lượt, vì phần đuôi
 * (Queue, Sandbox, AI Gateway — toàn số 0) render lúc có lúc không và nhịp đếm bắt được lúc nó
 * đang nghỉ. Cột đuôi thiếu thì không ai mất gì; thiếu một trong mười cột dưới đây thì bảng
 * nói dối về đúng thứ người ta mở nó ra để xem.
 *
 * Đây là toàn bộ meter có HẠN MỨC trên gói Hobby — tức mọi chỗ có thể chạm trần.
 */
const REQUIRED_TITLES = [
  "Fast Data Transfer",
  "Fast Origin Transfer",
  "Edge Requests",
  "Edge Request CPU Duration",
  "ISR Reads",
  "ISR Writes",
  "Function Invocations",
  "Function Duration",
  "Fluid Provisioned Memory",
  "Fluid Active CPU",
];

/**
 * Một dòng số đo: `1,29 GB`, `303K`, `3h 44m`, `58s`, `0 B`, `217.4 GB-Hrs`, `0`.
 * Phải khớp CẢ dòng — `Fast Data Transfer` không được lọt vào đây.
 */
const VALUE_LINE =
  /^(?:[\d.,]+\s*(?:B|KB|MB|GB|TB|GB-Hrs|GB-hrs)|[\d.,]+[KMB]?|(?:\d+h\s*)?(?:\d+m\s*)?(?:\d+s)?)$/;

const isValue = (line: string): boolean => line !== "" && VALUE_LINE.test(line) && /\d/.test(line);

/**
 * Cắt chữ đã render thành bảng meter.
 *
 * Đi từng dòng, giữ một cái tên đang chờ. Gặp dòng-số đầu tiên sau tên thì đó là「đã dùng」;
 * gặp `/` thì dòng-số kế là「hạn」; mọi dòng-số sau đó là nấc kế của gói trả tiền — bỏ.
 */
export function parseUsageText(text: string): Meter[] {
  const lines = text.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
  const meters: Meter[] = [];
  let title: string | null = null;
  let used: string | null = null;
  let limit: string | null = null;
  let expectLimit = false;

  const flush = () => {
    if (title && used) meters.push({ title, used, limit });
    title = null;
    used = null;
    limit = null;
    expectLimit = false;
  };

  for (const line of lines) {
    if (line === "/") {
      expectLimit = true;
      continue;
    }
    if (isValue(line)) {
      if (!title) continue; // số lạc lõng, không thuộc meter nào
      if (!used) used = line;
      else if (expectLimit && !limit) {
        limit = line;
        expectLimit = false;
      }
      continue; // nấc kế: bỏ
    }
    // Dòng chữ = tên meter mới. Chốt cái đang dở trước đã.
    flush();
    title = line;
  }
  flush();
  return meters;
}

const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36",
    viewport: { width: 1440, height: 1200 },
  });
  await context.addCookies(
    cookies.map((c) => ({
      name: c.name,
      value: c.value,
      domain: c.domain ?? ".vercel.com",
      path: c.path ?? "/",
    })),
  );

  const page = await context.newPage();
  const res = await page.goto(`https://vercel.com/${team}/~/usage`, { waitUntil: "domcontentloaded" });
  if (res && res.status() >= 400) {
    console.error(`Vercel trả HTTP ${res.status()} — cookie hết hiệu lực? Xuất lại tệp mới.`);
    process.exit(1);
  }

  /**
   * Một lượt chờ-cho-đủ. Trả về bảng đọc được (có thể còn thiếu — người gọi phán xử).
   *
   * Tách thành hàm để TẢI LẠI RỒI THỬ LẦN NỮA: đo 4 lượt thì 1 lượt trang khựng giữa chừng và
   * hết giờ. Một lần render hụt không đáng bắt người ta gõ lại lệnh.
   */
  const collect = async (): Promise<Meter[]> => {
  const deadline = Date.now() + SETTLE_TIMEOUT_MS;
  let meters: Meter[] = [];
  let stable = 0;

  while (Date.now() < deadline) {
    // Cuộn xuống đáy TRƯỚC mỗi nhịp đếm: thẻ chỉ dựng khi lọt vào tầm nhìn, nên đứng yên ở
    // đầu trang thì đếm bao lâu cũng chỉ ra bấy nhiêu.
    await page.evaluate("window.scrollTo(0, document.body.scrollHeight)");
    await page.waitForTimeout(SETTLE_POLL_MS);

    const next = parseUsageText(await page.evaluate("document.body.innerText"));
    stable = next.length > meters.length ? 0 : stable + 1;
    if (next.length >= meters.length) meters = next;

    // Hai điều kiện, và điều kiện ĐỦ CỘT đứng trước: thôi mọc mà còn thiếu cột bắt buộc thì
    // chỉ là trang đang nghỉ giữa hai đợt render, không phải đã xong.
    const seen = new Set(meters.map((m) => m.title));
    if (REQUIRED_TITLES.every((t) => seen.has(t)) && stable >= SETTLE_STABLE_POLLS) break;
  }
    return meters;
  };

  const missingOf = (rows: Meter[]): string[] => {
    const seen = new Set(rows.map((m) => m.title));
    return REQUIRED_TITLES.filter((t) => !seen.has(t));
  };

  let meters = await collect();
  if (missingOf(meters).length > 0) {
    console.error(`  … lượt đầu còn thiếu ${missingOf(meters).length} cột, tải lại thử lần nữa…`);
    await page.reload({ waitUntil: "domcontentloaded" });
    meters = await collect();
  }

  const missing = missingOf(meters);
  if (missing.length > 0) {
    console.error(
      `Hết ${SETTLE_TIMEOUT_MS / 1000}s mà vẫn thiếu ${missing.length} cột bắt buộc: ${missing.join(", ")}.\n` +
        "Không in bảng thiếu — một bảng thiếu trông y hệt một bảng đủ.",
    );
    process.exit(1);
  }
  if (meters.length === 0) {
    console.error("Render xong nhưng không cắt được meter nào — xem lại parseUsageText.");
    process.exit(1);
  }

  const push = arg("push");
  const site = arg("site");
  if (push && site) {
    const secret = process.env.CRON_SECRET;
    if (!secret) {
      console.error("Thiếu CRON_SECRET trong env — đó là chìa mở /api/usage-report.");
      process.exit(1);
    }
    const sent = await pushUsageReport({
      origin: push,
      secret,
      siteId: site,
      readAt: new Date().toISOString(),
      meters,
    });
    // Đi qua trạm nghỉ là chuyện BÌNH THƯỜNG (WEB_URL trỏ trạm cũ sau một lượt chuyển trạm),
    // nhưng phải nói ra: đó là manh mối duy nhất cho biết địa chỉ trong tay đã lỗi thời.
    if (sent.hops.length > 1) {
      console.log(`  ↪ trạm ở ${push} đã nghỉ, đi theo chuyển hướng: ${sent.hops.join(" → ")}`);
    }
    if (!sent.ok) {
      console.error(
        `Đẩy lên hỏng: ${sent.status != null ? `HTTP ${sent.status} — ` : ""}${sent.detail.slice(0, 200)}`,
      );
      process.exit(1);
    }
    console.log(`  ✔ đã đẩy ${meters.length} meter của「${site}」lên ${sent.hops.at(-1)}`);
  } else if (push || site) {
    console.error("`--push` và `--site` phải đi cùng nhau.");
    process.exit(1);
  }

  if (process.argv.includes("--json")) {
    console.log(JSON.stringify({ team, readAt: new Date().toISOString(), meters }, null, 2));
  } else {
    console.log(`\n  Mức dùng đầy đủ — team ${team}  ·  ${meters.length} meter\n`);
    for (const m of meters) {
      console.log(`    ${m.title.padEnd(34)} ${m.used.padStart(14)}${m.limit ? ` / ${m.limit}` : ""}`);
    }
    console.log("");
  }
} finally {
  await browser.close();
}
