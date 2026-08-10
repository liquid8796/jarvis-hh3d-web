"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireActiveUser } from "@/lib/auth/guards";
import { hasPermission } from "@/lib/auth/permissions";
import { forceStartJob, forceStopJob } from "@/lib/services/jobs";

/**
 * Hành động của trang Hàng Đợi. Đúng một việc: DỪNG một đàn bất kỳ đang chạy.
 *
 * Tệp riêng chứ không nhét vào `automation.ts`, và ranh giới rất rõ: tệp kia là đàn CỦA CHÍNH
 * MÌNH (Khai Đàn, Thu Đàn, dọn nhật ký), còn đây là đụng vào đàn của NGƯỜI KHÁC. Hai thứ có
 * hai luật phân quyền khác hẳn nhau, nên để chung là mời người sau chép nhầm cái guard.
 */

export type QueueActionResult = { ok: boolean; message: string };

/** Id đàn tới từ ngoài Internet. Không phải uuid thì Postgres NÉM chứ không trả rỗng. */
const jobIdSchema = z.string().uuid();

const NO_PERMISSION =
  "Chỉ Gia chủ và Thái thượng trưởng lão mới dừng được đàn của người khác.";

/**
 * Dừng một đàn đang kẹt.
 *
 * `requireActiveUser()` trước, rồi MA TRẬN — cùng thứ tự với mọi action bên admin.ts. Không
 * dùng `requireAdmin()`: nó `redirect()` khi thiếu vai, mà đây là một nút bấm giữa trang chứ
 * không phải một cánh cửa — người bấm xứng đáng nhận một câu từ chối, không phải bị ném sang
 * trang khác. Và cửa `requireAdmin` cũng SAI ngưỡng: Chưởng môn qua được nó nhưng KHÔNG được
 * dừng đàn.
 *
 * Phép kiểm quyền nằm ở server chứ không chỉ ở chỗ ẩn nút: form và fetch là thứ ngoài
 * Internet chạm tới được.
 */
export async function forceStopJobAction(jobId: string): Promise<QueueActionResult> {
  const user = await requireActiveUser();
  if (!hasPermission(user, "job.force_stop")) {
    return { ok: false, message: NO_PERMISSION };
  }

  const parsed = jobIdSchema.safeParse(jobId);
  if (!parsed.success) {
    return { ok: false, message: "Định danh đàn không hợp lệ." };
  }

  const outcome = await forceStopJob(parsed.data, user.displayName);
  if (!outcome.ok) {
    return {
      ok: false,
      message:
        outcome.reason === "already-stopping"
          ? "Đàn này đã nhận lệnh dừng từ trước — khôi lỗi đang thu ở điểm an toàn."
          : "Đàn này không còn chạy nữa — có thể nó vừa xong hoặc vừa được dừng.",
    };
  }

  revalidatePath("/hang-doi");
  return {
    ok: true,
    message: outcome.ended
      ? "Đã dừng đàn — vòng kế chưa kịp bắt đầu."
      : "Đã gửi lệnh dừng — khôi lỗi sẽ thu đàn ở điểm an toàn kế tiếp, không nhận vòng mới.",
  };
}

/**
 * Vì sao không thành, nói bằng tiếng người. Mỗi nhánh dẫn tới một hành động khác nhau của
 * người đọc, nên gộp chúng vào một câu "không khai được" là lấy mất của họ bước tiếp theo.
 */
const START_FAILURE: Record<Exclude<Awaited<ReturnType<typeof forceStartJob>>, { ok: true }>["reason"], string> = {
  "not-found": "Không tìm thấy đàn này — có thể nó vừa bị dọn khỏi lịch sử.",
  "still-active": "Đàn này đang chạy rồi — tải lại trang để thấy trạng thái mới nhất.",
  "account-gone": "Tài khoản game của đàn này không còn nữa, không khai lại được.",
  "account-disabled":
    "Chủ nhân đang TẮT tài khoản này. Khai hộ sẽ đi ngược ý họ — nhắn cho họ bật lại trước.",
  maintenance: "Tông môn đang bế quan trùng tu — khai đàn tạm khoá tới khi mở cửa lại.",
  "no-quests": "Chủ nhân chưa tick nhiệm vụ nào, khai lên thì đàn cũng không có việc để làm.",
};

/**
 * Khai đàn hộ một tài khoản vừa dừng.
 *
 * Quyền RIÊNG (`job.force_start`) chứ không mượn `job.force_stop`: xem chú thích ở
 * permissions.ts. Cùng thứ tự guard với action dừng — `requireActiveUser()` rồi ma trận rồi
 * mới tới hình dạng id, vì một người không đủ quyền không đáng được biết id của họ có hợp lệ hay không.
 */
export async function forceStartJobAction(stoppedJobId: string): Promise<QueueActionResult> {
  const user = await requireActiveUser();
  if (!hasPermission(user, "job.force_start")) {
    return { ok: false, message: "Chỉ Gia chủ và Thái thượng trưởng lão mới khai đàn hộ được." };
  }

  const parsed = jobIdSchema.safeParse(stoppedJobId);
  if (!parsed.success) {
    return { ok: false, message: "Định danh đàn không hợp lệ." };
  }

  const outcome = await forceStartJob(parsed.data, user.displayName);
  if (!outcome.ok) {
    return { ok: false, message: START_FAILURE[outcome.reason] };
  }

  revalidatePath("/hang-doi");
  return {
    ok: true,
    message: `Đã khai đàn hộ cho「${outcome.accountLabel}」— đàn mới đã vào hàng chờ.`,
  };
}
