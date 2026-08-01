#!/usr/bin/env node
/**
 * Ảnh VM này còn dùng được không?
 *
 *   npx tsx scripts/verifySandboxSnapshot.mts [snapshotId]
 *
 * Dựng một VM từ ảnh, gửi sang đúng những tệp mà `launchSandboxWorker` gửi, rồi bắt nó mở
 * Chromium thật và đọc một trang thật.
 *
 * Có mặt vì một ảnh hỏng KHÔNG kêu lúc chụp. `npm install` chạy xong, `playwright install`
 * chạy xong, ảnh chụp xong, ID trả về đẹp đẽ — rồi mỗi lát sandbox sau đó chết vì
 * "Cannot find package 'playwright-core'" (cài global thì Node không tra tới) hoặc
 * "Executable doesn't exist" (CLI lệch phiên bản đặt sẵn revision Chromium khác). Cả hai chỉ
 * lộ ra trên production, trong một VM đã tự huỷ, sau khi người dùng bấm Khai Đàn.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { Sandbox } from "@vercel/sandbox";
import { loadEnv } from "./loadEnv.mjs";

loadEnv();

const snapshotId = process.argv[2] ?? process.env.AGENT_BROWSER_SNAPSHOT_ID;
if (!snapshotId) {
  console.error("Chưa biết ảnh nào để kiểm. Truyền vào tham số, hoặc đặt AGENT_BROWSER_SNAPSHOT_ID.");
  process.exit(1);
}

const ENGINE_FILES = [
  "boardScripts.mjs",
  "cooldown.mjs",
  "engine.mjs",
  "profile.mjs",
  "profile.json",
  "runCycle.mjs",
  "session.mjs",
];

/**
 * Bài kiểm chạy TRONG VM. Cố ý đi hết đường mà một lượt thật đi: nạp playwright-core theo
 * đúng cách worker nạp, mở Chromium, dựng một trang, rồi để chính bộ thông dịch đọc trang ấy
 * — nếu chỉ kiểm `import` thì một ảnh thiếu Chromium vẫn qua được.
 */
const CHECK_SOURCE = String.raw`
const out = (label, ok, detail) => console.log((ok ? "OK   " : "FAIL ") + label + (detail ? " — " + detail : ""));

let failed = 0;
const step = async (label, fn) => {
  try { const d = await fn(); out(label, true, d); }
  catch (err) { failed++; out(label, false, err.message.split("\n")[0]); }
};

let chromium, runCycle, browser;

await step("import playwright-core", async () => {
  ({ chromium } = await import("playwright-core"));
  return chromium.executablePath();
});

await step("import bộ thông dịch", async () => {
  ({ runCycle } = await import("./quest-engine/runCycle.mjs"));
  const { loadProfile } = await import("./quest-engine/profile.mjs");
  return loadProfile().quests.length + " nhiệm vụ trong hồ sơ";
});

await step("mở Chromium", async () => {
  browser = await chromium.launch({ headless: true });
  return browser.version();
});

await step("đọc được một trang", async () => {
  const page = await browser.newPage();
  await page.setContent("<h1 id=x>Sảnh thử</h1>");
  const text = await page.locator("#x").innerText();
  if (text !== "Sảnh thử") throw new Error("đọc ra: " + text);
  return text;
});

await step("engine chạy được một bước trên trang", async () => {
  const { createQuestEngine } = await import("./quest-engine/engine.mjs");
  const { createSession } = await import("./quest-engine/session.mjs");
  const page = await browser.newPage();
  await page.setContent("<div id=cap>120/385</div>");
  const session = createSession(page, {
    baseUrl: "http://localhost", minActionDelayMs: 0, maxActionDelayMs: 1,
    log: { info() {}, warning() {}, debug() {} },
  });
  const engine = createQuestEngine({ log: { info() {}, warning() {}, debug() {} } });
  const res = await engine.run(session, { dailyQuestPath: "/" }, {
    id: "t", name: "Thử", enabled: true, kind: "customSteps", matchTexts: [], options: [],
    fallbackCooldownSeconds: 60, order: 0,
    steps: [{ action: "stopIf", text: "đủ rồi", timeoutMs: 2000,
              condition: { selector: "#cap", kind: "textMatches", text: "120/385" } }],
  });
  if (res.outcome !== "alreadyDone") throw new Error("outcome = " + res.outcome);
  return res.message;
});

if (browser) await browser.close().catch(() => {});
console.log(failed === 0 ? "\nẢnh dùng được." : "\n" + failed + " hạng mục hỏng — ảnh KHÔNG dùng được.");
process.exit(failed === 0 ? 0 : 1);
`;

function credentials() {
  const { VERCEL_TOKEN, VERCEL_TEAM_ID, VERCEL_PROJECT_ID } = process.env;
  return VERCEL_TOKEN && VERCEL_TEAM_ID && VERCEL_PROJECT_ID
    ? { token: VERCEL_TOKEN, teamId: VERCEL_TEAM_ID, projectId: VERCEL_PROJECT_ID }
    : {};
}

console.log(`Đang dựng VM từ ảnh ${snapshotId}…`);

const sandbox = await Sandbox.create({
  ...credentials(),
  source: { type: "snapshot", snapshotId },
  timeout: 300_000,
});

try {
  const dir = path.join(process.cwd(), "src", "lib", "quest-engine");
  await sandbox.writeFiles([
    { path: "check.mjs", content: Buffer.from(CHECK_SOURCE, "utf8") },
    ...(await Promise.all(
      ENGINE_FILES.map(async (name) => ({
        path: `quest-engine/${name}`,
        content: await readFile(path.join(dir, name)),
      })),
    )),
  ]);

  const run = await sandbox.runCommand("node", ["check.mjs"]);
  console.log(await run.stdout());
  const err = await run.stderr();
  if (err.trim()) console.error(err);
  process.exitCode = run.exitCode === 0 ? 0 : 1;
} finally {
  await sandbox.stop().catch(() => {});
}
