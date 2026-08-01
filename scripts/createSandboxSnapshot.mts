#!/usr/bin/env node
/**
 * Tạo ẢNH DỰNG SẴN cho sandbox — chạy MỘT LẦN, dùng mãi.
 *
 * Không có ảnh này, mỗi lát sandbox phải cài lại thư viện hệ thống + agent-browser +
 * Chromium, mất khoảng 30 giây. Với một lát chỉ dài vài phút thì đó là phần lớn ngân sách
 * bị đốt vào việc dựng chứ không phải việc làm. Có ảnh rồi thì VM lên dưới một giây.
 *
 *   npx tsx scripts/createSandboxSnapshot.mts
 *
 * Rồi đặt kết quả vào biến môi trường AGENT_BROWSER_SNAPSHOT_ID trên Vercel.
 */
import { Sandbox } from "@vercel/sandbox";
import { loadEnv } from "./loadEnv.mjs";

loadEnv();

const CHROMIUM_SYSTEM_DEPS = [
  "nss", "nspr", "libxkbcommon", "atk", "at-spi2-atk", "at-spi2-core",
  "libXcomposite", "libXdamage", "libXrandr", "libXfixes", "libXcursor",
  "libXi", "libXtst", "libXScrnSaver", "libXext", "mesa-libgbm", "libdrm",
  "mesa-libGL", "mesa-libEGL", "cups-libs", "alsa-lib", "pango", "cairo",
  "gtk3", "dbus-libs",
];

const { VERCEL_TOKEN, VERCEL_TEAM_ID, VERCEL_PROJECT_ID } = process.env;
if (!VERCEL_TOKEN || !VERCEL_TEAM_ID || !VERCEL_PROJECT_ID) {
  console.error(
    "Chạy từ máy nhà cần đủ ba biến: VERCEL_TOKEN, VERCEL_TEAM_ID, VERCEL_PROJECT_ID.\n" +
      "  Token : Vercel → Account Settings → Tokens\n" +
      "  Team/Project ID: Vercel → Project → Settings → General",
  );
  process.exit(1);
}

console.log("Đang dựng VM để cài Chromium (mất vài phút, chỉ lần này)…");

const sandbox = await Sandbox.create({
  token: VERCEL_TOKEN,
  teamId: VERCEL_TEAM_ID,
  projectId: VERCEL_PROJECT_ID,
  runtime: "node24",
  timeout: 300_000,
});

try {
  console.log("  • cài thư viện hệ thống…");
  await sandbox.runCommand("sh", [
    "-c",
    `sudo dnf clean all 2>&1 && sudo dnf install -y --skip-broken ${CHROMIUM_SYSTEM_DEPS.join(" ")} 2>&1 && sudo ldconfig 2>&1`,
  ]);

  console.log("  • cài agent-browser…");
  await sandbox.runCommand("npm", ["install", "-g", "agent-browser"]);

  console.log("  • tải Chromium…");
  await sandbox.runCommand("npx", ["agent-browser", "install"]);

  const snapshot = await sandbox.snapshot();
  console.log(`\n✔ Xong. AGENT_BROWSER_SNAPSHOT_ID=${snapshot.snapshotId}`);
  console.log("  Thêm biến này vào Vercel → Settings → Environment Variables.");
} finally {
  await sandbox.stop().catch(() => {});
}
