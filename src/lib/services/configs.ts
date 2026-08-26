import { eq, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
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

/**
 * Luyện Đan Đường — MỘT hình thù, HAI bản ghi (`luyenDan` cho hạng VIP, `luyenDanThuong`
 * cho hạng thường). Trước 08/2026 chỉ có một bản dùng chung cho cả hai twin của hồ sơ, và
 * đó chính là lỗi: khắc ngọc giản từ tab VIP là đè luôn lựa chọn của tab Thường và ngược
 * lại — hai hạng muốn luyện hai loại đan khác nhau mà không thể. Tách đôi ở đây, và lớp
 * dịch (quest-engine/profile.mjs) áp mỗi bản cho đúng twin theo `requiresVip`.
 */
const luyenDanQuest = z
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
    /**
     * HẠN MỨC GIỮ ĐAN — chỉ có nghĩa khi `keepStarsFrom` đang giữ lại một bậc sao nào đó.
     *
     * Đếm theo dòng「Đan trong túi (phẩm) x/10 viên」của hộp thông tin viên đan, tức TỔNG đan
     * cùng phẩm đang nằm trong túi, không phân biệt mấy sao. Chọn cách đếm ấy vì nó là con số
     * DUY NHẤT đọc được trọn vẹn trong một lần mở hộp: dòng「Số lượng ô này」chỉ nói về đúng ô
     * đang mở, nên muốn cộng đủ mọi bậc sao thì phải mở lần lượt từng ô — một vòng lặp mà
     * flow này không có, và cũng không đáng dựng cho một hạn mức.
     *
     * `keepCapEnabled` tách riêng khỏi con số vì「chưa đặt hạn mức」và「hạn mức bằng 1」là hai
     * ý khác nhau; nhồi cả hai vào một số 0-là-tắt thì ô nhập phải mang một giá trị nói dối.
     */
    keepCapEnabled: z.boolean().default(false),
    /**
     * Trần 20 buộc phải nhỏ hơn `BAG_COUNT_CEILING` (30) bên quest-engine: lớp dịch rải một
     * mảnh so chuỗi cho TỪNG con số hợp lệ, nên một hạn mức vượt trần ấy sẽ không có mảnh nào
     * nhận ra. Túi đo được là 10 viên mỗi phẩm (bản chụp 12/08/2026 ghi `1/10 viên`), nên 20
     * đã rộng gấp đôi và 30 còn chừa thêm chỗ cho ngày sức chứa ấy nhích lên.
     */
    keepCap: z.number().int().min(1).max(20).default(10),
    /**
     * Chạm hạn mức thì làm gì:
     *
     *   decompose — phân giải viên vượt hạn mức (túi đứng yên ở đúng hạn mức).
     *   stop      — giữ nguyên và THÔI khai lô mới, kiểm lại ở mỗi lượt ghé.
     */
    keepCapMode: z.enum(["decompose", "stop"]).default("decompose"),
  })
  .prefault({});

/**
 * Khoáng Mạch — MỘT hình thù, HAI bản ghi (`khoangMach` cho hạng VIP, `khoangMachThuong`
 * cho hạng thường), cùng bài học tách đôi đã trả giá ở luyenDanQuest: hai hạng có quyền đào
 * hai mỏ khác nhau. Bốn lựa chọn khớp 1-1 với options của hồ sơ quest (dựng từ bản ghi
 * khoang-mach-20260814-133812):
 *
 *   - `mineType`: nút loại khoáng thứ 1/2/3 trên trang (Thượng/Trung/Hạ).
 *   - `mineName`: tên mỏ, chứa-là-khớp sau khi bỏ dấu; RỖNG = đào tiếp mỏ đang ở.
 *   - `hostMode` + `hostMinBonus`: đoạt mỏ khi bonus tu vi của mỏ đạt ngưỡng — mỗi cú đoạt
 *     mua một Linh Quang Phù (tiền thật) nên mặc định TẮT, người bật phải tự đọc giá.
 */
