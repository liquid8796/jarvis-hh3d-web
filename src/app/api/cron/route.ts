import { NextResponse } from "next/server";
import { db, schema } from "@/lib/db/client";
import { and, eq, sql } from "drizzle-orm";
import { purgeExpiredChat } from "@/lib/services/chat";
import { reapStaleJobs } from "@/lib/services/jobs";
import { launchSandboxWorker } from "@/lib/runners/sandbox";
import { sandboxAvailable } from "@/lib/runners/policy";

/**
 * Người gõ cửa cho linh sứ sandbox — và là người quét dọn.
 *
 * Route này CỐ Ý nhẹ. Nó không chạy nhiệm vụ, không chờ browser, không giữ kết nối: chỉ
 * dựng một sandbox rồi thả cho nó tự đi làm (xem runners/sandbox.ts). Lý do là trần thời
 * gian của function — 60 giây trên gói Hobby — không bao giờ đủ để ôm một lát tám phút.
 * Đảo vai như vậy khiến giới hạn ấy trở nên vô hại.
 *
 * Gọi từ đâu cũng được:
 *   • Vercel Cron — gói Hobby chỉ 1 lần/ngày (đủ để quét dọn, không đủ để lái automation).
 *   • Dịch vụ cron ngoài (cron-job.org…) mỗi phút, kèm `Authorization: Bearer CRON_SECRET`.
 *   • Chính server, ngay khi người dùng bấm Khai Đàn — đường nhanh nhất, không phải chờ nhịp.
 */
export const maxDuration = 60;

export async function GET(request: Request) {
  const isVercelCron = request.headers.get("user-agent")?.includes("vercel-cron") ?? false;
  const secret = process.env.CRON_SECRET;
  const authorized =
    isVercelCron ||
    (secret ? request.headers.get("authorization") === `Bearer ${secret}` : false);

  if (!authorized) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Quét dọn trước — job chết và job không ai nhận đều được kết thúc tử tế ở đây, nên hệ
  // thống tự lành kể cả khi không ai mở dashboard. Tin đàm đạo quá hạn lưu (tông chủ đặt
  // số ngày trong trang Tông Môn) cũng bị quét cùng nhịp; kho chưa tạo thì đây là no-op.
  await reapStaleJobs();
  await purgeExpiredChat();

  const result = await ensureSandboxWorker();
  return NextResponse.json(result);
}

/**
 * Thả một linh sứ sandbox NẾU đang có việc chờ và sandbox được bật.
 *
 * Tách khỏi handler để server action "Khai Đàn" gọi thẳng — bấm nút là VM dựng ngay, người
 * dùng không phải đợi nhịp cron kế tiếp. An toàn khi gọi trùng: sandbox tự `claim`, mà
 * claim là một câu UPDATE nguyên tử, nên hai linh sứ cùng lúc chỉ một người lấy được việc.
 */
export async function ensureSandboxWorker(): Promise<{
  launched: boolean;
  reason: string;
}> {
  if (!sandboxAvailable()) {
    return { launched: false, reason: "Sandbox đang tắt (SANDBOX_ENABLED khác 1)." };
  }

  const waiting = await db()
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.automationJobs)
    .where(
      and(eq(schema.automationJobs.status, "queued"), eq(schema.automationJobs.runner, "sandbox")),
    );

  if ((waiting[0]?.n ?? 0) === 0) {
    return { launched: false, reason: "Hàng chờ sandbox rỗng." };
  }

  try {
    return await launchSandboxWorker();
  } catch (err) {
    // Không dựng được VM thì nói thẳng, và để job nằm lại hàng chờ: reaper sẽ kết thúc nó
    // với lời giải thích nếu mãi không ai nhận.
    return {
      launched: false,
      reason: `Không dựng được sandbox: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
