import { readFile } from "node:fs/promises";
import path from "node:path";
import { Sandbox } from "@vercel/sandbox";
import { SANDBOX_SLICE_MS } from "./policy";

/**
 * Linh sứ SANDBOX — dựng một microVM rồi thả nó tự chạy.
 *
 * Điểm mấu chốt của thiết kế này, và lý do nó khác bản đầu tiên: **function KHÔNG chờ
 * sandbox làm xong.** Bản trước `await` cả lát tám phút, nhưng function của Vercel có trần
 * thời gian riêng — trên gói Hobby chỉ 60 giây. Chờ trong function nghĩa là function chết
 * trước, kéo theo cả lượt chạy, và không gói nào rẻ chữa được điều đó.
 *
 * Nên đảo vai: function chỉ (1) dựng VM, (2) nạp một script worker vào đó, (3) chạy script
 * ở chế độ `detached`, (4) trả về ngay. Từ giây đó sandbox sống độc lập với microVM timeout
 * của CHÍNH nó, và tự nói chuyện với `/api/worker` bằng đúng giao thức mà linh sứ máy nhà
 * dùng — nhận việc, nhịp tim, kể chuyện, báo kết thúc.
 *
 * Cái hay của việc dùng lại giao thức: sandbox và worker máy nhà trở thành hai hiện thân
 * của cùng một hợp đồng. Không có nhánh code thứ hai để lệch pha, và người dùng thấy nhật
 * ký giống hệt nhau dù lượt chạy ở đâu.
 */

/**
 * Phiên bản Playwright dùng khi phải dựng VM tại chỗ. Giữ khớp với `playwright-core` trong
 * package.json và với ảnh do scripts/createSandboxSnapshot.mts chụp: revision Chromium gắn
 * chặt với phiên bản, nên lệch một nấc là "Executable doesn't exist" lúc chạy.
 */
const PLAYWRIGHT_VERSION = "1.62.1";

/** Thư viện hệ thống Chromium cần trên VM (Amazon Linux / dnf). */
const CHROMIUM_SYSTEM_DEPS = [
  "nss", "nspr", "libxkbcommon", "atk", "at-spi2-atk", "at-spi2-core",
  "libXcomposite", "libXdamage", "libXrandr", "libXfixes", "libXcursor",
  "libXi", "libXtst", "libXScrnSaver", "libXext", "mesa-libgbm", "libdrm",
  "mesa-libGL", "mesa-libEGL", "cups-libs", "alsa-lib", "pango", "cairo",
  "gtk3", "dbus-libs",
];

function credentials() {
  const { VERCEL_TOKEN, VERCEL_TEAM_ID, VERCEL_PROJECT_ID } = process.env;
  return VERCEL_TOKEN && VERCEL_TEAM_ID && VERCEL_PROJECT_ID
    ? { token: VERCEL_TOKEN, teamId: VERCEL_TEAM_ID, projectId: VERCEL_PROJECT_ID }
    : {};
}

export type LaunchResult = { launched: boolean; reason: string };

/**
 * Dựng một sandbox và thả nó đi làm. Trả về trong vài giây, không đợi việc xong.
 *
 * Cố ý KHÔNG nhận job cụ thể: sandbox tự gọi `claim` như mọi linh sứ khác. Nhờ vậy cùng một
 * câu UPDATE nguyên tử của Postgres phân xử việc giành job, và không bao giờ có chuyện một
 * job bị hai runner ôm.
 */
export async function launchSandboxWorker(): Promise<LaunchResult> {
  const webUrl = process.env.WEB_URL ?? process.env.VERCEL_PROJECT_PRODUCTION_URL;
  const token = process.env.WORKER_TOKEN;

  if (!token || token === "change-me") {
    return { launched: false, reason: "WORKER_TOKEN chưa đặt — sandbox không tự xác thực được." };
  }

  if (!webUrl) {
    return {
      launched: false,
      reason: "Chưa biết địa chỉ web để sandbox gọi về — đặt WEB_URL (https://<app>.vercel.app).",
    };
  }

  const base = webUrl.startsWith("http") ? webUrl : `https://${webUrl}`;
  const snapshotId = process.env.AGENT_BROWSER_SNAPSHOT_ID;

  const sandbox = snapshotId
    ? await Sandbox.create({
        ...credentials(),
        source: { type: "snapshot", snapshotId },
        timeout: SANDBOX_SLICE_MS,
      })
    : await Sandbox.create({ ...credentials(), runtime: "node24", timeout: SANDBOX_SLICE_MS });

  try {
    if (!snapshotId) {
      // Không có ảnh dựng sẵn thì phải dựng tại chỗ: thư viện hệ thống, playwright-core, và
      // cả một bản Chromium. Việc này diễn ra TRONG sandbox chứ không trong function, nên
      // nó không ăn vào trần 60 giây — nhưng nó ăn vào chính thời gian sống của VM, và một
      // lát ngắn có thể tiêu gần hết ngân sách chỉ để dựng. Hãy tạo ảnh (xem README).
      await sandbox.runCommand("sh", [
        "-c",
        `sudo dnf install -y --skip-broken ${CHROMIUM_SYSTEM_DEPS.join(" ")} >/dev/null 2>&1 || true; sudo ldconfig || true; ` +
          `npm init -y >/dev/null 2>&1; npm install playwright-core@${PLAYWRIGHT_VERSION} >/dev/null 2>&1; ` +
          `npx --yes playwright@${PLAYWRIGHT_VERSION} install chromium >/dev/null 2>&1`,
      ]);
    }

    await sandbox.writeFiles([
      { path: "worker.mjs", content: Buffer.from(SANDBOX_WORKER_SOURCE, "utf8") },
      ...(await engineFiles()),
    ]);

    // detached: trả về ngay lập tức. VM tiếp tục chạy tới khi xong việc hoặc hết timeout.
    await sandbox.runCommand({
      cmd: "node",
      args: ["worker.mjs"],
      detached: true,
      env: {
        WEB_URL: base,
        WORKER_TOKEN: token,
        WORKER_ID: `sandbox-${Date.now().toString(36)}`,
        // Tự thoát trước khi VM bị giết, để kịp báo cáo thay vì biến mất giữa chừng.
        BUDGET_MS: String(SANDBOX_SLICE_MS - 45_000),
      },
    });

    return { launched: true, reason: "Đã thả linh sứ sandbox — nó sẽ tự nhận việc." };
  } catch (err) {
    // Chỉ dọn VM khi KHÔNG thả được. Thả rồi mà stop() là tự tay giết linh sứ vừa gửi đi.
    await sandbox.stop().catch(() => {});
    throw err;
  }
}

