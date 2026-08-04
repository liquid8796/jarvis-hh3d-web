import { eq, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { decryptSecret, encryptSecret, isEncrypted } from "@/lib/crypto/secretBox";
import { notifyDashboard } from "@/lib/realtime/dashboardChannel";
import { z } from "zod";

/**
 * The per-user automation config. Stored as one JSONB document (see schema.ts for why) but
 * VALIDATED here at the edge of the system, so garbage can never reach a worker. The shape
 * mirrors the desktop app's quest options — the two products stay conceptually one tool.
 *
 * Nested groups use `.prefault({})`, not `.default({})`: in Zod 4 a `.default()` must be the
 * fully-formed OUTPUT, while `.prefault()` supplies the INPUT that then flows through each
 * field's own default. That distinction is what lets a brand-new user — whose JSONB column
 * is literally `{}` — parse into a complete config instead of a validation error.
 */
/** Hình thù chung của một nhiệm vụ chỉ có công tắc bật/tắt. */
const simpleQuest = z.object({ enabled: z.boolean().default(false) }).prefault({});

export const configSchema = z.object({
  /** The hoathinh3d login cookie bundle the worker automates with. */
  gameCookie: z.string().trim().max(8000).default(""),
  /** Hạng do worker chứng minh trên hub; null = cookie này chưa được dò. */
  accountTier: z.enum(["vip", "free"]).nullable().default(null),
  /**
   * DI SẢN — từ v0.11 mọi lượt chạy đều do worker sống dai đảm nhiệm, không còn lựa chọn
   * nơi chạy. Trường vẫn nằm trong schema vì document cũ đã mang nó (Zod strip là mất
   * round-trip an toàn), nhưng không còn ai đọc giá trị này.
   */
  runner: z.enum(["sandbox", "local"]).default("local"),
  quests: z
    .object({
      meCung: z
        .object({
          enabled: z.boolean().default(false),
          /** is-normal | is-hard | is-nightmare — the site's own mode classes. */
          mode: z.enum(["is-normal", "is-hard", "is-nightmare"]).default("is-normal"),
          /** 0 = never kick; anything else is an HP floor (the desktop's kickHp). */
          kickHp: z.number().int().min(0).max(99_999_999).default(0),
          /**
           * 0 = không trục xuất; N > 0 = thành viên chưa bấm sẵn sàng sau N giây (tính từ
           * lúc linh sứ nhìn thấy họ lần đầu) sẽ bị mời ra — ghế của người không sẵn sàng
           * là ghế người khác không ngồi được. Song sinh với option `kickIdle` bên desktop.
           */
          kickIdleSec: z.number().int().min(0).max(3600).default(0),
          /** Stop when the daily huyền tinh cap is reached. */
          capCheck: z.boolean().default(true),
        })
        .prefault({}),
      /**
       * Mười nhiệm vụ "một công tắc" — đồng bộ đủ bộ từ bản desktop. Chúng không có tuỳ
       * chọn nào ngoài bật/tắt, nhưng vẫn là object (chứ không phải boolean trần) để hôm
       * nào một nhiệm vụ mọc thêm lựa chọn thì document cũ không phải đổi hình thù.
       * Key ở đây ↔ tên nhiệm vụ trong hồ sơ do SIMPLE_QUESTS (quest-engine/profile.mjs)
       * phiên dịch — thêm nhiệm vụ là thêm một dòng ở cả hai bảng.
       */
      diemDanh: simpleQuest,
      hoangVuc: simpleQuest,
      phucLoiDuong: simpleQuest,
      thiLuyen: simpleQuest,
      biCanh: simpleQuest,
      teLe: simpleQuest,
      phucLoiVip: simpleQuest,
      vongQuay: simpleQuest,
      vanDap: simpleQuest,
      khoangMach: simpleQuest,
      luyenDan: z
        .object({
          enabled: z.boolean().default(false),
          tier: z.enum(["Hạ Phẩm", "Trung Phẩm", "Thượng Phẩm", "Cực Phẩm"]).default("Hạ Phẩm"),
          /**
           * Giữ đan từ N sao TRỞ LÊN; phân giải phần còn lại.
           *
           *   0 = phân giải tất cả
           *   1 = giữ tất cả (giữ từ 1 sao trở lên thì chẳng còn gì để phân giải)
           *   2–5 = giữ từ N sao trở lên
           *
           * Đọc kỹ mốc 1 và 5. Đan chỉ rơi 1–4 sao, nên "giữ từ 5 sao" nghĩa là PHÂN GIẢI
           * SẠCH — đúng ngược với "giữ tất cả". Hai giá trị này từng bị hoán chỗ giữa form
           * và lớp dịch, và triệu chứng của nó là mất sạch đan mà không có lỗi nào.
           */
          keepStarsFrom: z.number().int().min(0).max(5).default(0),
        })
        .prefault({}),
    })
    .prefault({}),
});

export type UserConfig = z.infer<typeof configSchema>;
export type AccountTier = NonNullable<UserConfig["accountTier"]>;

/**
 * Hình thù trong database/job snapshot.
 *
 * `configSchema` giới hạn cookie người dùng dán ở 8.000 ký tự. Sau AES-GCM + Base64, cùng
 * plaintext ấy có thể dài hơn 8.000; dùng lại schema plaintext để đọc phong bì sẽ khiến Zod
 * loại CẢ document và âm thầm rơi về config mặc định rỗng. Trần 40.000 bao phủ cả trường hợp
 * xấu nhất của 8.000 UTF-16 code unit sau khi mã hoá, nhưng vẫn chặn dữ liệu phình vô hạn.
 */
export const storedConfigSchema = configSchema.extend({
  gameCookie: z.string().trim().max(40_000).default(""),
});

/**
 * Cấu hình như UI được phép nhìn thấy: mọi thứ, TRỪ cookie.
 *
 * `gameCookie` luôn là chuỗi rỗng ở đây — thay vào đó là `hasCookie`. Đó là chủ ý: một bí
 * mật đã mã hoá at-rest mà vẫn được render vào HTML mỗi lần mở trang thì coi như chưa mã
 * hoá — nó sẽ nằm trong cache trình duyệt, trong lịch sử, trong ảnh chụp màn hình. Nên
 * cookie chỉ đi MỘT CHIỀU: từ người dùng vào database, rồi từ database ra worker.
 */
export type EditableConfig = UserConfig & { hasCookie: boolean };

/** Đọc thô: parse JSONB về đúng hình thù hôm nay, cookie vẫn ở dạng phong bì. */
async function readStored(userId: string): Promise<UserConfig> {
  const rows = await db()
    .select({ config: schema.userConfigs.config })
    .from(schema.userConfigs)
    .where(eq(schema.userConfigs.userId, userId))
    .limit(1);

  // Parsing on the way OUT as well as in: a document written by an older deploy still
  // comes back in today's shape, defaults filled — the JSONB twin of a schema migration.
  const parsed = storedConfigSchema.safeParse(rows[0]?.config ?? {});
  return parsed.success ? parsed.data : storedConfigSchema.parse({});
}

/**
 * Bản để đóng băng cho một vòng: y nguyên như trong database, cookie vẫn trong phong bì.
 * Worker nhận bản đã giải mã từ /api/worker; server làm mới snapshot ở ranh giới vòng kế.
 */
export async function getStoredConfigForSnapshot(userId: string): Promise<UserConfig> {
  return readStored(userId);
}

/** Dành cho trang cấu hình. Không bao giờ chứa cookie. */
export async function getEditableConfig(userId: string): Promise<EditableConfig> {
  const stored = await readStored(userId);
  return { ...stored, gameCookie: "", hasCookie: stored.gameCookie.length > 0 };
}

/**
 * Dành cho lúc khai đàn: cookie đã giải mã, sẵn sàng cho worker.
 *
 * Tên hàm cố tình dài và cụ thể — đây là đường duy nhất trong hệ thống trả về plaintext,
 * nên nó phải nổi bật ở chỗ gọi. Giá trị chưa đóng phong bì (ghi từ trước khi có mã hoá)
 * vẫn đọc được, và lần lưu kế tiếp sẽ tự mã hoá.
 */
export async function getConfigWithSecrets(userId: string): Promise<UserConfig> {
  const stored = await readStored(userId);
  if (stored.gameCookie.length === 0) {
    return stored;
  }

  return configSchema.parse({
    ...stored,
    gameCookie: isEncrypted(stored.gameCookie)
      ? decryptSecret(stored.gameCookie)
      : stored.gameCookie,
  });
}

/**
 * Ghi cấu hình. `gameCookie` rỗng nghĩa là "giữ nguyên cookie cũ" — bắt buộc phải thế, vì
 * form không còn nhận lại cookie để mà gửi lên; nếu rỗng bị hiểu là "xoá" thì mỗi lần sửa
 * độ khó phòng là mất cookie.
 */
export async function saveConfig(userId: string, config: UserConfig): Promise<void> {
  const clean = configSchema.parse(config);
  const previous = await readStored(userId);

  const cookie = clean.gameCookie.trim();
  const replacingAccount = cookie.length > 0;
  const stored = replacingAccount ? encryptSecret(cookie) : previous.gameCookie;

  const document = storedConfigSchema.parse({
    ...clean,
    gameCookie: stored,
    // Một cookie mới có thể thuộc hạng đối nghịch. Chỉ worker nhìn hub mới được quyền
    // phán lại; mọi lần lưu lựa chọn thông thường phải giữ nguyên bằng chứng cũ.
    accountTier: replacingAccount ? null : previous.accountTier,
  });

  await db()
    .insert(schema.userConfigs)
    .values({ userId, config: document, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: schema.userConfigs.userId,
      set: { config: document, updatedAt: sql`now()` },
    });

  if (replacingAccount) {
    await notifyDashboard({ userId, topic: "config" }).catch(() => undefined);
  }
}

/**
 * Chỉ thay tài khoản game, giữ nguyên toàn bộ lựa chọn nhiệm vụ hiện có.
 *
 * Nút "Lưu tài khoản" nằm ngay cạnh ô cookie không được phép vô tình ghi đè những checkbox
 * người dùng mới chỉnh nhưng chưa Khắc Ngọc Giản. Cookie vẫn đi qua cùng lớp schema + mã hóa
 * như đường lưu toàn bộ cấu hình.
 */
export async function saveCookie(userId: string, value: string): Promise<void> {
  const cookie = configSchema.shape.gameCookie.parse(value).trim();
  if (cookie.length === 0) {
    throw new Error("Cookie tài khoản không được để trống.");
  }

  const stored = await readStored(userId);
  const document = storedConfigSchema.parse({
    ...stored,
    gameCookie: encryptSecret(cookie),
    accountTier: null,
  });

  await db()
    .insert(schema.userConfigs)
    .values({ userId, config: document, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: schema.userConfigs.userId,
      set: { config: document, updatedAt: sql`now()` },
    });

  await notifyDashboard({ userId, topic: "config" }).catch(() => undefined);
}

/** Xoá cookie hẳn — đường thoát khi người dùng muốn rút chìa khỏi hệ thống. */
export async function clearCookie(userId: string): Promise<void> {
  const stored = await readStored(userId);
  const document = storedConfigSchema.parse({ ...stored, gameCookie: "", accountTier: null });
  await db()
    .insert(schema.userConfigs)
    .values({ userId, config: document, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: schema.userConfigs.userId,
      set: { config: document, updatedAt: sql`now()` },
    });

  await notifyDashboard({ userId, topic: "config" }).catch(() => undefined);
}

/**
 * Ghi hạng do worker vừa đọc trên hub, theo job đã được route xác thực.
 *
 * JSONB được vá nguyên tử thay vì đọc-rồi-ghi cả document: người dùng có thể bấm lưu quest
 * đúng lúc probe trả lời, và không bên nào được phép ghi đè thay đổi của bên kia. Chỉ phát
 * realtime khi giá trị thực sự đổi để mỗi vòng không tạo một frame SSE thừa.
 */
export async function recordDetectedAccountTierForJob(
  jobId: string,
  tier: AccountTier,
): Promise<void> {
  const changed = await db().execute(sql`
    update user_configs as config_row set
      config = jsonb_set(config_row.config, '{accountTier}', to_jsonb(${tier}::text), true),
      updated_at = now()
    from automation_jobs as job
    where job.id = ${jobId}
      and config_row.user_id = job.user_id
      and config_row.config ->> 'accountTier' is distinct from ${tier}
    returning config_row.user_id
  `);

  const userId = changed.rows?.[0]?.user_id;
  if (typeof userId === "string") {
    await notifyDashboard({ userId, topic: "config" }).catch(() => undefined);
  }
}
