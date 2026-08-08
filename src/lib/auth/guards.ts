import { redirect } from "next/navigation";
import { maintenanceViewFor } from "./maintenance";
import { isAdminUser } from "./permissions";
import { readSession } from "./session";
import { getMaintenanceFeed } from "@/lib/services/dashboard";
import { findById, type PublicUser } from "@/lib/services/users";

/**
 * The authorization ladder. proxy.ts only checks that a session cookie EXISTS (cheap, runs
 * on every matched request); these guards are the real thing — they re-read the user row,
 * so a status flipped by an admin bites on the very next request, not at cookie expiry.
 */

/** Trang bảng chắn. Mọi trang có guard đổ về đây trong lúc tông môn bế quan. */
const WALL_PATH = "/be-quan";

export async function currentUser(): Promise<PublicUser | null> {
  const session = await readSession();
  if (!session) {
    return null;
  }

  return findById(session.sub);
}

/**
 * Any logged-in user — the waiting room included.
 *
 * Đây cũng là chỗ chế độ BẾ QUAN TRÙNG TU chặn thật. Từ 09/08/2026, môn đồ thường không vào
 * được trang nào trong lúc bế quan, và phép chặn phải là `redirect()` chứ không phải một tấm
 * màn ở layout: layout không vẽ `children` thì trang vẫn được Next dựng xong và gửi kèm trong
 * flight payload (đo được: nội dung `/dashboard` nằm ở byte 13945 của hồi đáp trong khi markup
 * chỉ có bảng chắn). `redirect()` ném ngay tại dòng đầu tiên của trang, nên không có đoạn trang
 * nào được dựng xong để mà gửi đi.
 *
 * Ở TRÊN `requireActiveUser`/`requireAdmin` vì cả hai đi qua đây — một chỗ chèn, ba cửa được
 * gác, và không có cửa nào lỡ quên. Bậc trị sự đi qua được: công tắc tắt bảo trì nằm trong
 * trang Tông Môn của họ (xem `maintenanceViewFor`).
 *
 * `currentUser()` thì KHÔNG bao giờ chặn — nó là phép đọc danh tính, dùng bởi chính cửa bế quan
 * và bởi thanh đầu trang. Chặn trong đó là đệ quy.
 */
export async function requireUser(): Promise<PublicUser> {
  const user = await currentUser();
  if (!user) {
    redirect("/login");
  }

  if (maintenanceViewFor(await getMaintenanceFeed(), user) === "wall") {
    redirect(WALL_PATH);
  }

  return user;
}

/** A user the tông môn has actually admitted. */
export async function requireActiveUser(): Promise<PublicUser> {
  const user = await requireUser();
  if (user.status !== "active") {
    redirect("/pending");
  }

  return user;
}

/** Gia chủ hay Trưởng môn đều qua — ai được đụng vào AI CỤ THỂ thì hỏi tiếp permissions.ts. */
export async function requireAdmin(): Promise<PublicUser> {
  const user = await requireUser();
  if (!isAdminUser(user)) {
    redirect("/dashboard");
  }

  return user;
}