const khoangMachQuest = z
  .object({
    enabled: z.boolean().default(false),
    mineType: z.enum(["1", "2", "3"]).default("2"),
    /**
     * Đích đến là một LITERAL trong nguồn bước evaluateJavaScript của hồ sơ — cùng ranh
     * giới tin cậy với chatMessage, nên cùng một phép làm sạch, không chế phép thứ hai.
     *
     * MẶC ĐỊNH RỖNG, có chủ ý. Rỗng nghĩa là「đào tiếp mỏ đang ở」(xem chú thích đầu khối),
     * tức KHÔNG lùa tài khoản đi đâu cả. Trước đây chỗ này ghim sẵn một tên mỏ, và vì ô nhập
     * lấy `defaultValue` từ chính giá trị đã parse, cái tên ấy hiện ra như thể đạo hữu đã tự
     * gõ — nên người chưa hề chọn mỏ vẫn bị dời sang mỏ của người viết mã. Tên gợi ý nay chỉ
     * còn là `placeholder` của ô, đúng thân phận của nó.
     */
    mineName: z.string().max(1000).default("").transform(sanitizeChatMessage),
    /**
     * Ngưỡng % bonus tu vi của mỏ để CHỐT LỜI — dưới mức này thì phần đã đào cứ treo ở
     * 「Đạt tối đa」chờ lượt sau, không nhận. KHÁC `hostMinBonus` (ngưỡng tiêu tiền để đoạt);
     * 0 = luôn nhận, và đó là mặc định vì mọi ngọc giản đã lưu trước schema 59 không mang
     * khoá này — mặc định phải là「không đổi gì cả」.
     */
    minBonus: z.number().int().min(0).max(500).default(0),
    /**
     * Mua Linh Quang Phù (+20% tu vi, 1 giờ) ngay trước cú chốt lời — TỐI ĐA 1 lá/ngày, suất
     * ngày do engine giữ. Mặc định true giữ đúng hành vi schema 59 (thời hostMode bật là mua
     * kèm); cái mới của schema 60 là suất 1/ngày và quyền tắt hẳn. Tách khỏi `hostMode`: phù
     * phục vụ cú CHỐT LỜI, không riêng gì đoạt.
     */
    buyPhu: z.boolean().default(true),
    hostMode: z.boolean().default(false),
    hostMinBonus: z.number().int().min(0).max(500).default(100),
  })
  .prefault({});

/**
 * Làm sạch một lời nhắn chat trước khi nó rời tầng config.
 *
 * Đích đến của chuỗi này là một LITERAL trong nguồn bước `evaluateJavaScript` của hồ sơ
 * (engine thay `{{chatLobby}}` bằng phép thay chuỗi trần — xem resolveForExecution), nên
 * nháy đơn, nháy kép, backslash, backtick hay ký tự điều khiển đều là đường thoát khỏi
 * literal ấy: nhẹ thì vỡ script và mất lời nhắn, nặng thì lời nhắn TRỞ THÀNH script. Loại
 * tại biên — một nơi, cả hai chiều đọc/ghi — thay vì escape rải rác ở từng chỗ dùng.
 *
 * Trần 200 ký tự là `maxlength` của chính ô #mc-chat-input trên site.
 */
