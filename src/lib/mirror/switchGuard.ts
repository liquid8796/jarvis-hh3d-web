/**
 * Luật "ai được phát lệnh chuyển trạm, và chuyển đi đâu" — THUẦN, để kiểm chứng được.
 *
 * Tách khỏi server action vì đây là hàng rào chống MẤT DỮ LIỆU, không phải phép lịch sự của
 * giao diện: `/admin` được middleware miễn trừ chuyển hướng (admin phải còn cửa quay lui),
 * nên trang ấy mở được trên một trạm đã nghỉ — mà lượt đồng bộ lấy nguồn từ `DATABASE_URL`
 * của chính trạm đang chạy. Phát lệnh từ trạm nghỉ nghĩa là chép một database đứng yên từ
 * lần lật trước ĐÈ LÊN trạm đích.
 *
 * Mô hình là promote: trạm nào đang cầm bút cũng chọn được bất kỳ trạm nào khác làm trạm
 * chính mới, và trạm được chọn trở thành nơi phát lệnh của lượt sau. Không có "trạm gốc"
 * đặc biệt — chỉ có "trạm đang hoạt động".
 */

export type SwitchGate =
  | { allowed: true }
  | { allowed: false; reason: "no-site-id" | "not-active" | "same-site" | "unknown-target"; message: string };

export function canSwitch(input: {
  /** SITE_ID của trạm đang chạy đoạn mã này. */
  currentSiteId: string;
  /** `activeSiteId` trong bảng điều phối; null khi bảng chưa init. */
  activeSiteId: string | null;
  targetId: string;
  /** Các `id` đang có trong sổ. */
  knownIds: readonly string[];
}): SwitchGate {
  const { currentSiteId, activeSiteId, targetId, knownIds } = input;

  if (!currentSiteId) {
    return {
      allowed: false,
      reason: "no-site-id",
      message: "Trạm này chưa khai SITE_ID — không xác định được nó là ai để phát lệnh chuyển.",
    };
  }

  // Bảng chưa init: chưa có khái niệm "trạm khác", nên trạm đang chạy chính là trạm hoạt động.
  // Cùng luật fail-open với tầng chuyển hướng.
  const active = activeSiteId ?? currentSiteId;
  if (active !== currentSiteId) {
    return {
      allowed: false,
      reason: "not-active",
      message:
        `Trạm này (${currentSiteId}) không phải trạm đang hoạt động — hãy vào trang Tông Môn của「${active}」` +
        "mà thao tác. Phát lệnh từ đây sẽ chép database đã nghỉ đè lên trạm đích.",
    };
  }

  if (!knownIds.includes(targetId)) {
    return { allowed: false, reason: "unknown-target", message: `Không có trạm「${targetId}」trong sổ.` };
  }

  // Chuyển sang chính mình là phép rỗng — và nếu để lọt, bước dọn đích sẽ xoá sạch database
  // NGUỒN trước khi chép từ chính nó.
  if (targetId === currentSiteId) {
    return { allowed: false, reason: "same-site", message: `「${targetId}」chính là trạm đang phục vụ — chọn một trạm khác.` };
  }

  return { allowed: true };
}

export type FlipGate =
  | { allowed: true }
  | { allowed: false; reason: "no-site-id" | "not-active" | "not-ready" | "same-site"; message: string };

/**
 * Luật "được lật bảng điều phối hay chưa" — anh em của `canSwitch`, tách ra cùng một lý do.
 *
 * KHÔNG gọi lại `canSwitch`: ba nhánh nhìn giống nhau nhưng LỜI KỂ phải khác, vì hậu quả khác.
 * Phát lệnh chuyển từ trạm nghỉ là chép database đã chết đè lên đích; còn lật từ trạm nghỉ chỉ
 * là lật hộ một trạm không còn quyền. Dùng chung thông báo là nói sai với người đang gỡ rối, và
 * một thông báo sai đắt hơn ba nhánh trùng hình.
 *
 * Nhánh `same-site` sinh ra từ diễn tập 10/08/2026: trạm vừa lên ngôi thừa hưởng một bản ghi
 * `done` trỏ vào chính nó, nút「Lật」hiện ra, và mỗi cú bấm đẻ một revision mới trong sổ mà
 * chẳng đổi gì (2→3→4→5).
 */
export function canFlip(input: {
  currentSiteId: string;
  activeSiteId: string | null;
  /** `mirrorSwitch.targetId` — đích của lượt đang chờ lật. */
  targetId: string;
  /** `mirrorSwitch.phase`; chỉ `done` mới lật được. */
  phase: string;
}): FlipGate {
  const { currentSiteId, activeSiteId, targetId, phase } = input;

  if (!currentSiteId) {
    return {
      allowed: false,
      reason: "no-site-id",
      message: "Trạm này chưa khai SITE_ID — không xác định được nó là ai để lật bảng.",
    };
  }

  // Bảng chưa init thì trạm đang chạy chính là trạm hoạt động — cùng luật fail-open với canSwitch.
  const active = activeSiteId ?? currentSiteId;
  if (active !== currentSiteId) {
    return {
      allowed: false,
      reason: "not-active",
      message: `Trạm này không còn là trạm hoạt động (giờ là「${active}」) — không lật hộ được.`,
    };
  }

  if (phase !== "done") {
    return {
      allowed: false,
      reason: "not-ready",
      message: `Chỉ lật được khi đối chiếu đã xanh (phase hiện tại: ${phase}).`,
    };
  }

  if (targetId && targetId === currentSiteId) {
    return {
      allowed: false,
      reason: "same-site",
      message: `Trạm này CHÍNH LÀ「${targetId}」— lật sang chính mình không đổi gì. Bấm「Huỷ lượt chuyển」để dọn bản ghi cũ.`,
    };
  }

  return { allowed: true };
}
