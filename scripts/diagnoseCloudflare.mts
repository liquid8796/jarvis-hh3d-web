#!/usr/bin/env node
/**
 * CHẨN ĐOÁN CỬA CLOUDFLARE — chạy trên MÁY ĐANG BỊ CHẶN, hỏi thẳng trang game.
 *
 *   npm run diagnose:cf
 *   npm run diagnose:cf -- --url https://hoathinh3d.one --headed
 *   npm run diagnose:cf -- --walk        đi hết đường của một vòng thật trong MỘT phiên
 *
 * Đây là CÔNG CỤ, không phải lưới kiểm: nó cần mạng và cần trang game thật, nên không bao giờ
 * được gọi từ `npm run smoke`. Nó sinh ra vì suốt năm lượt vá (1.3.14 → 1.3.21) câu hỏi quyết
 * định luôn là「Cloudflare chặn vì IP hay vì trình duyệt?」mà không ai trả lời được — máy phát
 * triển thì không bị chặn, còn khôi lỗi bị chặn thì không ai soi được vào trong.
 *
 * ── BA BIẾN THỂ, và vì sao đúng ba ────────────────────────────────────────────────────────
 *
 *   shell  `headless: true` trần — ĐÚNG thứ runCycle đang mở. Playwright 1.62 vẫn mặc định
 *          chạy binary `chrome-headless-shell`: một bản dựng RIÊNG, thiếu nhiều thứ của Chrome
 *          thật (không extension, không PDF viewer, khác hẳn ở nhiều API), nên nó là dấu vân
 *          tay bot rõ nhất mà ta đang tự phát ra.
 *   new    `channel: "chromium"` — vẫn headless nhưng chạy CHÍNH Chromium đầy đủ ở chế độ
 *          headless mới (`--headless=new`). Cùng binary với lượt chạy có giao diện.
 *   headed `headless: false` — đối chứng trần trụi: nếu ngay cả cái này cũng bị chặn thì
 *          trình duyệt không phải biến số, và câu trả lời nằm ở IP.
 *
 * Mỗi biến thể đều đi qua `wearRealBrowserIdentity` y như lượt chạy thật, nên khác biệt đo
 * được là khác biệt của BINARY, không phải của phép đè danh tính.
 *
 * KHÔNG cần cookie: màn kiểm tra dựng TRƯỚC cửa đăng nhập, nên chẩn đoán này không đụng tới
 * tài khoản của ai.
 */
import { chromium, type Browser, type BrowserContext } from "playwright-core";
import { DEFAULT_GAME_BASE_URL } from "../src/lib/quest-engine/cookies.mjs";
import { readinessProbe } from "../src/lib/quest-engine/boardScripts.mjs";
import { launchProfile, wearRealBrowserIdentity, TURNSTILE_IFRAME_SELECTOR } from "../src/lib/quest-engine/runCycle.mjs";

const argv = process.argv.slice(2);
const arg = (name: string): string | undefined => {
  const at = argv.indexOf(`--${name}`);
  const v = argv[at + 1];
  return at > -1 && v && !v.startsWith("--") ? v : undefined;
};
const BASE = arg("url") ?? DEFAULT_GAME_BASE_URL;
/** Chờ màn kiểm tra tự qua bao lâu trước khi chốt kết luận — bằng đúng nhịp `ensureReady` dùng. */
const SETTLE_MS = Number(arg("settle") ?? 20_000);

type Variant = { name: string; note: string; launch: () => Promise<Browser> };

const fingerprint = launchProfile(true);

const VARIANTS: Variant[] = [
  {
    name: "shell",
    note: "headless: true trần — ĐÚNG thứ khôi lỗi đang chạy (chrome-headless-shell)",
    launch: () =>
      chromium.launch({
        headless: true,
        args: fingerprint.args,
        ignoreDefaultArgs: fingerprint.ignoreDefaultArgs,
      }),
  },
  {
    name: "new",
    note: 'channel: "chromium" — Chromium ĐẦY ĐỦ, chế độ headless mới',
    launch: () =>
      chromium.launch({
        headless: true,
        channel: "chromium",
        args: fingerprint.args,
        ignoreDefaultArgs: fingerprint.ignoreDefaultArgs,
      }),
  },
  {
    name: "headed",
    note: "headless: false — đối chứng, trình duyệt hiện lên thật",
    launch: () =>
      chromium.launch({
        headless: false,
        args: fingerprint.args,
        ignoreDefaultArgs: fingerprint.ignoreDefaultArgs,
      }),
  },
];

