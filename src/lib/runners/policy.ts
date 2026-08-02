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

/**
 * Sandbox chỉ THẬT SỰ dùng được khi có thứ gõ cửa nó thường xuyên.
 *
 * Nó không phải tiến trình đang sống — phải có cron gọi `/api/cron` mỗi phút. Mà gói Hobby
 * của Vercel **chỉ cho cron một lần mỗi ngày** (`vercel --prod` từ chối thẳng biểu thức
 * `* * * * *`). Một lần mỗi ngày thì vô dụng với automation cần ghé lò mỗi ~26 phút.
 *
 * Nên sandbox mặc định TẮT, và chỉ bật khi người vận hành khẳng định mình có cron đủ dày
 * (gói Pro, hoặc một cron ngoài tự gọi vào). Thà giao hết cho linh sứ máy nhà — thứ chắc
 * chắn chạy — còn hơn xếp job vào một hàng chờ không ai đến lấy.
 */
export function sandboxAvailable(): boolean {
  return process.env.SANDBOX_ENABLED === "1";
}

/**
 * Ai được PHÉP chọn sandbox — khác hẳn câu hỏi sandbox có chạy được không.
 *
 * Cổng tạm thời, và cố ý hẹp: sandbox đã dựng xong và kiểm được, nhưng nó tiêu tiền compute
 * của tài khoản Vercel dùng chung, và mỗi lát chạy sai là một VM chạy không. Cho tới khi
 * theo dõi được chi phí theo từng người, chỉ tông chủ mở được nó — người khác vẫn thấy lựa
 * chọn, thấy nó bị khoá, và biết vì sao.
 *
 * Mở lại cho tất cả = trả về `true` ở đây. Một chỗ duy nhất, vì cả UI, chỗ lưu và chỗ quyết
 * định chạy đều hỏi hàm này.
 */
export function sandboxAllowedFor(user: { role: string }): boolean {
  return user.role === "admin";
}

export function decideRunner(
  config: UserConfig,
  { sandboxAllowed }: { sandboxAllowed: boolean },
): RunnerDecision {
  const meCung = config.quests.meCung.enabled;
  const luyenDan = config.quests.luyenDan.enabled;
  const preferred = config.runner;

  // Kiểm quyền TRƯỚC mọi thứ khác, và kiểm ở đây chứ không chỉ lúc lưu. Một document đã
  // nằm sẵn trong database từ trước khi có luật này vẫn mang `runner: "sandbox"` — bản đầu
  // để đó làm mặc định — nên nếu chỉ chặn ở form thì mọi tài khoản cũ vẫn lọt.
  if (!sandboxAllowed) {
    return {
      runner: "local",
      reason:
        preferred === "sandbox"
          ? "Linh sứ sandbox đang trong thời gian thử nghiệm, hiện chỉ mở cho tông chủ — " +
            "lượt này giao cho linh sứ máy nhà."
          : "Giao cho linh sứ máy nhà.",
    };
  }

  if (!sandboxAvailable()) {
    return {
      runner: "local",
      reason:
        preferred === "sandbox"
          ? "Sandbox chưa bật (cron của gói Hobby chỉ chạy 1 lần/ngày, không đủ để lái đàn " +
            "pháp) — lượt này giao cho linh sứ máy nhà."
          : "Giao cho linh sứ máy nhà.",
    };
  }

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
