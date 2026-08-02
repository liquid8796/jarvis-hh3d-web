"use server";

import { requireActiveUser } from "@/lib/auth/guards";
import { issueWorkerToken, revokeWorkerToken } from "@/lib/services/workers";

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
