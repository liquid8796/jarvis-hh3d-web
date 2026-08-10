"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { requireAdmin } from "@/lib/auth/guards";
import { hasPermission } from "@/lib/auth/permissions";
import { decryptSecret } from "@/lib/crypto/secretBox";
import { countJobsForDrain } from "@/lib/services/jobs";
import { getAppSettings, saveAppSettings, type AppSettings } from "@/lib/services/settings";
import { notifyDashboard } from "@/lib/realtime/dashboardChannel";
import {
  CONTROL_DOC_KEY,
  signControlDoc,
  type ControlDoc,
} from "@/lib/control/doc";
import { readControlDoc } from "@/lib/control/read";
import {
  SYNC_PAGE_SIZE,
  SYNC_TABLE_ORDER,
  connect,
  copyTablePage,
  resetSequences,
  truncateAll,
  verifyTable,
} from "@/lib/mirror/pgSync";
import { syncMongo } from "@/lib/mirror/mongoSync";
import { resetPromotedStation } from "@/lib/mirror/promote";
import { canFlip, canSwitch } from "@/lib/mirror/switchGuard";

/**
 * Máy trạng thái chuyển trạm — deploy/mirror/README.md §6.
 *
 * ĐI TỪNG BƯỚC, do trang admin lái: mỗi lượt gọi làm đúng một việc rồi trả quyền điều khiển
 * về. Bản thiết kế ban đầu định giao việc đồng bộ cho VM qua giao thức khôi lỗi; đổi sang lối
 * này (10/08/2026) vì thứ mà "chạy trên VM" định giải quyết — trần thời gian của function —
 * giải được rẻ hơn nhiều bằng chia lô, mà lại không phải thêm op vào giao thức, không phải
 * cài lại VM, và credential không phải đi thêm một chặng mạng nào.
 *
 * LUẬT SỐNG CÒN: bảng điều phối chỉ được lật ở `flipSwitchAction`, và chỉ khi phase đã là
 * `done` — tức đã verify xanh. Hỏng ở bất kỳ bước nào trước đó thì trạm cũ vẫn đang phục vụ
 * và không ai nhìn thấy gì.
 */

export type SwitchResult = { ok: boolean; message: string };

export type SwitchView = {
  phase: AppSettings["mirrorSwitch"]["phase"];
  targetId: string;
  targetName: string;
  note: string;
  startedAt: string | null;
  updatedAt: string | null;
  copiedRows: number;
  /** Bảng đang chép, để trang admin kể chuyện thay vì quay một vòng tròn vô nghĩa. */
  currentTable: string;
  tableIndex: number;
  tableCount: number;
  drain: { running: number; queued: number };
  /** SITE_ID của chính trạm đang phục vụ trang này. Rỗng nếu deploy chưa khai. */
  currentSiteId: string;
  /** Trạm này CÓ PHẢI trạm đang hoạt động không — chỉ nó mới được phát lệnh chuyển. */
  isActiveSite: boolean;
  /** Sổ đã có entry cho chính trạm này chưa. Thiếu là cụt đường về sau khi chuyển đi. */
  selfInBook: boolean;
};

async function requireSiteSwitch() {
  const user = await requireAdmin();
  if (!hasPermission(user, "site.switch")) {
    throw new Error("Chỉ Gia chủ mới phát được lệnh chuyển trạm.");
  }
  return user;
}

function stamp(settings: AppSettings, patch: Partial<AppSettings["mirrorSwitch"]>): void {
  settings.mirrorSwitch = { ...settings.mirrorSwitch, ...patch, updatedAt: new Date().toISOString() };
}

async function persist(settings: AppSettings): Promise<void> {
  await saveAppSettings(settings);
  revalidatePath("/admin");
}

/**
 * Trạm chạy đoạn mã này có phải trạm ĐANG HOẠT ĐỘNG không.
 *
 * Quan trọng hơn vẻ ngoài: `/admin` được middleware MIỄN TRỪ chuyển hướng (để admin còn cửa
 * quay lui), nên trang này mở được trên một trạm đã nghỉ. Mà `stepSwitchAction` lấy nguồn từ
 * `DATABASE_URL` của chính trạm đang chạy — phát lệnh từ trạm nghỉ nghĩa là chép một database
 * đứng yên từ lần lật trước ĐÈ LÊN trạm đích. Đó là mất dữ liệu thật, nên phải chặn từ cổng.
 *
 * Bảng chưa init (doc = null) thì coi như trạm này đang hoạt động: lúc ấy chưa có khái niệm
 * "trạm khác", và fail-open là luật nền của cả tầng điều phối.
 */
