#!/usr/bin/env node
/**
 * Kiểm chứng lớp OBSCURA — trình duyệt thứ hai của khôi lỗi.
 *
 * Hai tầng, và tầng nào cũng có lý do riêng để tồn tại:
 *
 *   1. LUẬT THUẦN (luôn chạy, không cần binary): tên tệp release theo nền tảng, thứ tự đi tìm
 *      binary, đối số dựng cho `obscura serve`. Đây là chỗ những cái sai IM LẶNG nằm — tải nhầm
 *      kiến trúc thì tệp vẫn giải nén ngon lành rồi mới nổ「Exec format error」giữa một vòng cày,
 *      và cái bẫy ấy đã đớp thật ngay lượt đo đầu tiên: VM tông môn là aarch64 (Oracle Ampere)
 *      còn runner GitHub là x86_64.
 *
 *   2. ĐƯỜNG THẬT (chỉ khi máy có binary): dựng `serve` lên, nối CDP, mở một trang, rồi soát
 *      xem tiến trình đã được hạ hẳn chưa. Phần cuối mới là phần đáng giá nhất — một tiến trình
 *      obscura rò rỉ sẽ giữ cổng và ăn RAM cho tới khi máy tắt, mà nó chết lặng lẽ.
 *
 * Máy không có obscura thì tầng 2 tự bỏ qua và NÓI RA là đã bỏ qua — một lưới im lặng bỏ qua
 * nửa phần việc là một lưới nói dối.
 *
 * Chạy: npm run verify:obscura   (trên VM: npm run vm -- npm run verify:obscura)
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  buildObscuraServeArgs,
  obscuraBinaryCandidates,
  obscuraExecutableName,
  obscuraReleaseAsset,
  openObscuraBrowser,
  resolveObscuraBinary,
  shouldAnnounceObscuraMissing,
  _resetObscuraAnnounce,
} from "../src/lib/quest-engine/obscuraBrowser.mjs";

let passed = 0;
const check = (name, condition, detail = "") => {
  if (!condition) {
    console.error(`✗ ${name}${detail ? ` — ${detail}` : ""}`);
    process.exitCode = 1;
    throw new Error(name);
  }
  console.log(`✔ ${name}`);
  passed++;
};

// ---------------------------------------------------------------------------------------------
// 1. Tên tệp release — mỗi nền tảng một binary, và tải nhầm là hỏng ở tận lúc chạy
// ---------------------------------------------------------------------------------------------

check(
  "linux x86_64 → bản linux x86_64 stealth",
  obscuraReleaseAsset("linux", "x64") === "obscura-x86_64-linux-stealth.tar.gz",
  obscuraReleaseAsset("linux", "x64"),
);
check(
  "linux arm64 (VM tông môn) → bản aarch64, KHÔNG phải x86_64",
  obscuraReleaseAsset("linux", "arm64") === "obscura-aarch64-linux-stealth.tar.gz",
  obscuraReleaseAsset("linux", "arm64"),
);
check(
  "'aarch64' viết theo lối uname cũng ra đúng bản ấy",
  obscuraReleaseAsset("linux", "aarch64") === "obscura-aarch64-linux-stealth.tar.gz",
);
check(
  "macOS arm64 → bản macos aarch64",
  obscuraReleaseAsset("darwin", "arm64") === "obscura-aarch64-macos-stealth.tar.gz",
);
check(
  "Windows → luôn là zip x86_64 (nhà phát hành không có bản arm)",
  obscuraReleaseAsset("win32", "arm64") === "obscura-x86_64-windows-stealth.zip" &&
    obscuraReleaseAsset("win32", "x64") === "obscura-x86_64-windows-stealth.zip",
);
check(
  "kiến trúc lạ rơi về x86_64 — đoán theo phía phổ biến, không ném",
  obscuraReleaseAsset("linux", "riscv64") === "obscura-x86_64-linux-stealth.tar.gz",
);
check(
  "mọi bản đều là bản STEALTH và có render",
  ["linux", "darwin", "win32"].every((os) => {
    const name = obscuraReleaseAsset(os, "x64");
    return name.includes("-stealth") && !name.includes("no-render");
  }),
);
check("tên tệp thực thi theo nền tảng", obscuraExecutableName("win32") === "obscura.exe" && obscuraExecutableName("linux") === "obscura");

// ---------------------------------------------------------------------------------------------
// 2. Thứ tự đi tìm binary — phủ quyết của người vận hành phải đứng đầu
// ---------------------------------------------------------------------------------------------

// Đường dẫn dựng theo NỀN TẢNG ĐANG CHẠY, không gõ cứng kiểu POSIX: `path.resolve` trên Windows
// gắn thêm ổ đĩa vào một đường bắt đầu bằng "/" ("/opt/goi" → "D:\opt\goi"), nên một kỳ vọng
// gõ cứng sẽ đỏ trên máy nhà mà xanh trên VM — thứ lưới kiểm tệ nhất: đỏ vì chính nó.
const bundleRoot = path.resolve(path.sep === "\\" ? "C:\\goi" : "/opt/goi");
const bundleDir = path.join(bundleRoot, "quest-engine");
const declared = obscuraBinaryCandidates({
  env: { OBSCURA_BIN: "/tuy/chon/rieng/obscura" },
  platform: "linux",
  moduleDir: bundleDir,
});
check("OBSCURA_BIN đứng ĐẦU danh sách", declared[0] === "/tuy/chon/rieng/obscura", declared[0]);

const plain = obscuraBinaryCandidates({ env: {}, platform: "linux", moduleDir: bundleDir });
check("không khai gì thì không có mục rỗng nào lọt vào", plain.every((c) => c.trim().length > 0));
check(
  "gói PHẲNG: tìm ngay cạnh worker.mjs (thư mục cha của quest-engine)",
  plain.includes(path.join(bundleRoot, "obscura")),
  plain.join(" | "),
);
const repoRoot = path.resolve(path.sep === "\\" ? "C:\\repo" : "/repo");
check(
  "cây mã nguồn: tìm ở bin/ của gốc repo",
  obscuraBinaryCandidates({
    env: {},
    platform: "linux",
    moduleDir: path.join(repoRoot, "src", "lib", "quest-engine"),
  }).includes(path.join(repoRoot, "bin", "obscura")),
);
check("mục CUỐI là tên trần, để PATH lo", plain.at(-1) === "obscura");
check(
  "Windows tìm obscura.exe chứ không phải obscura",
  obscuraBinaryCandidates({ env: {}, platform: "win32", moduleDir: "C:\\goi\\quest-engine" }).at(-1) === "obscura.exe",
);
check(
  "khoảng trắng thừa trong OBSCURA_BIN bị cắt",
  obscuraBinaryCandidates({ env: { OBSCURA_BIN: "  /a/b  " }, platform: "linux", moduleDir: bundleDir })[0] === "/a/b",
);
check(
  "OBSCURA_BIN rỗng thì KHÔNG chen một mục rỗng vào đầu",
  obscuraBinaryCandidates({ env: { OBSCURA_BIN: "   " }, platform: "linux", moduleDir: bundleDir })[0] !== "",
);

// ---------------------------------------------------------------------------------------------
// 3. Đối số `serve` — cổng, kho cookie, stealth, UA
// ---------------------------------------------------------------------------------------------

const args = buildObscuraServeArgs({ port: 9411, storageDir: "/ho/so/obscura-store", userAgent: "UA-thử", stealth: true });
check("luôn mở bằng lệnh con `serve`", args[0] === "serve");
check("cổng đi vào dưới dạng chuỗi", args.includes("--port") && args[args.indexOf("--port") + 1] === "9411");
check("kho cookie riêng của đàn được truyền nguyên văn", args[args.indexOf("--storage-dir") + 1] === "/ho/so/obscura-store");
check("có --stealth khi bản dựng cho phép", args.includes("--stealth"));
check("UA đặt ngay từ lúc khởi động", args[args.indexOf("--user-agent") + 1] === "UA-thử");
check(
  "KHÔNG mở --host: cổng CDP là quyền điều khiển trình duyệt, không phải thứ để bày ra mạng",
  !args.includes("--host") && !args.includes("--allow-private-network"),
);
check(
  "bản dựng không stealth thì bỏ cờ ấy, không ném",
  !buildObscuraServeArgs({ port: 1, storageDir: "/x", userAgent: "u", stealth: false }).includes("--stealth"),
);
check(
  "không có UA thì không đẩy một cờ rỗng vào dòng lệnh",
  !buildObscuraServeArgs({ port: 1, storageDir: "/x", stealth: true }).includes("--user-agent"),
);

// ---------------------------------------------------------------------------------------------
// 4. Cờ「chỉ kêu một lần」— chống một cảnh báo lặp lại mỗi vòng, mỗi đàn
// ---------------------------------------------------------------------------------------------

_resetObscuraAnnounce();
check("lần đầu thì được kêu", shouldAnnounceObscuraMissing() === true);
check("lần thứ hai thì im", shouldAnnounceObscuraMissing() === false);
check("và lần thứ ba cũng im", shouldAnnounceObscuraMissing() === false);
_resetObscuraAnnounce();
check("đặt lại rồi thì kêu tiếp — lưới kiểm dựng lại được kịch bản", shouldAnnounceObscuraMissing() === true);
_resetObscuraAnnounce();

// ---------------------------------------------------------------------------------------------
// 5. ĐƯỜNG THẬT — chỉ khi máy này có binary
// ---------------------------------------------------------------------------------------------

const found = resolveObscuraBinary();
if (!found) {
  console.log(
    "\n⚠ Máy này KHÔNG có obscura — bỏ qua phần đo đường thật (mục 5).\n" +
      "  Đó là trạng thái hợp lệ: engine sẽ lui về Chromium. Muốn đo đủ thì cài binary rồi chạy lại.",
  );
  console.log(`\n${passed} phép thử qua (phần thuần).`);
} else {
  console.log(`\n• Thấy obscura ${found.version || "(không rõ bản)"} tại ${found.bin} — đo tiếp đường thật.`);

  const storageDir = mkdtempSync(path.join(tmpdir(), "obscura-verify-"));
  let opened = null;
  try {
    const { chromium } = await import("playwright-core");
    opened = await openObscuraBrowser({
      chromium,
      storageDir,
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/151.0.0.0 Safari/537.36",
      viewport: { width: 1366, height: 768 },
      log: { debug: () => {} },
    });
    check("mở được trình duyệt Obscura", opened !== null);
    check("nhãn nói rõ đang chạy bằng gì", String(opened.via).startsWith("Obscura"), opened.via);

    const page = opened.context.pages()[0] ?? (await opened.context.newPage());
    // `about:blank` là đủ: phần cần chứng minh là CDP nối thật và trang chạy JS thật, không phải
    // chuyện mạng — một lưới kiểm phụ thuộc Internet là một lưới sẽ đỏ vì lý do chẳng liên quan.
    await page.goto("about:blank");
    const alive = await page.evaluate(() => 6 * 7);
    check("trang chạy được JavaScript qua CDP", alive === 42, String(alive));

    const cdp = await opened.context.newCDPSession(page);
    const version = await cdp.send("Browser.getVersion");
    // `wearRealBrowserIdentity` đọc `product` theo dạng「Tên/1.2.3.4」rồi rút số major ra; obscura
    // trả "Chrome/145.0.0.0". Dạng ấy đổi là phép đè client hints câm lặng bỏ cuộc.
    const major = String(version?.product ?? "").split("/")[1]?.split(".")[0] ?? "";
    check("Browser.getVersion vẫn đúng dạng mà phép đè client hints cần", /^\d+$/.test(major), JSON.stringify(version?.product));
  } finally {
    if (opened) await opened.dispose();
    rmSync(storageDir, { recursive: true, force: true });
  }

  // Phần đáng giá nhất: tiến trình đã đi hẳn chưa. Một `serve` sống sót sẽ giữ cổng và ăn RAM
  // cho tới khi máy tắt, mà nó không kêu một tiếng nào.
  if (process.platform !== "win32") {
    const left = spawnSync("pgrep", ["-fa", "obscura serve --port"], { encoding: "utf8" });
    const mine = String(left.stdout ?? "")
      .split("\n")
      .filter((line) => line.includes("obscura-verify-"));
    check("dispose() hạ hẳn tiến trình — không để lại `serve` nào của lượt kiểm này", mine.length === 0, mine.join(" | "));
  } else {
    console.log("• Bỏ qua phép soát tiến trình sót: `pgrep` không có trên Windows.");
  }

  console.log(`\n${passed} phép thử qua (đủ cả hai tầng).`);
}
