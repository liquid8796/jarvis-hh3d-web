#!/usr/bin/env node
/**
 * DẤU VÂN TAY CỦA TRÌNH DUYỆT KHÔI LỖI — `npm run verify:browser-fingerprint`.
 *
 * Chromium thật, cấu hình thật (`launchProfile` + `wearRealBrowserIdentity` của chính engine),
 * nhưng KHÔNG chạm mạng: một máy chủ HTTP nội bộ đứng ra nhận request rồi kể lại đúng những
 * header đã tới. `127.0.0.1` là secure context nên client hints ĐƯỢC gửi — đó là toàn bộ lý do
 * phép đo này làm được ở đây thay vì phải gõ cửa trang game.
 *
 * VÌ SAO ĐÁNG CÓ: cái hỏng nó canh KHÔNG hiện ra ở bất kỳ đâu trong lượt chạy. Trình duyệt vẫn
 * mở, vẫn tải trang, vẫn chạy nhiệm vụ — chỉ là Cloudflare đọc được「HeadlessChrome」trong
 * `Sec-CH-UA` rồi dựng màn kiểm tra, và cái giá hiện ra ở tận đầu kia: một dòng「màn kiểm tra
 * không tự qua」trong nhật ký của một đạo hữu nào đó, ba mươi phút một lần.
 *
 * Đo được ngày 19/08/2026, TRƯỚC bản vá — chép nguyên văn vì nó là lý do tệp này tồn tại:
 *
 *     user-agent : … Chrome/151.0.0.0 Safari/537.36
 *     sec-ch-ua  : "Not=A?Brand";v="99", "HeadlessChrome";v="151", "Chromium";v="151"
 */
import { createServer } from "node:http";
import { chromium } from "playwright-core";
import { launchProfile, wearRealBrowserIdentity } from "../src/lib/quest-engine/runCycle.mjs";

let checks = 0;
const check = (label: string, condition: unknown, detail = "") => {
  if (!condition) {
    console.error(`\n✗ ${label}${detail ? ` — ${detail}` : ""}`);
    process.exit(1);
  }
  checks += 1;
  console.log(`  ✓ ${label}`);
};

/** Header của lượt tải CUỐI — lượt đã nhận `Accept-CH` nên trình duyệt gửi đủ bộ client hints. */
const seen: Array<Record<string, string | string[] | undefined>> = [];