async function activeSiteCheck(): Promise<{ currentSiteId: string; isActive: boolean; activeSiteId: string }> {
  const currentSiteId = (process.env.SITE_ID ?? "").trim();
  const doc = await readControlDoc();
  if (!doc) return { currentSiteId, isActive: true, activeSiteId: "" };
  return { currentSiteId, isActive: doc.activeSiteId === currentSiteId, activeSiteId: doc.activeSiteId };
}

function mirrorOf(settings: AppSettings, id: string) {
  const entry = settings.mirrors.find((m) => m.id === id);
  if (!entry) throw new Error(`Trạm「${id}」không còn trong sổ — lượt chuyển không đi tiếp được.`);
  return entry;
}

export async function switchStateForAdmin(): Promise<SwitchView> {
  await requireSiteSwitch();
  const [settings, site] = await Promise.all([getAppSettings(), activeSiteCheck()]);
  const s = settings.mirrorSwitch;
  return {
    phase: s.phase,
    targetId: s.targetId,
    targetName: settings.mirrors.find((m) => m.id === s.targetId)?.name ?? s.targetId,
    note: s.note,
    startedAt: s.startedAt,
    updatedAt: s.updatedAt,
    copiedRows: s.copiedRows,
    currentTable: SYNC_TABLE_ORDER[s.tableIndex] ?? "",
    tableIndex: s.tableIndex,
    tableCount: SYNC_TABLE_ORDER.length,
    drain: await countJobsForDrain(),
    currentSiteId: site.currentSiteId,
    isActiveSite: site.isActive,
    selfInBook: site.currentSiteId !== "" && settings.mirrors.some((m) => m.id === site.currentSiteId),
  };
}

/**
 * Mở lượt chuyển: bật bảo trì để đóng cửa phát việc, rồi chờ đàn đang chạy đi hết vòng.
 *
 * Bảo trì bật ở đây chứ không phải lúc chép: đàn nhận sau khi ta bắt đầu chép sẽ ghi vào
 * database NGUỒN và không bao giờ sang được đích — đóng cửa trước là cách duy nhất để cái
 * ta chép là một bức ảnh đứng yên.
 */
export async function beginSwitchAction(_prev: SwitchResult | null, formData: FormData): Promise<SwitchResult> {
  await requireSiteSwitch();
  const targetId = String(formData.get("targetId") ?? "").trim();
  const confirm = String(formData.get("confirm") ?? "").trim();

  const settings = await getAppSettings();
  if (settings.mirrorSwitch.phase !== "idle" && settings.mirrorSwitch.phase !== "failed") {
    return { ok: false, message: `Đang có lượt chuyển dở (${settings.mirrorSwitch.phase}) — xong hoặc huỷ nó trước.` };
  }

  const entry = settings.mirrors.find((m) => m.id === targetId);
  if (!entry) return { ok: false, message: `Không có trạm「${targetId}」trong sổ.` };
  // Gõ lại tên là hàng rào cuối trước một thao tác bứng cả tông môn sang tài khoản khác.
  if (confirm !== entry.id) {
    return { ok: false, message: `Gõ đúng mã trạm「${entry.id}」vào ô xác nhận thì mới đi tiếp.` };
  }

  // Toàn bộ luật "ai được phát lệnh, đi đâu" nằm ở canSwitch() — hàm thuần, verify:control
  // bao từng nhánh. Ở đây chỉ là chỗ nối dây.
  const site = await activeSiteCheck();
  const gate = canSwitch({
    currentSiteId: site.currentSiteId,
    activeSiteId: site.activeSiteId || null,
    targetId: entry.id,
    knownIds: settings.mirrors.map((m) => m.id),
  });
  if (!gate.allowed) return { ok: false, message: gate.message };

  const now = new Date();
  settings.maintenance = {
    active: true,
    startedAt: now.toISOString(),
    expectedEndAt: new Date(now.getTime() + 90 * 60_000).toISOString(),
    note: `Chuyển tàng thư sang trạm「${entry.name}」. Cửa phát việc tạm đóng — đàn đang chạy vẫn đi hết vòng.`,
  };
  stamp(settings, {
    phase: "draining",
    targetId: entry.id,
    startedAt: now.toISOString(),
    note: "Đã đóng cửa phát việc, đang chờ đàn đang chạy đi hết vòng.",
    tableIndex: 0,
    rowOffset: 0,
    copiedRows: 0,
  });
  await persist(settings);
  await notifyDashboard({ userId: "*", topic: "config" });
  return { ok: true, message: `Đã mở lượt chuyển sang「${entry.name}」. Chờ đàn cạn rồi bấm tiếp.` };
}

