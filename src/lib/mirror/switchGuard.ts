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