export function sanitizeChatMessage(raw: string): string {
  return raw
    .replace(/["'`\\\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

/** Một lời nhắn đã qua làm sạch; 1000 là trần chống phình trước khi cắt còn 200. */
const chatMessage = z.string().max(1000).default("").transform(sanitizeChatMessage);

/**
 * Ai được cầm đàn của một đạo hữu.
 *
 *   any  — ai rảnh trước thì nhận. Nếp cũ, và là giá trị của MỌI document chưa có trường này.
 *   sect — chỉ khôi lỗi tông môn (token vận hành, VM luôn trực).
 *   mine — chỉ khôi lỗi máy nhà của chính đạo hữu (linh phù).
 *
 * Đây chỉ là chỗ CẤT lựa chọn. Luật thật nằm trong câu SQL của `claimNextJob`: một khôi lỗi
 * không đúng loại thậm chí không NHÌN THẤY đàn ấy trong hàng chờ, nên không có đường nào lách
 * qua bằng cách gọi thẳng API.
 */
export const WORKER_PREFS = ["any", "sect", "mine"] as const;
export const workerPrefSchema = z.enum(WORKER_PREFS);
export type WorkerPref = z.infer<typeof workerPrefSchema>;

export const configSchema = z.object({
  /**
   * Cookie đăng nhập của TÀI KHOẢN mà lượt chạy phục vụ.
   *
   * Từ khi có bảng game_accounts (migration 0009) trường này không còn sống trong
   * user_configs — nó chỉ xuất hiện trong SNAPSHOT của job, nơi server ghép cookie của đúng
   * tài khoản vào cấu hình chung trước khi trao cho khôi lỗi. Giữ trong schema để hình thù
   * config mà worker nhận không đổi, và document cũ còn mang nó vẫn parse lành.
   */
  gameCookie: z.string().trim().max(8000).default(""),
  /**
   * Hạng của TÀI KHOẢN trong snapshot — cùng số phận với gameCookie: nguồn sự thật nằm ở
   * game_accounts.account_tier, trường này chỉ là bản ghép cho engine đọc.
   */
  accountTier: z.enum(["vip", "free"]).nullable().default(null),
  /**
   * Tên miền game của SNAPSHOT — cùng số phận với hai trường trên: nguồn sự thật là
   * `app_settings.game.baseUrl` do trưởng môn đặt, và /api/worker ghép nó vào lúc phát việc.
   *
   * Đi theo từng job thay vì nằm trong env của khôi lỗi, vì khôi lỗi chạy trên máy KHÁC —
   * trên VM tông môn lẫn trên máy nhà của từng đạo hữu. Bắt tên miền đi cùng công việc
   * nghĩa là đổi tên miền là mọi khôi lỗi ngoài kia dùng ngay ở vòng sau, không ai phải cài
   * lại hay sửa env. Rỗng = khôi lỗi tự quyết theo env/hằng số của chính nó, giữ cho bản cài
   * đời cũ và các lượt chạy một-phát không phụ thuộc trường này.
   */
  gameBaseUrl: z.string().trim().max(200).default(""),
  /**
   * DI SẢN — từ 12/08/2026 mọi vòng đều chạy TUẦN TỰ, không còn nhánh song song để bật/tắt.
   *
   * Song song rút ngắn vòng chạy, nhưng đổi lại thứ tự hành sự trở thành thứ tự giành được cổng
   * điều phối chứ không phải thứ tự trong hồ sơ — và tông môn cần điều ngược lại: Mê Cung (tới
   * 35 phút, giữ một phòng 5 người) phải chạy CUỐI, Luyện Đan Đường áp chót.
   *
   * Trường vẫn nằm trong schema vì document cũ đã mang nó (Zod strip là mất round-trip an
   * toàn), nhưng không còn ai đọc giá trị này — cùng lẽ với `runner` bên dưới.
   */
  parallelQuests: z.boolean().default(true),
  /**
   * DI SẢN — từ v0.11 mọi lượt chạy đều do worker sống dai đảm nhiệm, không còn lựa chọn
   * nơi chạy. Trường vẫn nằm trong schema vì document cũ đã mang nó (Zod strip là mất
   * round-trip an toàn), nhưng không còn ai đọc giá trị này.
   */
  runner: z.enum(["sandbox", "local"]).default("local"),
  /**
   * Loại khôi lỗi được phép cầm đàn — xem `WORKER_PREFS`. Lựa chọn hiện ở Tế đàn auto, KHÔNG
   * ở form Ngọc Giản, nên nó không bao giờ đi qua `saveConfigAction`; `saveConfig` vì thế phải
   * giữ lại giá trị cũ y như `gameCookie`/`accountTier`, nếu không mỗi lần khắc ngọc giản là
   * lựa chọn này lặng lẽ về `any`.
   */
  workerPref: workerPrefSchema.default("any"),
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
           * lúc khôi lỗi nhìn thấy họ lần đầu) sẽ bị mời ra — ghế của người không sẵn sàng
           * là ghế người khác không ngồi được. Song sinh với option `kickIdle` bên desktop.
           */
          kickIdleSec: z.number().int().min(0).max(3600).default(0),
          /** Stop when the daily huyền tinh cap is reached. */
          capCheck: z.boolean().default(true),
          /**
           * Lời nhắn tự động vào Trò Chuyện Đội (recording 08/08): một câu lúc mở phòng,
           * một câu khi trận mở màn. Rỗng = không nhắn. Đi qua `sanitizeChatMessage` vì
           * đích đến của chuỗi này là MỘT LITERAL trong nguồn bước evaluateJavaScript —
           * xem chú thích của hàm ấy.
           */
          chatLobby: chatMessage,
          chatFight: chatMessage,
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
      /**
       * Hỷ Sự Đường — chúc phúc các tiệc cưới đang mở trên /tien-duyen. Chỉ có bản hạng
       * thường (recording 05/08); mỗi lời chúc tốn 30 Tiên Ngọc nên form nói rõ giá.
       */
      hySuDuong: simpleQuest,
      /**
       * Phần Thưởng Hoạt Động — hai rương mốc 75%/100% trên trang nhiệm vụ ngày (schema 66,
       * bản ghi phan-thuong-hoat-dong-20260817-022120). MỘT công tắc cho cả hai hạng: hai
       * twin dùng chung một script và chung một tên trong hồ sơ, y như Điểm Danh hay Hoang Vực.
       */
      phanThuongHoatDong: simpleQuest,
      /** Bản cho hạng VIP — twin `luyen-dan-duong` của hồ sơ. */
      luyenDan: luyenDanQuest,
      /** Bản cho hạng thường — twin `luyen-dan-duong-thuong`. Xem chú thích ở luyenDanQuest. */
      luyenDanThuong: luyenDanQuest,
      /** Bản cho hạng VIP — twin `khoang-mach` (schema 58). */
      khoangMach: khoangMachQuest,
      /** Bản cho hạng thường — twin `khoang-mach-thuong`. Xem chú thích ở khoangMachQuest. */
      khoangMachThuong: khoangMachQuest,
    })
    .prefault({}),
});