async function probeVariant(v: Variant) {
  let browser: Browser | null = null;
  let context: BrowserContext | null = null;
  try {
    browser = await v.launch();
    context = await browser.newContext({
      userAgent: fingerprint.userAgent,
      locale: fingerprint.locale,
      timezoneId: fingerprint.timezoneId,
      viewport: fingerprint.viewport,
    });
    const page = await context.newPage();
    const identity = await wearRealBrowserIdentity(context, page);

    await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 45_000 });

    // Chờ y như ensureReady: màn managed đôi khi tự qua sau vài giây.
    const deadline = Date.now() + SETTLE_MS;
    let probe = (await page.evaluate(readinessProbe)) as { challenge?: boolean; loggedIn?: boolean | null } | null;
    while (Date.now() < deadline && probe?.challenge === true) {
      await new Promise((r) => setTimeout(r, 2_000));
      probe = (await page.evaluate(readinessProbe)) as { challenge?: boolean; loggedIn?: boolean | null } | null;
    }

    const title = await page.title().catch(() => "");
    // Có ô để bấm không — đúng câu hỏi mà `attemptTurnstileClick` hỏi ngoài sản xuất.
    const box = await page.$(TURNSTILE_IFRAME_SELECTOR).then((h) => (h ? h.boundingBox() : null)).catch(() => null);
    const ua = (await page.evaluate(() => navigator.userAgent).catch(() => "")) as string;
    const brands = (await page
      .evaluate(() => {
        const d = (navigator as unknown as { userAgentData?: { brands?: { brand: string; version: string }[] } }).userAgentData;
        return d?.brands ? d.brands.map((b) => `${b.brand}/${b.version}`).join(", ") : "(không có userAgentData)";
      })
      .catch(() => "")) as string;

    return {
      challenge: probe?.challenge === true,
      title,
      hasBox: box != null && box.width > 0,
      boxNote: box ? `${Math.round(box.width)}×${Math.round(box.height)}` : "không có iframe Turnstile",
      identity: identity.ok ? identity.detail : `KHÔNG đè được: ${identity.detail}`,
      ua,
      brands,
    };
  } finally {
    await context?.close().catch(() => {});
    await browser?.close().catch(() => {});
  }
}

/**
 * ĐƯỜNG ĐI CỦA MỘT VÒNG THẬT — những trang khôi lỗi ghé, theo đúng thứ tự.
 *
 * Vì sao cần: phép đo MỘT trang cho kết quả sạch từ cả IP trung tâm dữ liệu (đo 20/08/2026),
 * trong khi khôi lỗi vẫn bị chặn GIỮA VÒNG. Khác biệt duy nhất còn lại là chuỗi ghé nhiều
 * trang liên tiếp trong CÙNG một phiên — thứ một lượt `goto` đơn lẻ không bao giờ tái hiện.
 */
const WALK_PATHS = [
  "/",
  "/nhiem-vu-hang-ngay",
  "/hoang-vuc",
  "/tien-duyen",
  "/luyen-dan-duong",
  "/khoang-mach",
  "/nhiem-vu-hang-ngay",
  "/hoang-vuc",
];

/**
 * Đi hết đường ấy trong MỘT context, dừng ngay ở trang đầu tiên dựng màn kiểm tra.
 *
 * Không cookie: nếu chuỗi ghé đủ để kích màn kiểm tra thì nó kích cả với khách vãng lai, và
 * kết luận ấy không cần chạm tới tài khoản của ai. Ngược lại, sạch trơn ở đây nghĩa là biến
 * số nằm ở PHIÊN ĐĂNG NHẬP — cũng là một câu trả lời, và là câu trả lời khác hẳn.
 */