/**
 * Bộ thông dịch nhiệm vụ, gửi sang VM nguyên vẹn thành tệp.
 *
 * Cố ý KHÔNG nhúng thành chuỗi như worker bên dưới. Worker là ~60 dòng chỉ nói giao thức và
 * gần như không đổi; engine là hơn nghìn dòng chứa toàn bộ tri thức về site, và một bản sao
 * dán trong chuỗi sẽ trôi khỏi bản gốc ngay lần sửa selector đầu tiên. Gửi thẳng tệp nghĩa
 * là VM chạy đúng đoạn mã mà worker máy nhà chạy, không có bản thứ hai nào để lệch.
 *
 * `profile.json` đi cùng vì `profile.mjs` đọc nó lúc chạy — thiếu nó thì engine lên VM mà
 * không mang theo nhiệm vụ nào.
 */
const ENGINE_FILES = [
  "boardScripts.mjs",
  "cooldown.mjs",
  "engine.mjs",
  "profile.mjs",
  "profile.json",
  "runCycle.mjs",
  "session.mjs",
];

async function engineFiles() {
  // `outputFileTracingIncludes` trong next.config.ts là thứ giữ cho thư mục này còn nằm
  // trong bundle của function — Next không tự đoán ra được, vì không dòng import nào trỏ
  // tới đây: chúng chỉ được ĐỌC rồi gửi đi nơi khác.
  const dir = path.join(process.cwd(), "src", "lib", "quest-engine");
  return Promise.all(
    ENGINE_FILES.map(async (name) => ({
      path: `quest-engine/${name}`,
      content: await readFile(path.join(dir, name)),
    })),
  );
}

/**
 * Mã nguồn của worker chạy BÊN TRONG sandbox — nhúng thành chuỗi vì VM không có repo này.
 *
 * Giữ nó ngắn và không phụ thuộc gì ngoài Node cùng engine gửi kèm: mọi thứ nó cần là
 * `fetch` và giao thức bốn thao tác.
 */
const SANDBOX_WORKER_SOURCE = String.raw`
const WEB_URL = process.env.WEB_URL.replace(/\/$/, "");
const TOKEN = process.env.WORKER_TOKEN;
const WORKER_ID = process.env.WORKER_ID;
const BUDGET_MS = Number(process.env.BUDGET_MS ?? 420000);
const deadline = Date.now() + BUDGET_MS;

const call = async (op, payload = {}) => {
  const res = await fetch(WEB_URL + "/api/worker", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer " + TOKEN },
    body: JSON.stringify({ op, ...payload }),
  });
  if (!res.ok) throw new Error(op + " -> HTTP " + res.status + " " + (await res.text()));
  return res.json();
};

const say = (jobId, message, level = "info") =>
  call("event", { jobId, level, message }).catch(() => {});

async function runQuest(job, shouldStop) {
  const { chromium } = await import("playwright-core");
  const { runCycle } = await import("./quest-engine/runCycle.mjs");

  await say(job.id, "Linh sứ sandbox đã dựng xong lư đỉnh.", "success");

  // config.gameCookie đã được giải mã ở /api/worker. Ngân sách truyền vào để engine dừng
  // TỬ TẾ giữa hai nhiệm vụ thay vì biến mất cùng VM giữa một trận.
  return runCycle({
    chromium,
    config: job.config ?? {},
    say: (message, level) => say(job.id, message, level),
    shouldStop,
    budgetMs: Math.max(0, deadline - Date.now()),
  });
}

(async () => {
  // Nhận việc; hàng chờ rỗng thì tắt ngay cho đỡ tốn VM.
  let job = null;
  for (const runner of ["sandbox", "local"]) {
    ({ job } = await call("claim", { workerId: WORKER_ID, runner }));
    if (job) break;
  }
  if (!job) { console.log("hàng chờ rỗng"); return; }

  let stopping = false;
  const beat = setInterval(async () => {
    try {
      const { status } = await call("heartbeat", { jobId: job.id });
      if (status === "stopping" || status === "stopped") stopping = true;
    } catch {}
  }, 20000);

  try {
    // shouldStop ĐỒNG BỘ: engine gọi nó trong vòng lặp chặt, nên nó phải là phép đọc biến
    // chứ không phải một lời hứa — một Promise ở đây luôn truthy và sẽ dừng lượt ngay lập tức.
    const result = await runQuest(job, () => stopping);
    await call("complete", { jobId: job.id, ...result });
  } catch (err) {
    await call("complete", {
      jobId: job.id, outcome: "failed", message: "Đàn pháp gặp trắc trở: " + err.message,
    }).catch(() => {});
  } finally {
    clearInterval(beat);
  }
})();
`;
