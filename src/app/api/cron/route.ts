import { NextResponse } from "next/server";
import {
  addEvent,
  claimNextJob,
  completeJob,
  failoverToLocal,
  heartbeat,
  reapStaleJobs,
} from "@/lib/services/jobs";
import { configSchema } from "@/lib/services/configs";
import { decryptSecret, isEncrypted } from "@/lib/crypto/secretBox";
import { runSandboxSlice } from "@/lib/runners/sandbox";

/**
 * Nhịp tim của linh sứ SANDBOX.
 *
 * Sandbox không tự đi tìm việc như worker máy nhà — nó không phải một tiến trình đang sống,
 * mà là một VM được dựng lên theo yêu cầu. Nên Vercel Cron đóng vai người gõ cửa: cứ mỗi
 * phút, route này nhận đúng MỘT job sandbox đang chờ và chạy một lát cho nó.
 *
 * Một job mỗi nhịp là có chủ ý: mỗi lát là một VM thật đang tính tiền, và một function của
 * Vercel cũng có trần thời gian riêng. Nhiều job chờ thì chúng lần lượt được phục vụ ở các
 * nhịp sau — chậm hơn, nhưng không bao giờ dựng một lúc mười VM rồi bị cắt giữa chừng cả
 * mười.
 */
export const maxDuration = 300;

export async function GET(request: Request) {
  // Vercel Cron gọi kèm header này; ngoài ra chấp nhận CRON_SECRET để gọi tay lúc thử.
  const isVercelCron = request.headers.get("user-agent")?.includes("vercel-cron") ?? false;
  const secret = process.env.CRON_SECRET;
  const authorized =
    isVercelCron ||
    (secret ? request.headers.get("authorization") === `Bearer ${secret}` : false);

  if (!authorized) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Dọn dẹp trước: job chết và job không ai nhận đều được kết thúc tử tế ở đây, nên hệ
  // thống tự lành kể cả khi không ai mở dashboard.
  await reapStaleJobs();

  const workerId = `sandbox-${Date.now().toString(36)}`;
  const job = await claimNextJob(workerId, "sandbox");
  if (!job) {
    return NextResponse.json({ claimed: null });
  }

  const parsed = configSchema.safeParse(job.configSnapshot);
  const config = parsed.success ? parsed.data : configSchema.parse({});
  const cookie =
    config.gameCookie.length > 0 && isEncrypted(config.gameCookie)
      ? decryptSecret(config.gameCookie)
      : config.gameCookie;

  try {
    const result = await runSandboxSlice({
      config: { ...config, gameCookie: cookie },
      // Kể ngay khi xảy ra, không đợi hết lát: một lát tám phút mà im lặng suốt thì người
      // dùng không phân biệt được "đang chạy" với "đã treo".
      onEvent: (level, message) => void addEvent(job.id, level, message),
    });

    if (result.finished) {
      await completeJob(job.id, result.ok ? "done" : "failed", result.message);
    } else {
      // Còn dở: trả về hàng chờ để nhịp cron sau chạy tiếp.
      await heartbeat(job.id);
      await addEvent(job.id, "info", `${result.message} — sẽ chạy tiếp ở nhịp sau.`);
    }

    return NextResponse.json({ claimed: job.id, finished: result.finished });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    // Ba lát liên tiếp không xong thì đây không còn là xui: sandbox không dựng được (thiếu
    // quota, thiếu biến môi trường, Chromium không lên). Đổi sang linh sứ máy nhà thay vì
    // đốt thêm VM — người dùng không phải làm gì, chỉ cần có worker đang trực.
    if (job.attempts >= 3) {
      await failoverToLocal(job.id, `Sandbox thất bại ${job.attempts} lát liên tiếp (${message})`);
    } else {
      await completeJob(job.id, "failed", `Lát sandbox lỗi: ${message}`);
    }

    return NextResponse.json({ claimed: job.id, error: message }, { status: 200 });
  }
}
