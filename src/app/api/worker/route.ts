import { NextResponse } from "next/server";
import { isAdminUser } from "@/lib/auth/permissions";
import { z } from "zod";
import { authorizeWorker } from "@/lib/auth/worker";
import {
  addEvent,
  claimNextJob,
  completeWorkerCycle,
  dailyQuotaPlan,
  heartbeat,
  jobBelongsTo,
} from "@/lib/services/jobs";
import { recordWorkerSeen } from "@/lib/services/workers";
import {
  configSchema,
  enforceMazeCapPolicy,
  enforceUnavailableQuestPolicy,
  recordDetectedAccountTierForJob,
  seedLuyenDanThuong,
  storedConfigSchema,
} from "@/lib/services/configs";
import { getAppSettings } from "@/lib/services/settings";
import { findById } from "@/lib/services/users";
import { decryptSecret, isEncrypted } from "@/lib/crypto/secretBox";

/**
 * Giao thức khôi lỗi — MỘT endpoint, phân nhánh theo `op`.
 *
 * Gộp làm một thay vì năm route riêng là có chủ ý: cả năm thao tác dùng chung đúng một
 * cách xác thực, chung một hình thù request/response, và chúng luôn thay đổi cùng nhau
 * (thêm một trường vào heartbeat là đụng cả worker lẫn server). Một file giữ giao thức nằm
 * gọn trong một màn hình, và worker chỉ cần biết một URL.
 *
 * Xác thực trả về SCOPE chứ không phải có/không: khôi lỗi tông môn (WORKER_TOKEN) đụng
 * được mọi job, khôi lỗi riêng (linh phù) chỉ đụng được job của chủ mình. Claim đã lọc
 * trong SQL; bốn op còn lại đi qua `jobBelongsTo` — hai lớp, lớp nào thủng vẫn còn lớp kia.
 *
 * Năm thao tác dựng nên vòng đời một lượt chạy:
 *   claim     — xin việc; trả về job kèm config snapshot, hoặc null nếu hàng chờ trống.
 *   heartbeat — "tôi còn sống", kèm tiến độ vòng này; trả về status HIỆN TẠI để worker biết
 *               người dùng đã bấm thu đàn.
 *   accountTier — hạng vừa chứng minh trên hub, để giao diện khóa tab đối nghịch.
 *   event     — một dòng nhật ký cho người dùng đọc.
 *   complete  — kết thúc một VÒNG; server tái xếp job, trừ khi người dùng đã Thu Đàn.
 */

