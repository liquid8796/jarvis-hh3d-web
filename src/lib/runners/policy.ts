import type { UserConfig } from "@/lib/services/configs";

/**
 * Ai nên chạy lượt này — và vì sao câu trả lời KHÔNG phải là sở thích của người dùng.
 *
 * Hai nhiệm vụ có hình dạng thời gian khác hẳn nhau, và đó mới là thứ quyết định:
 *
 *   Luyện Đan Đường — mỗi lượt ghé chỉ vài phút (thu đan → phân giải → khai lô → giữ lửa ba
 *     nhịp → đọc đồng hồ → đi), rồi nghỉ ~26 phút chờ mẻ chín. Đây đúng là hình dạng mà một
 *     VM phù du phục vụ tốt nhất: dựng lên, làm việc ngắn, tắt, không tốn gì lúc chờ.
 *
 *   Mê Cung — phải tạo phòng, đứng đó chờ đủ 5 NGƯỜI THẬT (có thể hàng chục phút), rồi đánh
 *     liền một mạch tới 35 phút. Cả quá trình là MỘT phiên browser không đứt được: mất VM
 *     giữa chừng là mất luôn cái phòng đang đứng trong đó, và bốn người kia mất lượt oan.
 *     Không có cách nào cắt nó thành lát 5 phút.
 *
 * Nên chính sách là: bật Mê Cung → phải chạy `local`. Chỉ Luyện Đan → `sandbox` chạy tốt.
 * Người dùng chọn "ưu tiên sandbox" thì được tôn trọng ở chỗ nào tôn trọng được; chỗ nào
 * kỹ thuật không cho thì chính sách này nói thẳng lý do, thay vì để lượt chạy chết giữa
 * chừng rồi người dùng tự đoán.
 */

export type RunnerKind = "sandbox" | "local";

export type RunnerDecision = {
  runner: RunnerKind;
  /** Câu giải thích hiển thị cho người dùng trong nhật ký — luôn có, kể cả khi thuận ý. */
  reason: string;
};

/** Trần thời gian một lát sandbox. Dưới trần của Vercel Sandbox, chừa chỗ cho dựng VM. */
export const SANDBOX_SLICE_MS = 8 * 60 * 1000;

export function decideRunner(config: UserConfig): RunnerDecision {
  const meCung = config.quests.meCung.enabled;
  const luyenDan = config.quests.luyenDan.enabled;
  const preferred = config.runner;

  if (meCung) {
    return {
      runner: "local",
      reason:
        preferred === "sandbox"
          ? "Mê Cung cần một phiên browser liền mạch (chờ đủ 5 người rồi đánh tới 35 phút), " +
            "dài hơn tuổi thọ một sandbox — lượt này chuyển cho linh sứ máy nhà."
          : "Mê Cung được giao cho linh sứ máy nhà — phiên browser phải sống liền mạch.",
    };
  }

  if (preferred === "local") {
    return { runner: "local", reason: "Theo lựa chọn của đạo hữu: chạy trên linh sứ máy nhà." };
  }

  if (luyenDan) {
    return {
      runner: "sandbox",
      reason: "Luyện Đan Đường chạy trên sandbox — mỗi lượt ghé vài phút, rất hợp VM phù du.",
    };
  }

  return { runner: "sandbox", reason: "Chạy trên sandbox." };
}
