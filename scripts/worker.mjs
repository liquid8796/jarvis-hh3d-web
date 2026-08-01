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
 * Phần THỰC SỰ điều khiển trình duyệt cố ý để trống: nó là engine của bản desktop
 * (JarvisHH3D) và sẽ được cắm vào đây qua `runQuest()`. Mọi thứ quanh nó — giao thức, nhịp
 * tim, dừng an toàn, tường thuật — đã hoàn chỉnh và chạy được ngay.
 *
 *   WEB_URL=https://<app>.vercel.app WORKER_TOKEN=... node scripts/worker.mjs
 */

const WEB_URL = (process.env.WEB_URL ?? "http://localhost:3000").replace(/\/$/, "");
const TOKEN = process.env.WORKER_TOKEN;
const WORKER_ID = process.env.WORKER_ID ?? `linh-su-${process.pid}`;
const POLL_MS = Number(process.env.WORKER_POLL_MS ?? 5000);
/**
 * Loại job worker này chịu nhận, ưu tiên theo thứ tự liệt kê.
 *
 * Mặc định nhận CẢ HAI: trên gói Hobby của Vercel, cron chỉ chạy được 1 lần/ngày nên
 * chẳng có ai lái job `sandbox` cả — nếu worker chỉ nhận `local` thì mọi job sandbox sẽ
 * nằm chờ tới lúc bị reaper kết liễu. Một máy đang trực thì cứ nhận hết, hơn là để job mục
 * trong hàng. Muốn tách vai trò thì đặt WORKER_RUNNERS=local.
 */
const RUNNERS = (process.env.WORKER_RUNNERS ?? "local,sandbox")
  .split(",")
  .map((r) => r.trim())
  .filter((r) => r === "local" || r === "sandbox");
const HEARTBEAT_MS = 20_000;

if (!TOKEN || TOKEN === "change-me") {
  console.error("WORKER_TOKEN chưa đặt — phải trùng với biến cùng tên trên Vercel.");
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
 * CHỖ CẮM ENGINE.
 *
 * `shouldStop()` trả về true ngay khi người dùng bấm Thu Đàn — hãy gọi nó ở các điểm an
 * toàn (giữa hai bước, giữa hai vòng lặp), đúng như engine desktop chỉ dừng giữa các step
 * chứ không bao giờ dừng giữa một cú click.
 */
async function runQuest({ config, say, shouldStop }) {
  await say("Linh sứ đã nhận ngọc giản, đang khởi lư…");

  const quests = [];
  if (config?.quests?.meCung?.enabled) quests.push("Mê Cung");
  if (config?.quests?.luyenDan?.enabled) quests.push("Luyện Đan Đường");

  if (quests.length === 0) {
    return { outcome: "done", message: "Không có nhiệm vụ nào được bật — kết thúc lượt." };
  }

  await say(`Sẽ hành sự: ${quests.join(" · ")}.`, "success");

  // ---- TODO: cắm engine Playwright của bản desktop vào đây ------------------
  // Vòng chờ dưới đây là chỗ giữ nhịp: nó chứng minh trọn vẹn đường đi của giao thức
  // (nhịp tim, lệnh dừng, tường thuật) mà chưa đụng tới game thật.
  for (let i = 1; i <= 100; i++) {
    if (await shouldStop()) {
      return { outcome: "stopped", message: "Đã thu đàn theo lệnh đạo hữu." };
    }

    await sleep(3000);
    if (i % 5 === 0) {
      await say(`Đang vận hành… (nhịp ${i})`);
    }
  }

  return { outcome: "done", message: "Đã đi hết một vòng nhiệm vụ." };
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
      shouldStop: async () => stopping,
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

console.log(`Linh sứ「${WORKER_ID}」đang canh ${WEB_URL} — nhận job: ${RUNNERS.join(", ")}`);

// Một job một lúc, tuần tự — một máy chỉ nuôi nổi một browser cho ra hồn. Muốn chạy song
// song thì mở thêm tiến trình với WORKER_ID khác; việc giành job đã được Postgres phân xử.
for (;;) {
  try {
    // Hỏi lần lượt từng loại; loại đầu có việc là làm ngay.
    let job = null;
    for (const runner of RUNNERS) {
      ({ job } = await call("claim", { workerId: WORKER_ID, runner }));
      if (job) break;
    }

    if (job) {
      await handle(job);
      continue;
    }
  } catch (err) {
    console.error("claim lỗi:", err.message);
  }

  await sleep(POLL_MS);
}