const bodySchema = z.discriminatedUnion("op", [
  // `runner` cũ của worker đời trước vẫn được CHẤP NHẬN nhưng bị bỏ qua — một khôi lỗi chưa
  // cập nhật không nên vỡ chỉ vì server đi trước nó một bản.
  z.object({
    op: z.literal("claim"),
    workerId: z.string().min(1).max(64),
    runner: z.string().optional(),
  }),
  z.object({
    op: z.literal("heartbeat"),
    jobId: z.string().uuid(),
    /**
     * Vòng này đang chạy nhiệm vụ nào — thứ Hàng Đợi Công Việc hiển thị. Khôi lỗi đời cũ
     * không gửi, và VẮNG MẶT phải khác RỖNG: vắng là "tôi không biết" (giữ nguyên cột), rỗng
     * là "đang giữa hai nhiệm vụ" (ghi đè). Zod `.optional()` giữ đúng ranh giới ấy.
     *
     * Trần ở đây không phải cho khôi lỗi của chúng ta — nó gửi tên nhiệm vụ lấy từ hồ sơ, dài
     * nhất khoảng ba chục ký tự. Nó dành cho một linh phù cá nhân bị dùng để bơm rác: đây là
     * dữ liệu do người dùng điều khiển đi thẳng lên màn hình của CẢ TÔNG MÔN, nên độ dài và
     * số lượng phải có trần trước khi chạm database. (React tự escape nên không có đường
     * chèn mã; cái cần chặn là một dòng hàng đợi dài một cây số.)
     */
    progress: z
      .object({
        running: z.array(z.string().trim().min(1).max(120)).max(32),
        done: z.number().int().min(0).max(999),
        total: z.number().int().min(0).max(999),
      })
      .optional(),
  }),
  z.object({
    op: z.literal("accountTier"),
    jobId: z.string().uuid(),
    tier: z.enum(["vip", "free"]),
  }),
  z.object({
    op: z.literal("event"),
    jobId: z.string().uuid(),
    // "warn" là cách engine gọi mức cảnh báo (OUTCOME_TEXT, các say(..., "warn") trong
    // runCycle) — khôi lỗi ĐÃ CÀI ngoài kia vẫn gửi nguyên chữ đó. Từ chối nó là âm thầm vứt
    // mọi dòng cảnh báo của họ; nhận rồi dịch về "warning" ở dưới thì không ai phải cài lại.
    level: z.enum(["info", "success", "warning", "error", "warn"]).default("info"),
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
    /**
     * Nhiệm vụ ngày vừa chứng minh là hết lượt trong vòng này, và NGÀY mà lời khai ấy thuộc
     * về (nguyên văn cái server phát ở `claim`). Cả hai đều optional: khôi lỗi đời cũ không
     * gửi, và với chúng tính năng chỉ đơn giản là không có — không có gì vỡ.
     *
     * Trần ở đây gác cùng một cửa với `progress`: linh phù cá nhân là dữ liệu do người dùng
     * điều khiển. ID nhiệm vụ dài nhất trong hồ sơ là 26 ký tự và cả hồ sơ có 22 nhiệm vụ,
     * nên 64 × 64 đã rộng gấp nhiều lần thực tế mà vẫn chặn được một lượt bơm rác vào jsonb.
     * Giá trị lạ lọt qua đây cũng vô hại: engine lọc lại theo `DAILY_QUOTA_QUEST_IDS` trước
     * khi bỏ qua bất cứ nhiệm vụ nào.
     */
    dailyCapQuestIds: z.array(z.string().trim().min(1).max(64)).max(64).optional(),
    dailyDay: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
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
      // Điểm danh ở claim — op dày nhịp nhất, và là op duy nhất một khôi lỗi NHÀN RỖI vẫn
      // gọi đều — nên "đang trực" nghĩa là tiến trình còn sống, không phải nó đang bận.
      await recordWorkerSeen(body.workerId, scope);

      // Bế quan trùng tu: đóng ĐÚNG MỘT cánh cửa này. Bốn op còn lại (heartbeat, event,
      // accountTier, complete) mở nguyên, nên vòng đang chạy dở về đích đàng hoàng, kể xong
      // câu chuyện của nó, rồi completeWorkerCycle tái xếp job vào hàng — nơi claim sẽ không
      // phát ra nữa. Đó chính là "cho job dang dở hoàn thành rồi mới dừng": không cần dừng
      // ai cả, chỉ cần thôi phát việc mới. Trùng tu xong, mọi đàn tự chạy tiếp, không ai
      // phải bấm lại Khai Đàn. Điểm danh vẫn ghi ở trên — khôi lỗi đang trực chứ không chết,
      // sổ trực mà báo "vắng" trong lúc trùng tu là dashboard tự bịa thêm một sự cố.
      const settings = await getAppSettings();
      if (settings.maintenance.active) {
        return NextResponse.json({ job: null });
      }

      const job = await claimNextJob(body.workerId, scope);
      if (!job) {
        return NextResponse.json({ job: null });
      }

      // ĐÂY là điểm duy nhất cookie rời khỏi phong bì. Nó xảy ra sau khi khôi lỗi đã chứng
      // minh danh tính (token tông môn hoặc linh phù của đúng chủ job), và đi tiếp trên
      // HTTPS tới một máy sắp dùng chính cookie đó để đăng nhập — không sớm hơn một dòng nào.
      //
      // seedLuyenDanThuong TRƯỚC parse, bắt buộc: snapshot này không đi qua readStored —
      // claimNextJob và completeWorkerCycle chép THÔ user_configs.config bằng SQL. Document
      // cũ chưa tách Luyện Đan mà parse trần thì Zod điền default enabled=false cho bản
      // thường — mọi tài khoản thường đang luyện đan tắt ngầm ngay sau deploy.
      const snapshot = storedConfigSchema.safeParse(seedLuyenDanThuong(job.configSnapshot));
      const storedConfig = snapshot.success ? snapshot.data : storedConfigSchema.parse({});
      const cookie =
        storedConfig.gameCookie.length > 0 && isEncrypted(storedConfig.gameCookie)
          ? decryptSecret(storedConfig.gameCookie)
          : storedConfig.gameCookie;
      const config = configSchema.parse({ ...storedConfig, gameCookie: cookie });

      // Luật nhà của khôi lỗi tông môn, áp ở ĐÂY chứ không chỉ lúc lưu ngọc giản.
      //
      // Lúc lưu chỉ chạm được những người còn bấm nút; document đã nằm sẵn trong database
      // với `capCheck: false` từ trước luật này thì không đường ghi nào với tới, và chủ nó
      // sẽ cứ thế đánh hết lượt Mê Cung trên máy chung cho tới ngày họ tình cờ mở trang cấu
      // hình. Cửa phát việc là chỗ duy nhất mọi vòng chạy đều đi qua.
      //
      // Gác theo SCOPE vì luật nói về CÁI MÁY, không phải về con người: khôi lỗi riêng chạy
      // trên máy của chính đạo hữu, họ tiêu tài nguyên của mình và không ai phải xếp hàng
      // sau lưng. Chỉ ghế chung mới có luật chung.
      //
      // Một phép đọc thêm cho mỗi lần PHÁT ĐƯỢC việc (không phải mỗi nhịp hỏi việc), tra
      // theo khoá chính. Không tìm thấy chủ thì coi như người thường — luật siết, không nới.
      let guarded = config;
      if (scope.kind === "operator") {
        const owner = await findById(job.userId);
        guarded = enforceMazeCapPolicy(config, { isAdmin: owner !== null && isAdminUser(owner) });
      }

      // Nhiệm vụ chưa hiệu chỉnh thì tắt cho MỌI scope, không riêng ghế chung: luật này không
      // nói về tài nguyên mà về việc engine đi bấm theo nhãn ĐOÁN — chạy trên máy nhà đạo hữu
      // cũng sai y như vậy. Áp ở đây thì một cấu hình đã bật từ trước, nằm im trong database,
      // cũng không lọt được ra vòng chạy nào.
      guarded = enforceUnavailableQuestPolicy(guarded);

      // Tên miền game ghép vào ĐÂY, cùng chỗ và cùng lý do với cookie: nó là sự thật của
      // TOÀN HỆ THỐNG tại thời điểm phát việc, không phải thứ đông lạnh trong snapshot của
      // job (job có thể đã nằm trong hàng chờ từ trước khi trưởng môn đổi tên miền). Ghép ở
      // cửa phát việc nghĩa là mọi khôi lỗi, ở mọi máy, dùng tên miền mới ngay từ vòng kế —
      // không cài lại, không sửa env, không deploy.
      return NextResponse.json({
        job: {
          id: job.id,
          userId: job.userId,
          config: { ...guarded, gameCookie: cookie, gameBaseUrl: settings.game.baseUrl },
          // Sổ đủ lượt hôm nay của chính đàn này. Sổ mang ngày cũ ra khỏi đây thành sổ trắng,
          // nên khôi lỗi không cần biết gì về múi giờ — nó chỉ đọc danh sách và trả lại `day`
          // nguyên văn ở `complete`.
          dailyDone: dailyQuotaPlan(job.dailyDone),
        },
      });
    }

    case "heartbeat": {
      if (!(await jobBelongsTo(body.jobId, scope))) {
        return NextResponse.json({ error: "forbidden" }, { status: 403 });
      }

      const beat = await heartbeat(body.jobId, body.progress);
      if (!beat) {
        return NextResponse.json({ error: "unknown job" }, { status: 404 });
      }

      // Nhịp tim CŨNG là điểm danh: một khôi lỗi đang bận thì thôi không claim nữa, nên nếu
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

      await addEvent(body.jobId, body.level === "warn" ? "warning" : body.level, body.message);
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
        // Thiếu MỘT trong hai thì lời khai không dùng được: danh sách mà không có ngày thì
        // không biết nó thuộc về hôm nào, còn ngày mà không có danh sách thì chẳng có gì để
        // ghi. Cả hai ca ấy đều là khôi lỗi đời cũ, và với chúng sổ đứng yên.
        body.dailyDay && body.dailyCapQuestIds?.length
          ? { day: body.dailyDay, questIds: body.dailyCapQuestIds }
          : undefined,
      );
      if (!transition) {
        return NextResponse.json({ error: "job is no longer active" }, { status: 409 });
      }
      return NextResponse.json({ ok: true, ...transition });
    }
  }
}
