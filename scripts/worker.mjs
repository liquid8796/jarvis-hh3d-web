#!/usr/bin/env node
/**
 * LINH SỨ THAM CHIẾU — reference worker.
 *
 * Đây là nửa còn lại của lời hứa "bấm Khai Đàn rồi tắt browser vẫn chạy". Vercel không thể
 * giữ một phiên Chromium 35 phút: function của nó sống theo request và bị cắt sau vài phút.
 * Nên web chỉ làm control plane — nó GIỮ ý định của người dùng trong database — còn việc
 * mở browser thật thì do tiến trình này làm, trên một cái máy chạy liên tục (VPS, máy nhà,
 * Fly.io, Railway… bất cứ chỗ nào chạy được Node dài hạn).
 *
 * Vòng đời: xin việc → nhận config snapshot → chạy → kể chuyện qua `event` → nhịp tim mỗi
 * 20 giây (và nghe xem người dùng có bấm Thu Đàn không) → báo kết thúc.
 *
 * Phần điều khiển trình duyệt là engine dùng chung ở `src/lib/quest-engine` — cùng bộ thông
 * dịch và cùng hồ sơ quest với bản desktop, nên tri thức về site chỉ có một bản gốc.
 *
 * Token quyết định VAI TRÒ, server tự phân xử — worker không cần khai gì:
 *   • WORKER_TOKEN của deployment (linh sứ tông môn) → nhận job của mọi thành viên.
 *   • Linh phù cá nhân phát ở mục Linh Sứ           → chỉ nhận job của chính chủ.
 *
 *   WEB_URL=https://<app>.vercel.app WORKER_TOKEN=... node scripts/worker.mjs
 */

import { fileURLToPath } from "node:url";
import { runCycle } from "../src/lib/quest-engine/runCycle.mjs";

const WEB_URL = (process.env.WEB_URL ?? "http://localhost:3000").replace(/\/$/, "");
const TOKEN = process.env.WORKER_TOKEN;
const WORKER_ID = process.env.WORKER_ID ?? `linh-su-${process.pid}`;
const POLL_MS = Number(process.env.WORKER_POLL_MS ?? 5000);
const HEARTBEAT_MS = 20_000;

if (!TOKEN || TOKEN === "change-me") {
  console.error("WORKER_TOKEN chưa đặt — dùng linh phù phát ở mục Linh Sứ, hoặc token tông môn.");
  process.exit(1);
}

/** Mọi thao tác đều là một POST tới cùng một endpoint; ở đây gói lại cho gọn. */
async function call(op, payload = {}) {
  const res = await fetch(`${WEB_URL}/api/worker`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ op, ...payload }),
  });

  if (!res.ok) {
    throw new Error(`${op} → HTTP ${res.status} ${await res.text()}`);
  }

  return res.json();
}

const say = (jobId, message, level = "info") =>
  call("event", { jobId, level, message }).catch(() => {
    /* mất một dòng nhật ký không đáng để đánh sập cả lượt chạy */
  });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Chạy một lượt bằng engine thật.
 *
 * `shouldStop()` ĐỒNG BỘ có chủ ý — engine gọi nó trong những vòng lặp chặt (mỗi 300ms khi
 * chờ một điều kiện, mỗi bước trong một repeat), nên nó phải là một phép đọc biến chứ không
 * phải một lời hứa. Nhịp tim nền là thứ cập nhật biến ấy.
 */
/**
 * Hồ sơ Chromium bền, nằm NGAY CẠNH worker: token cf_clearance mà Cloudflare cấp sau một
 * lần kiểm tra sống trong hồ sơ, nên các lượt sau đi thẳng qua cổng thay vì trình diện lại
 * như người lạ. Đặt cạnh worker (chứ không ở temp hay home) để gỡ cài là sạch theo.
 */
const PROFILE_DIR = fileURLToPath(new URL("./browser-profile", import.meta.url));

async function runQuest({ config, say, shouldStop }) {
  await say("Linh sứ đã nhận ngọc giản, đang khởi lư…");

  // Nạp Playwright TẠI ĐÂY chứ không ở đầu tệp: một máy chỉ dùng worker để canh việc vẫn
  // chạy được `node scripts/worker.mjs` mà không cần cài Chromium, và lỗi thiếu thư viện
  // hiện ra như một lượt chạy thất bại có lời giải thích, không phải một tiến trình chết
  // ngay khi khởi động.
  let chromium;
  try {
    ({ chromium } = await import("playwright-core"));
  } catch {
    return {
      outcome: "failed",
      message: "Thiếu playwright-core — chạy `npm install` rồi `npx playwright install chromium`.",
    };
  }

  return runCycle({ chromium, config, say, shouldStop, profileDir: PROFILE_DIR });
}

/** Một lượt trọn vẹn: nhịp tim chạy nền, engine chạy trước, kết thúc thì báo cáo. */
async function handle(job) {
  console.log(`→ nhận job ${job.id}`);

  let stopping = false;
  const beat = setInterval(async () => {
    try {
      const { status } = await call("heartbeat", { jobId: job.id });
      if (status === "stopping" || status === "stopped") {
        stopping = true;
      }
    } catch (err) {
      console.error("  nhịp tim lỗi:", err.message);
    }
  }, HEARTBEAT_MS);

  try {
    const result = await runQuest({
      config: job.config,
      say: (message, level) => say(job.id, message, level),
      shouldStop: () => stopping,
    });
    await call("complete", { jobId: job.id, ...result });
    console.log(`✔ job ${job.id} — ${result.outcome}`);
  } catch (err) {
    await call("complete", {
      jobId: job.id,
      outcome: "failed",
      message: `Đàn pháp gặp trắc trở: ${err.message}`,
    }).catch(() => {});
    console.error(`✗ job ${job.id}:`, err);
  } finally {
    clearInterval(beat);
  }
}

console.log(`Linh sứ「${WORKER_ID}」đang canh ${WEB_URL}`);

// Một job một lúc, tuần tự — một máy chỉ nuôi nổi một browser cho ra hồn. Muốn chạy song
// song thì mở thêm tiến trình với WORKER_ID khác; việc giành job đã được Postgres phân xử.
for (;;) {
  try {
    const { job } = await call("claim", { workerId: WORKER_ID });
    if (job) {
      await handle(job);
      continue;
    }
  } catch (err) {
    console.error("claim lỗi:", err.message);
  }

  await sleep(POLL_MS);
}