async function walk(v: Variant) {
  const browser = await v.launch();
  let context: BrowserContext | null = null;
  try {
    context = await browser.newContext({
      userAgent: fingerprint.userAgent,
      locale: fingerprint.locale,
      timezoneId: fingerprint.timezoneId,
      viewport: fingerprint.viewport,
    });
    const page = await context.newPage();
    await wearRealBrowserIdentity(context, page, {
      info: () => {},
      warning: () => {},
      debug: () => {},
    });

    for (let i = 0; i < WALK_PATHS.length; i++) {
      const path = WALK_PATHS[i];
      const url = new URL(path, BASE).toString();
      let navError = null;
      try {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
      } catch (err) {
        navError = err instanceof Error ? err.message.split("\n")[0] : String(err);
      }
      const probe = navError
        ? null
        : ((await page.evaluate(readinessProbe)) as { challenge?: boolean } | null);
      const mark = navError ? "ĐỨT" : probe?.challenge === true ? "CHẶN" : "ok";
      console.log(`   ${String(i + 1).padStart(2)}. ${path.padEnd(22)} ${mark}${navError ? ` — ${navError}` : ""}`);
      if (mark !== "ok") return { blockedAt: path, index: i + 1, navError };
      // Nhịp giữa hai trang: xấp xỉ humanDelay của session thật, để phép đo không nhanh hơn
      // đời thật (nhanh hơn thì nó đo một thứ khác).
      await new Promise((r) => setTimeout(r, 900));
    }
    return { blockedAt: null, index: 0, navError: null };
  } finally {
    if (context) await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

async function main() {
  if (argv.includes("--walk")) {
    console.log(`Đi hết đường của một vòng thật trên ${BASE}, trong MỘT phiên\n`);
    for (const v of VARIANTS) {
      if (v.name === "headed") continue; // VM không có màn hình — đã đo được là luôn đứt
      console.log(`── ${v.name} — ${v.note}`);
      try {
        const r = await walk(v);
        console.log(
          r.blockedAt == null
            ? `   → đi hết ${WALK_PATHS.length} trang, KHÔNG bị chặn lần nào.\n`
            : `   → dừng ở trang thứ ${r.index} (${r.blockedAt}).\n`,
        );
      } catch (err) {
        console.log(`   ĐỨT/HỎNG: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}\n`);
      }
    }
    return;
  }
  console.log(`Hỏi thẳng ${BASE} — chờ mỗi biến thể tối đa ${Math.round(SETTLE_MS / 1000)}s\n`);
  const rows: { name: string; challenge: boolean; hasBox: boolean; error?: string }[] = [];

  for (const v of VARIANTS) {
    process.stdout.write(`── ${v.name.padEnd(7)} ${v.note}\n`);
    try {
      const r = await probeVariant(v);
      rows.push({ name: v.name, challenge: r.challenge, hasBox: r.hasBox });
      console.log(`   màn kiểm tra : ${r.challenge ? "CÓ — bị chặn" : "KHÔNG — vào được"}`);
      console.log(`   tiêu đề      : ${r.title || "(rỗng)"}`);
      console.log(`   ô để bấm     : ${r.hasBox ? `CÓ (${r.boxNote})` : r.boxNote}`);
      console.log(`   danh tính    : ${r.identity}`);
      console.log(`   client hints : ${r.brands}`);
      console.log(`   user-agent   : ${r.ua.slice(0, 100)}\n`);
    } catch (err) {
      const msg = err instanceof Error ? err.message.split("\n")[0] : String(err);
      // ĐỨT KẾT NỐI KHÁC HẲN MÀN KIỂM TRA, và gộp hai thứ này là chẩn đoán sai chỗ: một cái là
      // tầng TLS/mạng không bắt tay nổi, cái kia là HTTP trả về hẳn một trang. Ghi riêng.
      rows.push({ name: v.name, challenge: false, hasBox: false, error: msg });
      console.log(`   ĐỨT/HỎNG     : ${msg}\n`);
    }
  }

  console.log("── Kết luận ─────────────────────────────────────────");
  const chan = rows.filter((r) => r.challenge).map((r) => r.name);
  const dut = rows.filter((r) => r.error).map((r) => r.name);
  const qua = rows.filter((r) => !r.challenge && !r.error).map((r) => r.name);
  console.log(`  vào được       : ${qua.join(", ") || "(không cái nào)"}`);
  console.log(`  màn kiểm tra   : ${chan.join(", ") || "(không cái nào)"}`);
  console.log(`  đứt kết nối    : ${dut.join(", ") || "(không cái nào)"}`);
  if (qua.length === 0) {
    console.log("  → không biến thể nào vào được từ IP này.");
  } else if (qua.includes("new") && !qua.includes("shell")) {
    console.log('  → Chromium ĐẦY ĐỦ vào được còn chrome-headless-shell thì không.');
    console.log('    Ứng viên bản vá: channel: "chromium" trong launchProfile. CẦN CHẠY LẶP');
    console.log("    để loại trừ nhiễu mạng trước khi tin.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
