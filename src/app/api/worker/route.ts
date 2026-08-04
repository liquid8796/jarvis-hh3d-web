import { NextResponse } from "next/server";
import { z } from "zod";
import { authorizeWorker } from "@/lib/auth/worker";
import { addEvent, claimNextJob, completeWorkerCycle, heartbeat, jobBelongsTo } from "@/lib/services/jobs";
import { recordWorkerSeen } from "@/lib/services/workers";
import {
  configSchema,
  recordDetectedAccountTierForJob,
  storedConfigSchema,
} from "@/lib/services/configs";
import { decryptSecret, isEncrypted } from "@/lib/crypto/secretBox";

/**
 * Giao thức linh sứ — MỘT endpoint, phân nhánh theo `op`.
 *
 * Gộp làm một thay vì năm route riêng là có chủ ý: cả năm thao tác dùng chung đúng một
 * cách xác thực, chung một hình thù request/response, và chúng luôn thay đổi cùng nhau
 * (thêm một trường vào heartbeat là đụng cả worker lẫn server). Một file giữ giao thức nằm
 * gọn trong một màn hình, và worker chỉ cần biết một URL.
 *
 * Xác thực trả về SCOPE chứ không phải có/không: linh sứ tông môn (WORKER_TOKEN) đụng
 * được mọi job, linh sứ riêng (linh phù) chỉ đụng được job của chủ mình. Claim đã lọc
 * trong SQL; bốn op còn lại đi qua `jobBelongsTo` — hai lớp, lớp nào thủng vẫn còn lớp kia.
 *
 * Năm thao tác dựng nên vòng đời một lượt chạy:
 *   claim     — xin việc; trả về job kèm config snapshot, hoặc null nếu hàng chờ trống.
 *   heartbeat — "tôi còn sống"; trả về status HIỆN TẠI để worker biết người dùng đã bấm thu đàn.
 *   accountTier — hạng vừa chứng minh trên hub, để giao diện khóa tab đối nghịch.
 *   event     — một dòng nhật ký cho người dùng đọc.
 *   complete  — kết thúc một VÒNG; server tái xếp job, trừ khi người dùng đã Thu Đàn.
 */

const bodySchema = z.discriminatedUnion("op", [
  // `runner` cũ của worker đời trước vẫn được CHẤP NHẬN nhưng bị bỏ qua — một linh sứ chưa
  // cập nhật không nên vỡ chỉ vì server đi trước nó một bản.
  z.object({
    op: z.literal("claim"),
    workerId: z.string().min(1).max(64),
    runner: z.string().optional(),
  }),
  z.object({ op: z.literal("heartbeat"), jobId: z.string().uuid() }),
  z.object({
    op: z.literal("accountTier"),
    jobId: z.string().uuid(),
    tier: z.enum(["vip", "free"]),
  }),
  z.object({
    op: z.literal("event"),
    jobId: z.string().uuid(),
    level: z.enum(["info", "success", "warning", "error"]).default("info"),
    message: z.string().min(1).max(2000),
  }),
  z.object({
    op: z.literal("complete"),
    jobId: z.string().uuid(),
    outcome: z.enum(["done", "failed", "stopped"]),
    message: z.string().min(1).max(2000),
    // Worker mới đọc cooldown thật của cả vòng; worker cũ không gửi trường này và server
    // dùng nhịp an toàn mặc định, nên deploy web là đủ để bản đang cài cũng tự lặp.
    nextDelaySeconds: z.number().int().min(30).max(24 * 3600).optional(),
  }),
]);

export async function POST(request: Request) {
  const scope = await authorizeWorker(request);
  if (!scope) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "invalid body" },
      { status: 400 },
    );
  }

  const body = parsed.data;

  switch (body.op) {
    case "claim": {
      // Điểm danh ở claim — op dày nhịp nhất, và là op duy nhất một linh sứ NHÀN RỖI vẫn
      // gọi đều — nên "đang trực" nghĩa là tiến trình còn sống, không phải nó đang bận.
      await recordWorkerSeen(body.workerId, scope);

      const job = await claimNextJob(body.workerId, scope);
      if (!job) {
        return NextResponse.json({ job: null });
      }

      // ĐÂY là điểm duy nhất cookie rời khỏi phong bì. Nó xảy ra sau khi linh sứ đã chứng
      // minh danh tính (token tông môn hoặc linh phù của đúng chủ job), và đi tiếp trên
      // HTTPS tới một máy sắp dùng chính cookie đó để đăng nhập — không sớm hơn một dòng nào.
      const snapshot = storedConfigSchema.safeParse(job.configSnapshot);
      const storedConfig = snapshot.success ? snapshot.data : storedConfigSchema.parse({});
      const cookie =
        storedConfig.gameCookie.length > 0 && isEncrypted(storedConfig.gameCookie)
          ? decryptSecret(storedConfig.gameCookie)
          : storedConfig.gameCookie;
      const config = configSchema.parse({ ...storedConfig, gameCookie: cookie });

      return NextResponse.json({
        job: { id: job.id, userId: job.userId, config: { ...config, gameCookie: cookie } },
      });
    }

    case "heartbeat": {
      if (!(await jobBelongsTo(body.jobId, scope))) {
        return NextResponse.json({ error: "forbidden" }, { status: 403 });
      }

      const beat = await heartbeat(body.jobId);
      if (!beat) {
        return NextResponse.json({ error: "unknown job" }, { status: 404 });
      }

      // Nhịp tim CŨNG là điểm danh: một linh sứ đang bận thì thôi không claim nữa, nên nếu
      // chỉ claim mới ghi sổ thì nó biến mất khỏi sổ đúng lúc làm việc chăm chỉ nhất.
      if (beat.workerId) {
        await recordWorkerSeen(beat.workerId, scope);
      }

      // `stopping` là tín hiệu người dùng đã bấm Thu Đàn; worker tự kết thúc ở điểm an toàn.
      return NextResponse.json({ status: beat.status });
    }

    case "accountTier": {
      if (!(await jobBelongsTo(body.jobId, scope))) {
        return NextResponse.json({ error: "forbidden" }, { status: 403 });
      }

      await recordDetectedAccountTierForJob(body.jobId, body.tier);
      return NextResponse.json({ ok: true });
    }

    case "event": {
      if (!(await jobBelongsTo(body.jobId, scope))) {
        return NextResponse.json({ error: "forbidden" }, { status: 403 });
      }

      await addEvent(body.jobId, body.level, body.message);
      return NextResponse.json({ ok: true });
    }

    case "complete": {
      if (!(await jobBelongsTo(body.jobId, scope))) {
        return NextResponse.json({ error: "forbidden" }, { status: 403 });
      }

      const transition = await completeWorkerCycle(
        body.jobId,
        body.outcome,
        body.message,
        body.nextDelaySeconds,
      );
      if (!transition) {
        return NextResponse.json({ error: "job is no longer active" }, { status: 409 });
      }
      return NextResponse.json({ ok: true, ...transition });
    }
  }
}
