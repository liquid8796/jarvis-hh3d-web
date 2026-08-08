#!/usr/bin/env node
/**
 * KHÔI LỖI THAM CHIẾU — reference worker.
 *
 * Đây là nửa còn lại của lời hứa "bấm Khai Đàn rồi tắt browser vẫn chạy". Vercel không thể
 * giữ một phiên Chromium 35 phút: function của nó sống theo request và bị cắt sau vài phút.
 * Nên web chỉ làm control plane — nó GIỮ ý định của người dùng trong database — còn việc
 * mở browser thật thì do tiến trình này làm, trên một cái máy chạy liên tục (VPS, máy nhà,
 * Fly.io, Railway… bất cứ chỗ nào chạy được Node dài hạn).
 *
 * Vòng đời một vòng: xin việc → nhận config snapshot → chạy → kể chuyện qua `event` → nhịp
 * tim mỗi 5 giây (và nghe xem người dùng có bấm Thu Đàn không) → báo kết quả. Server đặt
 * `nextRunAt` rồi trả cùng job về hàng chờ; worker cũ lẫn mới đều tự nhận vòng kế.
 *
 * Phần điều khiển trình duyệt là engine dùng chung ở `src/lib/quest-engine` — cùng bộ thông
 * dịch và cùng hồ sơ quest với bản desktop, nên tri thức về site chỉ có một bản gốc.
 *
 * Token quyết định VAI TRÒ, server tự phân xử — worker không cần khai gì:
 *   • WORKER_TOKEN của deployment (khôi lỗi tông môn) → nhận job của mọi thành viên.
 *   • Linh phù cá nhân phát ở mục Khôi Lỗi           → chỉ nhận job của chính chủ.
 *
 *   WEB_URL=https://<app>.vercel.app WORKER_TOKEN=... node scripts/worker.mjs
 */

import { fileURLToPath } from "node:url";
import { mkdir } from "node:fs/promises";
import { runCycle } from "../src/lib/quest-engine/runCycle.mjs";
import { profileDirForJob } from "../src/lib/quest-engine/browserProfile.mjs";

const WEB_URL = (process.env.WEB_URL ?? "http://localhost:3000").replace(/\/$/, "");
const TOKEN = process.env.WORKER_TOKEN;
const WORKER_ID = process.env.WORKER_ID ?? `linh-su-${process.pid}`;
const POLL_MS = Number(process.env.WORKER_POLL_MS ?? 5000);
// Năm giây là ranh giới người dùng còn cảm thấy nút Thu Đàn phản hồi tức thời. Cho phép chỉnh
// để máy chủ riêng có thể tiết chế request, nhưng không nhận giá trị vô lý làm quay nóng CPU.
const HEARTBEAT_MS = Math.max(1_000, Number(process.env.WORKER_HEARTBEAT_MS ?? 5_000) || 5_000);
// Số job (= số tài khoản) chạy CÙNG LÚC trong một tiến trình khôi lỗi. Mỗi job là một
// Chromium riêng nên trần này là trần RAM: 2 vừa cho máy nhà, VM tông môn có thể nâng qua
// biến môi trường. Kẹp 1–8 để một dấu phẩy gõ nhầm không mở tám mươi trình duyệt.
const MAX_JOBS = Math.max(1, Math.min(8, Number(process.env.WORKER_MAX_JOBS ?? 2) || 2));

