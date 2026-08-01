import { NextResponse } from "next/server";
import { z } from "zod";
import { authorizeWorker } from "@/lib/auth/worker";
import { addEvent, claimNextJob, completeJob, heartbeat } from "@/lib/services/jobs";

/**
 * Giao thức linh sứ — MỘT endpoint, phân nhánh theo `op`.
 *
 * Gộp làm một thay vì bốn route riêng là có chủ ý: cả bốn thao tác dùng chung đúng một
 * cách xác thực, chung một hình thù request/response, và chúng luôn thay đổi cùng nhau
 * (thêm một trường vào heartbeat là đụng cả worker lẫn server). Một file giữ giao thức nằm
 * gọn trong một màn hình, và worker chỉ cần biết một URL.
 *
 * Bốn thao tác dựng nên vòng đời một lượt chạy:
 *   claim     — xin việc; trả về job kèm config snapshot, hoặc null nếu hàng chờ trống.
 *   heartbeat — "tôi còn sống"; trả về status HIỆN TẠI để worker biết người dùng đã bấm thu đàn.
 *   event     — một dòng nhật ký cho người dùng đọc.
 *   complete  — kết thúc, kèm lý do.
 */

const bodySchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("claim"), workerId: z.string().min(1).max(64) }),
  z.object({ op: z.literal("heartbeat"), jobId: z.string().uuid() }),
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
  }),
]);

export async function POST(request: Request) {
  if (!authorizeWorker(request)) {
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
      const job = await claimNextJob(body.workerId);
      return NextResponse.json(
        job
          ? { job: { id: job.id, userId: job.userId, config: job.configSnapshot } }
          : { job: null },
      );
    }

    case "heartbeat": {
      const status = await heartbeat(body.jobId);
      if (!status) {
        return NextResponse.json({ error: "unknown job" }, { status: 404 });
      }

      // `stopping` là tín hiệu người dùng đã bấm Thu Đàn; worker tự kết thúc ở điểm an toàn.
      return NextResponse.json({ status });
    }

    case "event": {
      await addEvent(body.jobId, body.level, body.message);
      return NextResponse.json({ ok: true });
    }

    case "complete": {
      await completeJob(body.jobId, body.outcome, body.message);
      return NextResponse.json({ ok: true });
    }
  }
}
