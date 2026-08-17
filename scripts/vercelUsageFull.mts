#!/usr/bin/env node
/**
 * BẢNG USAGE của một trạm — dựng trang bằng trình duyệt thật rồi đọc, CHẠY TẠI MÁY NGƯỜI VẬN HÀNH.
 *
 * Từ 13/08/2026 lượt cào chỉ giữ TÁM CỘT tông chủ muốn nhìn (`WANTED_TITLES` trong `usageMeters.mts`),
 * không còn đẩy trọn ~54 meter của trang. Trang vẫn phải dựng đủ như cũ — mấy cột Fluid nằm cuối
 * và chỉ render khi cuộn tới — chỉ có thứ ĐI RA khỏi đây là hẹp lại.
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
import { nearMisses, parseUsageText, selectWanted, WANTED_TITLES, type Selection } from "./usageMeters.mts";
import { type Meter, pushUsageReport } from "./usagePush.mts";
import { daysUntilExpiry, readCookieFile, reviewUsageLanding } from "./usageStations.mts";

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

// Phép soi tệp cookie dùng CHUNG với `usage:cookie` (công cụ đẩy cookie lên secret) — một luật,
// một chỗ. Trước 13/08/2026 mỗi bên giữ một bản, và bản nào nới lỏng dần thì bên kia không biết.
let source: string;
try {
  source = cookieEnv ? (process.env[cookieEnv] ?? "") : readFileSync(cookieFile!, "utf8");
  if (!source) throw new Error(`biến ${cookieEnv} rỗng hoặc chưa đặt`);
} catch (err) {
  console.error(`Không đọc được cookie: ${err instanceof Error ? err.message : "lỗi lạ"}`);
  process.exit(1);
}
const doc = readCookieFile(source);
if (!doc.ok) {
  console.error(`Cookie không dùng được: ${doc.message}`);
  process.exit(1);
}
const cookies = doc.cookies;

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
 * TÁM CỘT — vừa là định nghĩa của「đã đủ」, vừa là TẤT CẢ những gì được đẩy lên sổ.
 *
 * Chỉ chờ「thôi mọc」thì vẫn hên xui: đo được 56/61/49/40 meter qua bốn lượt, vì phần đuôi
 * (Queue, Sandbox, AI Gateway — toàn số 0) render lúc có lúc không và nhịp đếm bắt được lúc nó
 * đang nghỉ. Nay phần đuôi ấy không còn được đếm nữa: nhịp「thôi mọc」chỉ nhìn tám cột này, nên
 * lượt cào vừa nhanh hơn vừa hết chỗ cho cái hên xui đó.
 *
 * Danh sách và lý do chọn nằm ở `usageMeters.mts` — cùng chỗ với phép cắt chữ và phép chọn cột,
 * để chúng kiểm được mà không cần Chromium.
 */
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
   * DỪNG TRƯỚC KHI CÀO nếu ta không còn đứng trên bảng Usage.
   *
   * Phép gác `>= 400` ngay trên KHÔNG bắt được phiên chết: Vercel trả 307 sang
   * `/auth-redirect/…`, Playwright đi theo, và trang đăng nhập là một HTTP 200 hoàn toàn hợp lệ.
   * Thiếu chỗ này thì `collect()` cào trang đăng nhập, thiếu cả tám cột, tải lại, thiếu tiếp —
   * 180 giây mỗi trạm để rồi in ra một câu đoán mò. Đo 17/08/2026: năm trạm × như vậy = 1007s và
   * 1088s, trong khi một lượt khoẻ chỉ tốn ~100s.
   *
   * Nói CẢ hạn cookie trong cùng một dòng: nó biến「chắc là cookie?」thành một con số đọc là
   * biết, và `daysUntilExpiry` vốn đã có sẵn — chỉ là script này chưa từng hỏi tới.
   */
  const landing = reviewUsageLanding(page.url(), team);
  if (landing.kind !== "usage") {
    const days = daysUntilExpiry(cookies);
    const hanCookie =
      days === null
        ? "tệp cookie không khai hạn"
        : days < 0
          ? `cookie đã QUÁ HẠN ${-days} ngày`
          : `cookie còn ${days} ngày`;
    const oCookie = cookieEnv ? `secret ${cookieEnv}` : `tệp ${cookieFile}`;
    console.error(
      landing.kind === "signedOut"
        ? `Phiên Vercel của đội「${team}」đã hết: trang đá về ${landing.url}\n` +
          `  ${hanCookie} — xuất lại cookie rồi cập nhật ${oCookie}.\n` +
          "  (Cookie hết hiệu lực KHÔNG trả mã lỗi, nó trả 307 sang cửa đăng nhập.)"
        : `Không dừng lại ở bảng Usage của đội「${team}」mà ở ${landing.url}\n` +
          `  ${hanCookie}, và đích đến KHÔNG phải cửa đăng nhập — nhiều khả năng Vercel đã dời\n` +
          "  trang Usage. Sửa đường dẫn trong scripts/vercelUsageFull.mts, đừng làm mới cookie.",
    );
    process.exit(1);
  }

  /** Một lượt render đã đọc: tám cột đã chọn, kèm TRỌN bảng thô sinh ra chúng. */
  type Attempt = { selection: Selection; rows: Meter[] };

  /**
   * Một lượt chờ-cho-đủ. Trả về lượt đọc tốt nhất trong cửa sổ (có thể còn thiếu — người gọi phán xử).
   *
   * Tách thành hàm để TẢI LẠI RỒI THỬ LẦN NỮA: đo 4 lượt thì 1 lượt trang khựng giữa chừng và
   * hết giờ. Một lần render hụt không đáng bắt người ta gõ lại lệnh.
   *
   * Trả về CẢ bảng thô đi kèm, không để nó ở một biến ngoài: dòng chẩn đoán lúc thiếu cột phải
   * nói về đúng lượt đọc đang bị phán xử. Hai thứ ấy rời nhau ra là có ngày in tên「đã thấy」của
   * một lượt render khác.
   */
  const collect = async (): Promise<Attempt> => {
    const deadline = Date.now() + SETTLE_TIMEOUT_MS;
    let best: Attempt = { selection: { picked: [], missing: [...WANTED_TITLES] }, rows: [] };
    let stable = 0;

    while (Date.now() < deadline) {
      // Cuộn xuống đáy TRƯỚC mỗi nhịp đếm: thẻ chỉ dựng khi lọt vào tầm nhìn, nên đứng yên ở
      // đầu trang thì đếm bao lâu cũng chỉ ra bấy nhiêu.
      await page.evaluate("window.scrollTo(0, document.body.scrollHeight)");
      await page.waitForTimeout(SETTLE_POLL_MS);

      const rows = parseUsageText(await page.evaluate("document.body.innerText"));
      const selection = selectWanted(rows);

      // ĐẾM THEO TÁM CỘT, không theo tổng số meter. Bản trước đếm tổng, nên phần đuôi
      // (Queue/Sandbox/AI Gateway) mọc thêm một dòng là nhịp「đứng yên」bị đặt lại từ đầu — chờ
      // thêm một vòng vì một con số 0 mà không ai đọc.
      stable = selection.picked.length > best.selection.picked.length ? 0 : stable + 1;
      if (selection.picked.length >= best.selection.picked.length) best = { selection, rows };

      // Hai điều kiện, và điều kiện ĐỦ CỘT đứng trước: thôi mọc mà còn thiếu cột thì chỉ là
      // trang đang nghỉ giữa hai đợt render, không phải đã xong.
      if (best.selection.missing.length === 0 && stable >= SETTLE_STABLE_POLLS) break;
    }
    return best;
  };

  let attempt = await collect();
  if (attempt.selection.missing.length > 0) {
    console.error(`  … lượt đầu còn thiếu ${attempt.selection.missing.length} cột, tải lại thử lần nữa…`);
    await page.reload({ waitUntil: "domcontentloaded" });
    const second = await collect();
    // GIỮ LƯỢT TỐT HƠN, không cắm đầu lấy lượt sau: một lượt tải lại rơi vào đúng phút Vercel
    // chậm có thể đọc ra ÍT hơn lượt đầu, và khi ấy câu báo lỗi sẽ kể tên những cột thật ra đã
    // thấy rồi — đẩy người đọc đi tìm một cái hỏng không tồn tại.
    if (second.selection.missing.length <= attempt.selection.missing.length) attempt = second;
  }

  const { selection, rows: seenAll } = attempt;
  if (selection.missing.length > 0) {
    // KHAI RA TÊN THẬT ĐÃ THẤY, đừng bắt người ta mở Chromium lên soi tay. Ngày Vercel đổi chữ
    // trên một thẻ, đây là dòng biến một lượt đỏ mù thành một lượt sửa dài đúng một dòng.
    const near = nearMisses(seenAll, selection.missing);
    // KHAI LUÔN TRANG ĐANG ĐỨNG. Phép gác trước lúc cào chỉ bắt được cú chuyển hướng của MÁY
    // CHỦ; một lượt đá về cửa đăng nhập bằng JS xảy ra SAU `domcontentloaded` thì lúc ấy URL vẫn
    // còn đúng, và đường duy nhất còn lại để nhận ra nó là dòng này.
    const ketThuc = reviewUsageLanding(page.url(), team);
    console.error(
      `Hết ${SETTLE_TIMEOUT_MS / 1000}s mà vẫn thiếu ${selection.missing.length} cột: ${selection.missing.join(", ")}.\n` +
        "Không in bảng thiếu — một bảng thiếu trông y hệt một bảng đủ.\n" +
        `Dừng ở: ${page.url()}${ketThuc.kind === "signedOut" ? "  ← CỬA ĐĂNG NHẬP, phiên đã hết" : ""}\n` +
        (near.length > 0
          ? `Tên gần giống ĐÃ THẤY trên trang: ${near.join(" · ")}\n` +
            "→ Vercel đổi chữ? Chép tên mới vào WANTED_TITLES (scripts/usageMeters.mts).\n"
          : `Không thấy tên nào gần giống trong ${seenAll.length} meter đọc được — nhiều khả năng` +
            " trang chưa render xong, hoặc cookie chỉ mở được một phần trang.\n"),
    );
    process.exit(1);
  }

  const meters = selection.picked;

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
    console.log(`\n  Mức dùng — team ${team}  ·  ${meters.length} cột có hạn mức\n`);
    for (const m of meters) {
      // 38: đủ cho tên dài nhất trong `WANTED_TITLES` ("Image Optimization - Transformations",
      // 36 ký tự) cộng một khoảng thở. Hụt một ký tự là cả cột số lệch hàng.
      console.log(`    ${m.title.padEnd(38)} ${m.used.padStart(14)}${m.limit ? ` / ${m.limit}` : ""}`);
    }
    console.log("");
  }
} finally {
  await browser.close();
}