if (!TOKEN || TOKEN === "change-me") {
  console.error("WORKER_TOKEN chưa đặt — dùng linh phù phát ở mục Khôi Lỗi, hoặc token tông môn.");
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
  // Engine nói "warn", giao thức nói "warning" — dịch ở đây, một chỗ duy nhất. Không dịch
  // thì mọi dòng cảnh báo bị API trả 400 và catch bên dưới nuốt mất, người dùng vĩnh viễn
  // không thấy cảnh báo nào trong nhật ký.
  call("event", { jobId, level: level === "warn" ? "warning" : level, message }).catch(() => {
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
 * Gốc chứa hồ sơ Chromium bền, nằm NGAY CẠNH worker: token cf_clearance mà Cloudflare cấp
 * sau một lần kiểm tra sống trong hồ sơ, nên các lượt sau đi thẳng qua cổng thay vì trình
 * diện lại như người lạ. Bên dưới gốc này, mỗi (user + cookie đã lưu) có một profile riêng:
 * tài khoản của job trước tuyệt đối không được chảy sang job sau.
 */
const PROFILE_ROOT = fileURLToPath(new URL("./browser-profiles/", import.meta.url));

async function runQuest({ userId, config, say, reportAccountTier, reportProgress, shouldStop }) {
  await say("Khôi lỗi đã nhận ngọc giản, đang khởi lư…");

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

  const profileDir = profileDirForJob(PROFILE_ROOT, {
    userId,
    gameCookie: config?.gameCookie,
  });
  await mkdir(profileDir, { recursive: true });
  return runCycle({ chromium, config, say, reportAccountTier, reportProgress, shouldStop, profileDir });
}

/** Một lượt trọn vẹn: nhịp tim chạy nền, engine chạy trước, kết thúc thì báo cáo. */
async function handle(job) {
  console.log(`→ nhận job ${job.id}`);

  let stopping = false;

  // Tiến độ vòng này, cưỡi nhịp tim sẵn có — không thêm một request nào. Engine cập nhật
  // biến này (đồng bộ, trong đường chạy nóng), nhịp tim kế tiếp mang nó đi; trễ tối đa đúng
  // một nhịp, mà một nhịp là 5 giây trên một vòng thường dài hàng chục phút.
  //
  // `null` cho tới khi engine khai lần đầu, và `null` KHÔNG BAO GIỜ được gửi lên: với server,
  // vắng trường này nghĩa là "khôi lỗi đời cũ, giữ nguyên cột đang có" — gửi null sẽ biến nó
  // thành một lệnh xoá lặp lại mỗi 5 giây.
  let progress = null;

  const beat = setInterval(async () => {
    try {
      const { status } = await call("heartbeat", {
        jobId: job.id,
        ...(progress ? { progress } : {}),
      });
      // Bất kỳ trạng thái nào KHÔNG phải 'running' đều nghĩa là không còn ai chờ lượt này:
      // 'stopping/stopped' là Thu Đàn, còn 'failed/done' là reaper đã kết liễu job (mất
      // liên lạc dài rồi nối lại) — ôm browser chạy nốt một vòng không ai nhận chỉ tổ
      // claim đè lên vòng kế.
      if (status !== "running") {
        stopping = true;
      }
    } catch (err) {
      console.error("  nhịp tim lỗi:", err.message);
      // 404 = job không còn tồn tại (tài khoản bị xoá kéo job theo); 403 = không còn thuộc
      // quyền mình. Cả hai đều nghĩa là không còn ai chờ kết quả — dừng ở điểm an toàn kế,
      // đừng ôm browser chạy nốt một vòng không ai nhận.
      if (/HTTP 40[34]\b/.test(err.message)) {
        stopping = true;
      }
    }
  }, HEARTBEAT_MS);

  try {
    const result = await runQuest({
      userId: job.userId,
      config: job.config,
      say: (message, level) => say(job.id, message, level),
      reportAccountTier: (tier) =>
        call("accountTier", { jobId: job.id, tier }).catch((err) => {
          console.error("  không lưu được hạng tài khoản:", err.message);
        }),
      reportProgress: (next) => {
        progress = next;
      },
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

console.log(`Khôi lỗi「${WORKER_ID}」đang canh ${WEB_URL} (tối đa ${MAX_JOBS} đàn cùng lúc)`);

// Nhiều job cùng lúc, mỗi job một Chromium — để một đạo hữu nuôi nhiều tài khoản thấy cả
// đội chạy song song thay vì xếp hàng sau lưng nhau. `running` giữ các lượt đang bận; còn
// ghế trống thì hỏi việc tiếp NGAY (không ngủ) cho tới khi hàng chờ cạn hoặc ghế đầy.
// Việc giành job giữa nhiều khôi lỗi vẫn do Postgres phân xử như cũ.
const running = new Set();

for (;;) {
  let claimed = false;

  if (running.size < MAX_JOBS) {
    try {
      const { job } = await call("claim", { workerId: WORKER_ID });
      if (job) {
        claimed = true;
        // handle() tự nuốt mọi lỗi của chính nó (kể cả lỗi báo cáo complete), nên promise
        // này không bao giờ reject — Set chỉ để đếm ghế.
        const seat = handle(job).finally(() => running.delete(seat));
        running.add(seat);
      }
    } catch (err) {
      console.error("claim lỗi:", err.message);
    }
  }

  if (!claimed) {
    await sleep(POLL_MS);
  }
}
