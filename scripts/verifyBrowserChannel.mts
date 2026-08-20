#!/usr/bin/env node
/**
 * Lưới cho phép chọn KÊNH TRÌNH DUYỆT (bản vá 20/08/2026).
 *
 * Vì sao bản vá này tồn tại — đo bằng `npm run diagnose:cf -- --walk` TRÊN VM (đúng dải IP trung
 * tâm dữ liệu của khôi lỗi GitHub), LẶP BA LƯỢT, cả ba y hệt:
 *
 *   chrome-headless-shell → sạch ở trang chủ, CHẶN ngay trang thứ hai (/nhiem-vu-hang-ngay)
 *   Chromium đầy đủ       → đi hết 8 trang của một vòng thật, không chặn lần nào
 *
 * Lưới này KHÔNG đo Cloudflare (không thể, và giả vờ đo được là nói dối). Nó đo phần CÓ THỂ đo:
 * ta có thật sự đòi Chromium đầy đủ không, và khi máy không có nó thì có LUI ĐƯỢC không — nhánh
 * lui mới là chỗ nguy hiểm, vì hỏng ở đó nghĩa là mọi vòng chạy chết ngay từ cú mở trình duyệt.
 */
import { launchProfile, openBrowserPreferringFullChromium } from "../src/lib/quest-engine/runCycle.mjs";

let passed = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail = "") {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const silent = { info: () => {}, warning: () => {}, debug: () => {} };

/** Chromium giả: ghi lại mọi lượt gọi, và ném đúng ở những kênh ta bảo nó ném. */
function fakeChromium(failOn: (channel: string | undefined) => boolean) {
  const calls: (string | undefined)[] = [];
  const context = { __context: true };
  return {
    calls,
    chromium: {
      async launchPersistentContext(_dir: string, options: { channel?: string }) {
        calls.push(options.channel);
        if (failOn(options.channel)) throw new Error(`không có kênh ${options.channel}`);
        return context;
      },
      async launch(options: { channel?: string }) {
        calls.push(options.channel);
        if (failOn(options.channel)) throw new Error(`không có kênh ${options.channel}`);
        return { async newContext() { return context; } };
      },
    },
  };
}

async function main() {
  console.log("launchProfile — khai kênh Chromium đầy đủ");
  const fp = launchProfile(true) as { channel?: string; headless: boolean };
  check('có channel: "chromium"', fp.channel === "chromium", String(fp.channel));
  check("vẫn headless", fp.headless === true, String(fp.headless));

  console.log("\nMáy CÓ Chromium đầy đủ — phải dùng nó, không đụng tới đường lui");
  {
    const { chromium, calls } = fakeChromium(() => false);
    const r = await openBrowserPreferringFullChromium(chromium, launchProfile(true), "", silent);
    check("chỉ thử ĐÚNG một lần", calls.length === 1, `${calls.length} lượt`);
    check("…và lượt ấy đòi kênh chromium", calls[0] === "chromium", String(calls[0]));
    check("…lời khai nói đúng tên binary", String(r.via).includes("đầy đủ"), r.via);
  }

  console.log("\nMáy CHỈ có shell — phải lui, KHÔNG được chết");
  {
    const { chromium, calls } = fakeChromium((ch) => ch === "chromium");
    const r = await openBrowserPreferringFullChromium(chromium, launchProfile(true), "", silent);
    check("thử kênh chromium trước rồi mới lui", calls[0] === "chromium" && calls.length === 2, calls.join(","));
    check("…lượt lui KHÔNG mang channel", calls[1] === undefined, String(calls[1]));
    check("…vẫn mở được context", r.context != null);
    check("…và NÓI RA là đang chạy đường lui", String(r.via).includes("đường lui"), r.via);
  }

  console.log("\nHồ sơ BỀN cũng đi qua đúng lối ấy");
  {
    const { chromium, calls } = fakeChromium((ch) => ch === "chromium");
    const r = await openBrowserPreferringFullChromium(chromium, launchProfile(true), "/tmp/ho-so", silent);
    check("persistent: thử chromium rồi lui", calls.join(",") === "chromium,", calls.join(","));
    check("…browser để null (persistent không có browser riêng)", r.browser === null);
  }

  console.log("\nHỏng CẢ HAI kênh — phải NÉM, không được nuốt lặng lẽ");
  {
    const { chromium } = fakeChromium(() => true);
    let threw: unknown = null;
    try {
      await openBrowserPreferringFullChromium(chromium, launchProfile(true), "", silent);
    } catch (err) {
      threw = err;
    }
    check("ném lỗi thật của lượt cuối", threw instanceof Error, String(threw));
  }

  console.log(`\n${passed} thuận, ${failures.length} nghịch.`);
  for (const f of failures) console.log(`  ✗ ${f}`);
  if (failures.length > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
