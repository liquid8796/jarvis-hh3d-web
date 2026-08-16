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

/**
 * NƠI CHẠY ĐOẠN MÃ NÀY CÓ PHẢI MỘT TRẠM TRONG VÒNG XOAY KHÔNG.
 *
 * `SITE_ID` vắng mặt từng có nghĩa「một deploy Vercel quên khai biến env」— một sự cố cấu hình,
 * tạm thời, đáng nhắc người vận hành đi đặt cho đủ. Từ 16/08/2026 nó mang nghĩa KHÁC HẲN và
 * lâu dài: đây là backend trên VM, thứ mà cả năm vỏ Vercel proxy về. Nó không phải một trạm
 * trong vòng xoay — nó LÀ nơi phục vụ.
 *
 * Hai nghĩa ấy đòi hai cách cư xử ngược nhau, nên phép hỏi phải có TÊN chứ không nằm rải rác
 * dưới dạng `!process.env.SITE_ID`. Ba nơi đang đọc cùng dấu hiệu này — tầng chuyển hướng
 * (middleware), luật phát lệnh chuyển, và bảng điều khiển ở trang Tông Môn — và chúng phải
 * cùng đọc ra một câu trả lời.
 *
 * ĐỪNG「CHỮA」BẰNG CÁCH ĐẶT SITE_ID CHO VM. Nó không mở khoá gì cả, nó lên đạn hai cỗ máy đã
 * hết việc: lượt chuyển sẽ bế quan cả tông môn rồi chép database SỐNG đè lên một Neon đã nghỉ,
 * còn tầng chuyển hướng — nếu giá trị đặt vào không trùng khít `activeSiteId` — sẽ 307 sang URL
 * của trạm hoạt động, mà URL ấy proxy thẳng về lại đây: vòng lặp chuyển hướng trên mọi đường
 * không được miễn trừ.
 */
export function backendIsStation(siteId: string | null | undefined): boolean {
  return (siteId ?? "").trim().length > 0;
}

export type SwitchGate =
  | { allowed: true }
  | { allowed: false; reason: "not-a-station" | "not-active" | "same-site" | "unknown-target"; message: string };

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

  if (!backendIsStation(currentSiteId)) {
    return {
      allowed: false,
      reason: "not-a-station",
      message:
        "Nơi này không phải một trạm trong vòng xoay — nó LÀ backend đang phục vụ cả năm trạm. " +
        "Lượt chuyển trạm chép database sang một trạm khác rồi lật bảng điều phối, mà từ 16/08/2026 " +
        "cả hai việc ấy đều không còn đích để đi.",
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
  | { allowed: false; reason: "not-a-station" | "not-active" | "not-ready" | "same-site"; message: string };

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

  if (!backendIsStation(currentSiteId)) {
    return {
      allowed: false,
      reason: "not-a-station",
      message:
        "Nơi này không phải một trạm trong vòng xoay — không có bảng nào để lật. Bảng điều phối " +
        "chỉ đạo diễn chuyện「trạm nào phục vụ」, mà nay mọi trạm đều proxy về đúng một backend.",
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