export type UserConfig = z.infer<typeof configSchema>;
export type AccountTier = NonNullable<UserConfig["accountTier"]>;

/**
 * Luật tài nguyên chung: Mê Cung của đạo hữu thường LUÔN dừng khi đã đủ huyền tinh trong ngày.
 *
 * Vì sao đúng một tuỳ chọn này bị khoá, giữa cả chục tuỳ chọn tự do khác: Mê Cung là nhiệm vụ
 * duy nhất giữ một phiên trình duyệt HÀNG CHỤC PHÚT (~35 phút một lượt, xem chú thích ở
 * runCycle) và nó cần bốn người khác. Bỏ tick「dừng khi đủ huyền tinh」nghĩa là đánh hết lượt,
 * tức một đàn có thể ngồi trong Mê Cung gần như cả ngày. Khôi lỗi tông môn chỉ có vài ghế
 * (WORKER_MAX_JOBS), nên vài đàn như vậy là cả tông môn hết chỗ chạy — người khác xếp hàng
 * sau lưng mà không hiểu vì sao mãi không tới lượt.
 *
 * Tông chủ được miễn: người vận hành cái VM ấy phải có đường tự quyết định dùng nó thế nào.
 *
 * Hàm THUẦN và không đụng vào bản gốc — trả về chính `config` khi không phải sửa gì, nên nơi
 * gọi so tham chiếu được để biết luật có ra tay hay không (saveConfigAction dùng đúng mẹo đó
 * để nói thật với người dùng rằng lựa chọn của họ đã bị ghi đè).
 */
export function enforceMazeCapPolicy<T extends UserConfig>(
  config: T,
  { isAdmin }: { isAdmin: boolean },
): T {
  if (isAdmin || config.quests.meCung.capCheck) {
    return config;
  }

  return {
    ...config,
    quests: {
      ...config.quests,
      meCung: { ...config.quests.meCung, capCheck: true },
    },
  };
}