/**
 * Một NHỊP của máy trạng thái. Trang admin gọi lặp cho tới khi phase là `done` hoặc `failed`.
 *
 * Mỗi nhịp làm đúng một việc nhỏ — chờ drain, chép một trang, verify một bảng — nên không
 * nhịp nào chạm trần thời gian function, và thanh tiến độ trên trang là tiến độ THẬT chứ
 * không phải một vòng quay trang trí.
 */
export async function stepSwitchAction(): Promise<SwitchResult> {
  await requireSiteSwitch();
  // Kiểm lại MỖI NHỊP, không chỉ lúc mở lượt: mỗi nhịp là một request riêng, và giữa hai nhịp
  // thì bảng điều phối có thể đã bị lật bởi một lượt khác (hoặc bằng CLI).
  const site = await activeSiteCheck();
  if (!site.isActive) {
    return { ok: false, message: `Trạm này không còn là trạm hoạt động (giờ là「${site.activeSiteId}」) — dừng lượt chuyển.` };
  }
  const settings = await getAppSettings();
  const state = settings.mirrorSwitch;

  if (state.phase === "idle" || state.phase === "done" || state.phase === "failed") {
    return { ok: false, message: `Không có nhịp nào để chạy (phase = ${state.phase}).` };
  }

  const entry = mirrorOf(settings, state.targetId);

  try {
    // ---- draining: chờ đàn đang chạy về 0 -------------------------------------------------
    if (state.phase === "draining") {
      const drain = await countJobsForDrain();
      if (drain.running > 0) {
        stamp(settings, { note: `Còn ${drain.running} đàn đang chạy nốt vòng (${drain.queued} chờ).` });
        await persist(settings);
        return { ok: true, message: `Còn ${drain.running} đàn đang chạy — chờ thêm.` };
      }
      // Đàn đã cạn: dọn đích MỘT LẦN rồi bước sang chép.
      const dest = connect(decryptSecret(entry.pg));
      await truncateAll(dest);
      stamp(settings, {
        phase: "syncing",
        tableIndex: 0,
        rowOffset: 0,
        copiedRows: 0,
        note: "Đàn đã cạn, đã dọn sạch database đích. Bắt đầu chép.",
      });
      await persist(settings);
      return { ok: true, message: "Đàn đã cạn — đã dọn đích, bắt đầu chép." };
    }

    // ---- syncing: chép một trang ----------------------------------------------------------
    if (state.phase === "syncing") {
      const src = connect(process.env.DATABASE_URL!);
      const dest = connect(decryptSecret(entry.pg));

      if (state.tableIndex >= SYNC_TABLE_ORDER.length) {
        // Hết bảng: Mongo và sequence là hai việc cuối của giai đoạn chép.
        const seq = await resetSequences(src, dest);
        const mongo = await syncMongo(process.env.MONGODB_URI!, decryptSecret(entry.mongo));
        const bad = mongo.collections.filter((m) => !m.ok);
        if (bad.length > 0) {
          stamp(settings, {
            phase: "failed",
            note: `Mongo lệch: ${bad.map((m) => `${m.collection} nguồn ${m.srcCount}/đích ${m.destCount}`).join(", ")}`,
          });
          await persist(settings);
          return { ok: false, message: "Đồng bộ Mongo lệch số lượng — dừng, bảng điều phối chưa lật." };
        }
        stamp(settings, {
          phase: "verifying",
          tableIndex: 0,
          note: `Đã chép xong Postgres + Mongo (db「${mongo.srcDb}」→「${mongo.destDb}」: ${mongo.collections.map((m) => `${m.collection}=${m.copied}`).join(", ")}); sequence: ${seq.join(", ") || "không có"}. Đang đối chiếu.`,
        });
        await persist(settings);
        return { ok: true, message: "Chép xong — sang bước đối chiếu." };
      }

      const table = SYNC_TABLE_ORDER[state.tableIndex];
      const copied = await copyTablePage(src, dest, table, state.rowOffset, SYNC_PAGE_SIZE);
      if (copied < SYNC_PAGE_SIZE) {
        // Trang cuối của bảng này (kể cả trang rỗng) — sang bảng kế.
        stamp(settings, {
          tableIndex: state.tableIndex + 1,
          rowOffset: 0,
          copiedRows: state.copiedRows + copied,
          note: `Xong ${table} (+${copied}).`,
        });
      } else {
        stamp(settings, {
          rowOffset: state.rowOffset + copied,
          copiedRows: state.copiedRows + copied,
          note: `Đang chép ${table}: ${state.rowOffset + copied} dòng.`,
        });
      }
      await persist(settings);
      return { ok: true, message: `${table}: +${copied} dòng.` };
    }

    // ---- verifying: đối chiếu từng bảng ---------------------------------------------------
    if (state.phase === "verifying") {
      const src = connect(process.env.DATABASE_URL!);
      const dest = connect(decryptSecret(entry.pg));

      if (state.tableIndex >= SYNC_TABLE_ORDER.length) {
        stamp(settings, { phase: "done", note: "Đối chiếu xanh toàn bộ. Sẵn sàng lật bảng điều phối." });
        await persist(settings);
        return { ok: true, message: "Đối chiếu xanh — bấm「Lật sang trạm mới」để hoàn tất." };
      }

      const table = SYNC_TABLE_ORDER[state.tableIndex];
      const verdict = await verifyTable(src, dest, table);
      if (!verdict.ok) {
        stamp(settings, { phase: "failed", note: `Đối chiếu ${table} hỏng: ${verdict.detail}` });
        await persist(settings);
        return { ok: false, message: `${table}: ${verdict.detail} — dừng, bảng điều phối chưa lật.` };
      }
      stamp(settings, { tableIndex: state.tableIndex + 1, note: `Đối chiếu ${table}: ${verdict.detail}` });
      await persist(settings);
      return { ok: true, message: `${table}: ${verdict.detail}` };
    }

    return { ok: false, message: `Phase lạ: ${state.phase}` };
  } catch (err) {
    // Mọi đường hỏng đều đổ về `failed` KÈM LỜI KỂ — một lượt chuyển chết câm là thứ không ai
    // gỡ được, còn bảng điều phối thì vẫn nguyên nên tông môn không hề hấn gì.
    const message = err instanceof Error ? err.message : "lỗi lạ";
    const fresh = await getAppSettings();
    stamp(fresh, { phase: "failed", note: `Hỏng ở ${state.phase}: ${message.slice(0, 400)}` });
    await persist(fresh);
    return { ok: false, message: `Hỏng ở bước ${state.phase}: ${message.slice(0, 200)}` };
  }
}

