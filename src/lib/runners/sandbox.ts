import { Sandbox } from "@vercel/sandbox";
import type { UserConfig } from "@/lib/services/configs";
import { SANDBOX_SLICE_MS } from "./policy";

/**
 * Linh sứ sandbox — chạy MỘT LÁT nhiệm vụ trong một microVM của Vercel rồi tắt.
 *
 * Vì sao lại là "lát" chứ không phải "lượt": sandbox có trần thời gian, còn nhiệm vụ thì
 * không hứa xong trong trần đó. Nên đơn vị làm việc ở đây là một lát có giới hạn — làm
 * được tới đâu, báo cáo tới đó, và nói rõ đã xong hẳn hay cần lát nữa. Cron gọi lại lát sau.
 *
 * Đánh đổi phải biết trước: mỗi lát là một VM MỚI, không kế thừa gì từ lát trước — không
 * cookie đã warm, không tab đang mở, không phòng đang đứng. Với Luyện Đan Đường điều đó vô
 * hại vì mỗi lượt ghé vốn đã độc lập (vào trang, làm, đi). Với Mê Cung thì chí mạng, và đó
 * chính là lý do `policy.ts` không bao giờ giao Mê Cung cho sandbox.
 */

/** Thư viện hệ thống Chromium cần trên VM (Amazon Linux / dnf). */
const CHROMIUM_SYSTEM_DEPS = [
  "nss", "nspr", "libxkbcommon", "atk", "at-spi2-atk", "at-spi2-core",
  "libXcomposite", "libXdamage", "libXrandr", "libXfixes", "libXcursor",
  "libXi", "libXtst", "libXScrnSaver", "libXext", "mesa-libgbm", "libdrm",
  "mesa-libGL", "mesa-libEGL", "cups-libs", "alsa-lib", "pango", "cairo",
  "gtk3", "dbus-libs",
];

export type SliceResult = {
  /** true = nhiệm vụ đã xong hẳn; false = còn dở, cần lát nữa. */
  finished: boolean;
  ok: boolean;
  message: string;
  /** Những dòng kể cho người dùng đọc, theo thứ tự thời gian. */
  events: { level: "info" | "success" | "warning" | "error"; message: string }[];
};

function credentials() {
  const { VERCEL_TOKEN, VERCEL_TEAM_ID, VERCEL_PROJECT_ID } = process.env;
  return VERCEL_TOKEN && VERCEL_TEAM_ID && VERCEL_PROJECT_ID
    ? { token: VERCEL_TOKEN, teamId: VERCEL_TEAM_ID, projectId: VERCEL_PROJECT_ID }
    : {};
}

/**
 * Chạy một lát. Luôn tắt VM ở `finally` — một sandbox bị bỏ quên vẫn tính tiền, và lỗi ở
 * giữa chừng là lúc dễ quên nhất.
 */
export async function runSandboxSlice(input: {
  config: UserConfig;
  onEvent?: (level: SliceResult["events"][number]["level"], message: string) => void;
}): Promise<SliceResult> {
  const events: SliceResult["events"] = [];
  const say = (level: SliceResult["events"][number]["level"], message: string) => {
    events.push({ level, message });
    input.onEvent?.(level, message);
  };

  const snapshotId = process.env.AGENT_BROWSER_SNAPSHOT_ID;
  say("info", snapshotId ? "Đang dựng sandbox từ ảnh có sẵn…" : "Đang dựng sandbox (lần đầu, cài Chromium — hơi lâu)…");

  const sandbox = snapshotId
    ? await Sandbox.create({
        ...credentials(),
        source: { type: "snapshot", snapshotId },
        timeout: SANDBOX_SLICE_MS,
      })
    : await Sandbox.create({ ...credentials(), runtime: "node24", timeout: SANDBOX_SLICE_MS });

  try {
    if (!snapshotId) {
      // Không có ảnh dựng sẵn thì mỗi lát mất ~30s chỉ để cài — đủ để ăn hết ngân sách của
      // một lát ngắn. README hướng dẫn tạo ảnh một lần; đây là đường chạy được nhưng chậm.
      await sandbox.runCommand("sh", [
        "-c",
        `sudo dnf clean all 2>&1 && sudo dnf install -y --skip-broken ${CHROMIUM_SYSTEM_DEPS.join(" ")} 2>&1 && sudo ldconfig 2>&1`,
      ]);
      await sandbox.runCommand("npm", ["install", "-g", "agent-browser"]);
      await sandbox.runCommand("npx", ["agent-browser", "install"]);
      say("warning", "Chưa có AGENT_BROWSER_SNAPSHOT_ID — mỗi lát phải cài lại Chromium. Xem README để tạo ảnh dựng sẵn.");
    }

    const quests: string[] = [];
    if (input.config.quests.luyenDan.enabled) quests.push("Luyện Đan Đường");
    if (input.config.quests.meCung.enabled) quests.push("Mê Cung");

    if (quests.length === 0) {
      return { finished: true, ok: true, message: "Không có nhiệm vụ nào được bật.", events };
    }

    say("success", `Sandbox đã sẵn sàng. Sẽ hành sự: ${quests.join(" · ")}.`);

    // ---- CHỖ CẮM ENGINE ---------------------------------------------------------------
    // Ở đây sẽ là chuỗi lệnh agent-browser: nạp cookie của người dùng, mở trang lò, thu đan,
    // phân giải, khai lô, giữ lửa. Cookie đã giải mã nằm ở input.config.gameCookie.
    //
    // Hiện tại chỉ chứng minh trọn đường đi: dựng được VM, chạy được lệnh, kể được chuyện.
    const probe = await sandbox.runCommand("node", ["-e", "console.log('sandbox-ok')"]);
    const stdout = (await probe.stdout()).trim();
    say("info", `Kiểm tra VM: ${stdout || "(không có phản hồi)"}`);

    return {
      finished: true,
      ok: true,
      message: "Lát sandbox hoàn tất.",
      events,
    };
  } finally {
    await sandbox.stop().catch(() => {
      /* VM tự hết hạn theo timeout; không để lỗi dọn dẹp che mất lỗi thật */
    });
  }
}