/**
 * Nhiệm vụ CHƯA hiệu chỉnh xong — bị ép TẮT ở mọi đường, bất kể cấu hình nói gì.
 *
 * RỖNG hôm nay: Khoáng Mạch — cư dân cuối cùng — đã được hiệu chỉnh từ bản ghi
 * khoang-mach-20260814-133812 và rời danh sách cùng schema 58 (gương với `UnavailableQuests`
 * bên desktop, cũng vừa về rỗng). Cơ chế thì ở lại: nhiệm vụ nào sau này ship dưới dạng
 * phỏng đoán chưa đối chiếu sẽ vào ĐÂY, ở tầng dữ liệu chứ không chỉ làm mờ một ô tick —
 * ô tick chặn được ngón tay, không chặn được một POST dựng tay hay một cấu hình CŨ đã bật
 * từ trước rồi nằm im trong database.
 *
 * Hàm THUẦN và không đụng bản gốc — trả về chính `config` khi không phải sửa gì, để nơi gọi
 * so tham chiếu mà biết luật có ra tay không (cùng mẹo với `enforceMazeCapPolicy`).
 */
export const UNAVAILABLE_QUEST_KEYS = [] as const;

export type UnavailableQuestKey = (typeof UNAVAILABLE_QUEST_KEYS)[number];

export function enforceUnavailableQuestPolicy<T extends UserConfig>(config: T): T {
  const offenders = UNAVAILABLE_QUEST_KEYS.filter(
    (key) => (config.quests as Record<string, { enabled?: boolean }>)[key]?.enabled === true,
  );
  if (offenders.length === 0) {
    return config;
  }

  const quests = { ...config.quests } as Record<string, { enabled?: boolean }>;
  for (const key of offenders) {
    quests[key] = { ...quests[key], enabled: false };
  }
  return { ...config, quests: quests as T["quests"] };
}

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
 * `gameCookie` luôn là chuỗi rỗng ở đây. Đó là chủ ý: một bí mật đã mã hoá at-rest mà vẫn
 * được render vào HTML mỗi lần mở trang thì coi như chưa mã hoá — nó sẽ nằm trong cache
 * trình duyệt, trong lịch sử, trong ảnh chụp màn hình. Nên cookie chỉ đi MỘT CHIỀU: từ
 * người dùng vào database (bảng game_accounts), rồi từ database ra worker.
 */
export type EditableConfig = UserConfig;

/**
 * Di trú tại chỗ cho vụ tách Luyện Đan Đường (08/2026): document cũ chỉ có `luyenDan` dùng
 * chung cho cả hai hạng. Nếu để Zod tự điền default cho `luyenDanThuong` thì mọi tài khoản
 * thường đang luyện đan bỗng dưng TẮT sau deploy — lặng lẽ, không một dòng lỗi. Nên trước
 * khi parse, gieo bản thường từ bản chung cũ: hành vi của người dùng cũ giữ nguyên cho tới
 * khi chính họ khắc lại hai tab khác nhau (lúc đó cả hai key cùng có mặt và hàm này im lặng).
 *
 * Phải gọi ở MỌI nơi JSONB thô gặp Zod, hiện là hai: readStored dưới đây, và op claim của
 * /api/worker — vì claimNextJob/completeWorkerCycle làm mới config_snapshot bằng cách chép
 * THÔ user_configs.config trong SQL, không hề đi qua readStored. Thiếu chỗ thứ hai là đúng
 * kịch bản tắt ngầm ở trên, chỉ khác cửa vào.
 *
 * Export để smoke test ghim được luật di trú mà không cần database.
 */
export function seedLuyenDanThuong(raw: unknown): unknown {
  if (typeof raw !== "object" || raw === null) return raw;
  const quests = (raw as { quests?: unknown }).quests;
  if (typeof quests !== "object" || quests === null) return raw;
  const { luyenDan, luyenDanThuong } = quests as Record<string, unknown>;
  if (luyenDan === undefined || luyenDanThuong !== undefined) return raw;
  return { ...raw, quests: { ...quests, luyenDanThuong: luyenDan } };
}