/**
 * Lật bảng điều phối — bước KHÔNG ĐẢO NGƯỢC BẰNG MỘT CÚ BẤM (đảo được, nhưng bằng một lượt
 * chuyển ngược đầy đủ). Chỉ chạy khi phase = `done`.
 *
 * Thứ tự bên trong quan trọng: tắt bảo trì ở ĐÍCH trước, rồi mới ghi bảng. Trạng thái bảo trì
 * vừa được chép sang cùng dữ liệu, nên nếu lật trước thì tông môn sang trạm mới và gặp ngay
 * bảng bế quan của chính lượt chuyển vừa xong. Trạm CŨ thì giữ nguyên bảo trì — ai lách được
 * qua redirect cũng chỉ gặp bảng bế quan, đúng ý.
 */
export async function flipSwitchAction(): Promise<SwitchResult> {
  const user = await requireSiteSwitch();
  const site = await activeSiteCheck();
  const settings = await getAppSettings();
  const state = settings.mirrorSwitch;

  // Toàn bộ luật "được lật hay chưa" nằm ở canFlip() — hàm thuần, verify:control bao từng
  // nhánh. Ở đây chỉ là chỗ nối dây, đúng như beginSwitchAction làm với canSwitch().
  const gate = canFlip({
    currentSiteId: site.currentSiteId,
    activeSiteId: site.activeSiteId || null,
    targetId: state.targetId,
    phase: state.phase,
  });
  if (!gate.allowed) return { ok: false, message: gate.message };
  const entry = mirrorOf(settings, state.targetId);

  const workerToken = (process.env.WORKER_TOKEN ?? "").trim();
  const region = (process.env.OCI_REGION ?? "").trim();
  const namespace = (process.env.OCI_NAMESPACE ?? "").trim();
  const bucket = (process.env.OCI_BUCKET ?? "").trim();
  if (!workerToken || !region || !namespace || !bucket) {
    return { ok: false, message: "Thiếu WORKER_TOKEN hoặc cấu hình OCI — không ký/ghi được bảng điều phối." };
  }

  try {
    // Dọn trạm SẮP LÊN THAY: tắt bế quan + đặt mirrorSwitch về idle. Luật nằm ở
    // mirror/promote.ts vì `mirror:control set` — đường thoát hiểm bằng dòng lệnh — phải để
    // lại đúng trạng thái ấy; hai đường lật mà dọn khác nhau là một cái bẫy đặt đúng vào lúc
    // tệ nhất. Ghi TRƯỚC khi lật bảng: lật xong mới dọn thì tông môn sang trạm mới và gặp
    // ngay bảng bế quan của chính lượt chuyển vừa xong.
    await resetPromotedStation(connect(decryptSecret(entry.pg)), site.activeSiteId);

    const current = await readControlDoc();
    const doc: ControlDoc = signControlDoc(
      {
        revision: (current?.revision ?? 0) + 1,
        activeSiteId: entry.id,
        activeUrl: entry.url.replace(/\/$/, ""),
        switchedAt: new Date().toISOString(),
        switchedBy: user.id,
      },
      workerToken,
    );

    const { PutObjectCommand, S3Client } = await import("@aws-sdk/client-s3");
    const client = new S3Client({
      region,
      endpoint: `https://${namespace}.compat.objectstorage.${region}.oraclecloud.com`,
      credentials: {
        accessKeyId: (process.env.OCI_ACCESS_KEY_ID ?? "").trim(),
        secretAccessKey: (process.env.OCI_SECRET_ACCESS_KEY ?? "").trim(),
      },
      forcePathStyle: true,
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    });
    try {
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: CONTROL_DOC_KEY,
          Body: JSON.stringify(doc, null, 2),
          ContentType: "application/json",
          CacheControl: "no-store",
        }),
      );
    } finally {
      client.destroy();
    }

    stamp(settings, {
      phase: "done",
      note: `Đã lật sang「${entry.name}」(revision ${doc.revision}) lúc ${doc.switchedAt}.`,
    });
    await persist(settings);
    return {
      ok: true,
      message: `Đã lật sang「${entry.name}」— revision ${doc.revision}. Trong ~30 giây mọi trạm sẽ theo bảng mới.`,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "lỗi lạ";
    return { ok: false, message: `Lật bảng hỏng: ${message.slice(0, 200)} — bảng có thể chưa đổi, soi bằng mirror:control status.` };
  }
}

/** Huỷ lượt chuyển: mở cửa lại và về idle. Dữ liệu đã chép sang đích cứ để đó — lượt sau dọn. */
export async function abortSwitchAction(): Promise<SwitchResult> {
  await requireSiteSwitch();
  const settings = await getAppSettings();
  if (settings.mirrorSwitch.phase === "idle") return { ok: false, message: "Không có lượt chuyển nào để huỷ." };

  settings.maintenance = { active: false, startedAt: null, expectedEndAt: null, note: "" };
  stamp(settings, { phase: "idle", targetId: "", note: "", tableIndex: 0, rowOffset: 0, copiedRows: 0, startedAt: null });
  await persist(settings);
  await notifyDashboard({ userId: "*", topic: "config" });
  return { ok: true, message: "Đã huỷ lượt chuyển và mở cửa tông môn lại." };
}
