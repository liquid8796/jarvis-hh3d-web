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

/**
 * Hai đường xác thực, ưu tiên cái tường minh.
 *
 * Ba biến VERCEL_* là đường chắc chắn nhất nhưng không phải đường duy nhất: sau một lần
 * `vercel env pull`, .env đã có VERCEL_OIDC_TOKEN và SDK tự dùng nó — y như credentials()
 * trong src/lib/runners/sandbox.ts nhường cho OIDC khi chạy trên Vercel. Bắt người ta đi
 * tạo personal token chỉ để chụp một tấm ảnh VM là ma sát không đáng có.
 *
 * Thứ tự này cũng có nghĩa ai đã cấu hình đủ ba biến thì hành vi không đổi dưới chân họ.
 */
function credentials() {
  const { VERCEL_TOKEN, VERCEL_TEAM_ID, VERCEL_PROJECT_ID, VERCEL_OIDC_TOKEN } = process.env;

  if (VERCEL_TOKEN && VERCEL_TEAM_ID && VERCEL_PROJECT_ID) {
    return {
      how: "token cá nhân",
      creds: { token: VERCEL_TOKEN, teamId: VERCEL_TEAM_ID, projectId: VERCEL_PROJECT_ID },
    };
  }

  if (VERCEL_OIDC_TOKEN) {
    // SDK đọc thẳng VERCEL_OIDC_TOKEN từ môi trường; team và project nằm trong claims của
    // chính token nên không cần khai lại.
    return { how: "OIDC (từ `vercel env pull`)", creds: {} };
  }

  console.error(
    "Không có đường nào để xác thực với Vercel. Chọn một:\n" +
      "  • Dễ nhất : chạy `vercel env pull` — .env sẽ có VERCEL_OIDC_TOKEN (hạn ~12 giờ).\n" +
      "  • Bền hơn : đặt đủ VERCEL_TOKEN, VERCEL_TEAM_ID, VERCEL_PROJECT_ID trong .env.\n" +
      "      Token          : Vercel → Account Settings → Tokens\n" +
      "      Team/Project ID: Vercel → Project → Settings → General",
  );
  process.exit(1);
}

const { how, creds } = credentials();

console.log(`Xác thực bằng ${how}.`);
console.log("Đang dựng VM để cài Chromium (mất vài phút, chỉ lần này)…");

const sandbox = await Sandbox.create({
  ...creds,
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