/** Đọc thô: parse JSONB về đúng hình thù hôm nay, cookie vẫn ở dạng phong bì. */
async function readStored(userId: string): Promise<UserConfig> {
  const rows = await db()
    .select({ config: schema.userConfigs.config })
    .from(schema.userConfigs)
    .where(eq(schema.userConfigs.userId, userId))
    .limit(1);

  // Parsing on the way OUT as well as in: a document written by an older deploy still
  // comes back in today's shape, defaults filled — the JSONB twin of a schema migration.
  const parsed = storedConfigSchema.safeParse(seedLuyenDanThuong(rows[0]?.config ?? {}));
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
  return { ...stored, gameCookie: "" };
}

/**
 * Ghi cấu hình nhiệm vụ. Cookie KHÔNG đi đường này nữa — tài khoản sống ở bảng
 * game_accounts (services/accounts.ts); mọi giá trị gameCookie/accountTier client gửi lên
 * đều bị bỏ qua, và giá trị di sản còn nằm trong document cũ được giữ nguyên chứ không đè.
 */
export async function saveConfig(userId: string, config: UserConfig): Promise<void> {
  const clean = configSchema.parse(config);
  const previous = await readStored(userId);

  const document = storedConfigSchema.parse({
    ...clean,
    gameCookie: previous.gameCookie,
    accountTier: previous.accountTier,
    // Lựa chọn loại khôi lỗi sống ở Tế đàn auto, không có ô nào của nó trên form này — nên
    // `clean` luôn mang giá trị mặc định `any`. Ghi thẳng `clean` xuống là mỗi lần Khắc Ngọc
    // Giản lại âm thầm trả đàn về cho「ai rảnh cũng được」.
    workerPref: previous.workerPref,
  });

  await db()
    .insert(schema.userConfigs)
    .values({ userId, config: document, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: schema.userConfigs.userId,
      set: { config: document, updatedAt: sql`now()` },
    });
}

/**
 * Ghi lựa chọn loại khôi lỗi — chạm ĐÚNG một khoá của document, không đụng phần còn lại.
 *
 * `jsonb_set` thay vì đọc-rồi-ghi cả document: nút này nằm ở Tế đàn auto còn Ngọc Giản là một
 * form khác trên cùng trang, nên hai đường ghi rất dễ chạy chồng nhau — và một lượt đọc-rồi-ghi
 * ở đây sẽ nuốt trọn ngọc giản người ta vừa khắc. `true` ở cuối là "tạo khoá nếu chưa có", cần
 * cho mọi document đời trước tính năng này.
 *
 * Upsert chứ không update: đạo hữu chưa từng bấm Khắc Ngọc Giản lần nào thì chưa có dòng nào.
 */
export async function setWorkerPref(userId: string, pref: WorkerPref): Promise<void> {
  await db().execute(sql`
    insert into user_configs (user_id, config, updated_at)
    values (${userId}, jsonb_build_object('workerPref', ${pref}::text), now())
    on conflict (user_id) do update set
      config = jsonb_set(user_configs.config, '{workerPref}', to_jsonb(${pref}::text), true),
      updated_at = now()
  `);
}

/**
 * Ghi hạng do worker vừa đọc trên hub — vào ĐÚNG tài khoản mà job phục vụ.
 *
 * Một UPDATE nguyên tử qua join job → account: người dùng có thể sửa tài khoản đúng lúc
 * probe trả lời, và không bên nào ghi đè bên kia. Chỉ ghi khi giá trị thực sự đổi; trigger
 * jarvis_dashboard_account_change phát topic `config` trong cùng transaction nên không cần
 * gọi notify tay. Job không gắn tài khoản (lịch sử trước migration 0009) thì không có gì
 * để vá — bỏ qua trong im lặng.
 */
export async function recordDetectedAccountTierForJob(
  jobId: string,
  tier: AccountTier,
): Promise<void> {
  await db().execute(sql`
    update game_accounts as acc set
      account_tier = ${tier},
      updated_at = now()
    from automation_jobs as job
    where job.id = ${jobId}
      and acc.id = job.account_id
      and acc.account_tier is distinct from ${tier}
  `);
}