const server = createServer((req, res) => {
  seen.push(req.headers);
  res.writeHead(200, {
    "content-type": "text/html",
    // Xin đủ bộ: `Sec-CH-UA` đi mặc định, còn full-version-list thì phải hỏi mới có.
    "accept-ch": "Sec-CH-UA, Sec-CH-UA-Full-Version-List, Sec-CH-UA-Platform, Sec-CH-UA-Mobile",
  });
  res.end("<!doctype html><title>dấu vân tay</title><p>ok");
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
const address = server.address();
if (address === null || typeof address === "string") throw new Error("không mở được máy chủ đo");
const url = `http://127.0.0.1:${address.port}/`;

const fingerprint = launchProfile(true);
const browser = await chromium.launch({
  headless: true,
  args: fingerprint.args,
  ignoreDefaultArgs: fingerprint.ignoreDefaultArgs,
});

try {
  const context = await browser.newContext({
    userAgent: fingerprint.userAgent,
    locale: fingerprint.locale,
    timezoneId: fingerprint.timezoneId,
    viewport: fingerprint.viewport,
  });
  const page = await context.newPage();

  const identity = await wearRealBrowserIdentity(context, page);
  check("phép đè danh tính chạy được trên Chromium đang cài", identity.ok, identity.detail);

  await page.goto(url, { waitUntil: "load" });
  // Lượt hai: `Accept-CH` của lượt một đã tới nơi, nên bộ hint đầy đủ mới đi cùng lượt này.
  await page.goto(url, { waitUntil: "load" });

  const last = seen[seen.length - 1] ?? {};
  const header = (name: string) => String(last[name] ?? "");
  const ua = header("user-agent");
  const chUa = header("sec-ch-ua");
  const chFull = header("sec-ch-ua-full-version-list");

  console.log("");
  console.log("  đo được:");
  console.log(`    user-agent                  : ${ua}`);
  console.log(`    sec-ch-ua                   : ${chUa}`);
  console.log(`    sec-ch-ua-full-version-list : ${chFull}`);
  console.log(`    sec-ch-ua-platform          : ${header("sec-ch-ua-platform")}`);
  console.log("");

  // ---- Luật 1: không đâu được còn chữ「Headless」------------------------------------------
  //
  // Quét cả ba chỗ chứ không riêng `sec-ch-ua`: bản trước đã đè đúng UA mà vẫn lọt ở client
  // hints, nên phép kiểm phải hỏi TẤT CẢ những chỗ chuỗi ấy từng nấp.
  for (const [name, value] of [
    ["user-agent", ua],
    ["sec-ch-ua", chUa],
    ["sec-ch-ua-full-version-list", chFull],
  ] as const) {
    check(`${name} không mang chữ「Headless」`, !/headless/i.test(value), value);
  }

  const inPage = await page.evaluate(async () => {
    const data = (navigator as Navigator & { userAgentData?: { brands: unknown; getHighEntropyValues: (h: string[]) => Promise<unknown> } }).userAgentData;
    return {
      ua: navigator.userAgent,
      webdriver: navigator.webdriver,
      brands: data ? JSON.stringify(data.brands) : "",
      high: data ? JSON.stringify(await data.getHighEntropyValues(["fullVersionList", "platform"])) : "",
    };
  });
  check("navigator.userAgentData.brands cũng sạch", !/headless/i.test(inPage.brands), inPage.brands);
  check("bản đầy đủ (getHighEntropyValues) cũng sạch", !/headless/i.test(inPage.high), inPage.high);
  check("navigator.webdriver vẫn false", inPage.webdriver === false, String(inPage.webdriver));

  // ---- Luật 2: UA và client hints phải khai CÙNG một số hiệu ------------------------------
  //
  // Đây là nửa còn lại của cùng một cái bẫy: một UA nói「Chrome 151」trên client hints nói
  // 「152」cũng là mâu thuẫn, y như chữ Headless. Ghim tay số hiệu là cách nó xảy ra — nên
  // luật này canh cho lượt nâng playwright sau này.
  const uaMajor = ua.match(/Chrome\/(\d+)\./)?.[1] ?? "";
  const hintMajor = chUa.match(/"Google Chrome";v="(\d+)"/)?.[1] ?? "";
  const realMajor = (browser.version().split(".")[0] ?? "").trim();
  check("UA khai đúng thương hiệu Google Chrome trong client hints", hintMajor.length > 0, chUa);
  check(
    `UA (${uaMajor}) · client hints (${hintMajor}) · binary (${realMajor}) — cùng một số hiệu`,
    uaMajor === hintMajor && hintMajor === realMajor,
  );

  // ---- Luật 3: giữ nguyên phần binary tự khai ---------------------------------------------
  //
  // Chỉ「HeadlessChrome」bị thay. Brand GREASE và「Chromium」phải còn nguyên: một danh sách chỉ
  // có mỗi Google Chrome là một dấu vân tay không tồn tại ngoài đời.
  check("brand GREASE của bản dựng còn nguyên", /Not[=(_][A-Za-z?: ]*Brand/.test(chUa), chUa);
  check("brand「Chromium」còn nguyên", /"Chromium";v="\d+"/.test(chUa), chUa);
  check("nền tảng vẫn khớp UA (Windows)", header("sec-ch-ua-platform") === '"Windows"', header("sec-ch-ua-platform"));
} finally {
  await browser.close();
  server.close();
}

console.log(`\n✔ Dấu vân tay trình duyệt: ${checks} phép kiểm, tất cả xanh.`);
