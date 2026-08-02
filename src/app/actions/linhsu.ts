"use server";

import { requireActiveUser } from "@/lib/auth/guards";
import { forgetWorker, issueWorkerToken, revokeWorkerToken } from "@/lib/services/workers";

/**
 * Vòng đời LINH PHÙ — token để linh sứ máy nhà của đạo hữu tự xưng danh.
 *
 * Bản rõ của linh phù chỉ tồn tại trong hồi đáp của `issueLinhPhuAction`: client hiển thị
 * đúng một lần trong lệnh cài rồi thôi; tàng khố chỉ giữ hash. Muốn xem lại? Không có gì
 * để xem lại — phát linh phù mới (cái cũ tự hết hiệu lực, linh sứ nào còn cầm sẽ bị từ
 * chối ngay ở lần gõ cửa kế tiếp).
 */

export type LinhPhuResult =
  | { ok: true; token: string }
  | { ok: false; message: string };

export async function issueLinhPhuAction(): Promise<LinhPhuResult> {
  const user = await requireActiveUser();
  const token = await issueWorkerToken(user.id);
  return { ok: true, token };
}

export async function revokeLinhPhuAction(): Promise<{ ok: boolean }> {
  const user = await requireActiveUser();
  await revokeWorkerToken(user.id);
  return { ok: true };
}

/**
 * Gỡ một cái tên khỏi sổ điểm danh. Chỉ đụng tới sổ — máy kia không hề hay biết, và nếu linh
 * sứ ở đó còn sống thì nó ghi tên lại sau vài giây. `workerId` đi thẳng vào mệnh đề where đã
 * tham số hoá, và `forgetWorker` tự chốt scope theo người gọi.
 */
export async function forgetLinhSuAction(
  workerId: string,
): Promise<{ ok: boolean; message?: string }> {
  const user = await requireActiveUser();
  if (typeof workerId !== "string" || workerId.length === 0) {
    return { ok: false, message: "Không rõ gỡ linh sứ nào." };
  }
  const removed = await forgetWorker(user.id, workerId);
  return removed
    ? { ok: true }
    : { ok: false, message: "Linh sứ này vừa điểm danh lại — nó đang trực nên chưa gỡ được." };
}
