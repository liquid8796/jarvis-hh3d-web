"use server";

import { requireActiveUser, requireAdmin } from "@/lib/auth/guards";
import { hasPermission } from "@/lib/auth/permissions";
import { broadcastNotice, markNoticeSeen } from "@/lib/services/notices";
import { noticeInputSchema } from "@/lib/validation/notices";
import type { AdminResult } from "@/app/actions/admin";

/**
 * Thông báo tông môn — hai đường ghi, hai hàng rào khác nhau.
 *
 * PHÁT là việc của bậc trị sự, nên nó qua `requireAdmin()` rồi mới hỏi ma trận quyền: cửa
 * trang Tông Môn và quyền phát là hai câu hỏi khác nhau, và ngày ai đó thêm một vai chỉ để
 * ngồi xem thì chỗ tách đã có sẵn.
 *
 * ĐÁNH DẤU ĐÃ XEM thì mọi đạo hữu đang hoạt động đều làm được — nhưng chỉ cho CHÍNH MÌNH:
 * `userId` lấy từ phiên đăng nhập, không bao giờ từ tham số. Một action nhận `userId` từ
 * ngoài là một action cho phép bất kỳ ai xoá popup của người khác.
 */

/** Phát một lời nhắn. Dùng với `useActionState`, nên nhận `prev` rồi tới FormData. */
export async function broadcastNoticeAction(
  _prev: AdminResult | null,
  formData: FormData,
): Promise<AdminResult> {
  const admin = await requireAdmin();
  if (!hasPermission(admin, "notice.broadcast")) {
    return { ok: false, message: "Vai của đạo hữu không phát được thông báo." };
  }

  const parsed = noticeInputSchema.safeParse({
    body: String(formData.get("body") ?? ""),
    audienceKind: String(formData.get("audienceKind") ?? ""),
    // `getAll` chứ không `get`: phạm vi là nhiều ô tick cùng tên, và `get` chỉ trả về ô đầu —
    // một lời nhắn gửi ba vai sẽ lặng lẽ chỉ tới tay vai thứ nhất.
    audience: formData.getAll("audience").map((value) => String(value)),
  });

  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Thông báo không hợp lệ." };
  }

  const { recipients } = await broadcastNotice(parsed.data, admin.id);

  // Không ai khớp phạm vi thì NÓI RA, đừng để người phát tin rằng lời nhắn đã tới đâu đó. Dòng
  // vẫn được lưu (nó có thật, và một vai rỗng hôm nay có thể có người vào ngày mai), nhưng
  // câu trả lời phải nói đúng chuyện vừa xảy ra.
  if (recipients === 0) {
    return {
      ok: false,
      message: "Đã lưu, nhưng KHÔNG có đạo hữu đang hoạt động nào khớp phạm vi — chưa ai nhận được.",
    };
  }

  return {
    ok: true,
    message: `Đã phát tới ${recipients} đạo hữu. Popup hiện ngay trên màn hình những ai đang mở web.`,
  };
}

/**
 * Bấm「Đã hiểu」. Trả về `void` chứ không phải kết quả: popup đóng ngay lúc bấm (lạc quan), và
 * một lời báo lỗi cho việc "đánh dấu đã đọc" thì không có hành động nào để người dùng làm tiếp.
 * Lỗi vẫn không bị nuốt — nó ném, và nơi gọi ghi lại vào console.
 */
export async function acknowledgeNoticeAction(noticeId: string): Promise<void> {
  const user = await requireActiveUser();
  await markNoticeSeen(noticeId, user.id);
}
