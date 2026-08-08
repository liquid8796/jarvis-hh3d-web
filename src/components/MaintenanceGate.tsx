import { currentUser } from "@/lib/auth/guards";
import { maintenanceViewFor } from "@/lib/auth/maintenance";
import { getMaintenanceFeed } from "@/lib/services/dashboard";
import { MaintenanceBanner, MaintenanceWall, MaintenanceWatch } from "./Maintenance";

/**
 * Cửa bế quan trùng tu, đứng ở layout GỐC — nên không trang nào lọt ra ngoài nó, kể cả trang
 * thêm vào sau này.
 *
 * Nó là NỬA SAU của một cặp, và hai nửa chia việc rất rõ:
 *
 *   • `requireUser()` bên guards.ts đẩy môn đồ sang /be-quan bằng `redirect()`. Đó là phép
 *     chặn THẬT, và nó gác mọi trang có guard — tức mọi trang mang dữ liệu của thành viên.
 *   • Cửa này vẽ bảng chắn cho những trang KHÔNG có guard (trang chủ, cửa đăng nhập, trang bái
 *     sư) và vẽ dải nhắc cho những ai đi qua được. Nó không đẩy ai đi đâu cả.
 *
 * Vì sao phải có cả hai, thay vì chỉ cửa này: layout không vẽ `children` thì trang không hiện
 * lên màn hình, NHƯNG Next dựng đoạn trang SONG SONG với layout, nên nội dung nó vẫn nằm trong
 * flight payload của hồi đáp. Đo được ngày 09/08/2026: markup của `/dashboard` chỉ có bảng
 * chắn, mà nội dung Auto vẫn nằm nguyên trong `<script>` ở byte 13945. Ẩn một trang không phải
 * là không cho vào trang ấy — dữ liệu vẫn rời khỏi server, và server vẫn làm trọn phần việc của
 * trang cho một người sẽ không thấy gì. Chỉ `redirect()` mới kết thúc hồi đáp, và chỗ gọi được
 * `redirect()` sớm nhất là dòng đầu tiên của mỗi trang: chính là guard.
 *
 * Vì sao cửa này KHÔNG tự `redirect()` luôn: nó không biết mình đang ở đường dẫn nào (Server
 * Component không có `usePathname`), nên nó không phân biệt được /be-quan với mọi trang khác —
 * và đẩy /be-quan về /be-quan là một vòng lặp vô tận. Đã thử đường "proxy gắn đường dẫn vào
 * header rồi layout đọc ra": `NextResponse.next({ request: { headers } })` KHÔNG chuyển được
 * header tới lượt dựng RSC trong Next 16.2 — đo trên cả `next dev` lẫn `next start`, proxy vẫn
 * chạy (chuyển hướng /dashboard của khách vẫn đúng) mà header thì không bao giờ tới.
 *
 * GIÁ PHẢI TRẢ: một câu hỏi `app_settings` cho mỗi lượt vẽ trang, dùng chung với guard nhờ
 * `cache()` trong `getMaintenanceFeed`. Phép đọc cấu hình đi TRƯỚC và cắt mạch ngay khi cửa
 * đang mở, nên đường đi thường ngày không thêm lượt đọc users nào. Không cache theo TTL: công
 * tắc mà chậm vài chục giây là trưởng môn bấm xong còn phải ngồi đoán.
 */
export async function MaintenanceGate({ children }: { children: React.ReactNode }) {
  const maintenance = await getMaintenanceFeed();

  // Cửa đang mở: không đọc thêm gì nữa, và không dựng bảng/dải nào. Chỉ để lại nhịp soát để
  // một tab đang mở sẵn cũng thấy bảng chắn khi trưởng môn gạt công tắc.
  if (!maintenance.active) {
    return (
      <>
        {children}
        <MaintenanceWatch active={false} />
      </>
    );
  }

  const viewer = await currentUser();

  if (maintenanceViewFor(maintenance, viewer) === "wall") {
    return (
      <>
        <MaintenanceWall maintenance={maintenance} />
        <MaintenanceWatch active />
      </>
    );
  }

  return (
    <>
      <MaintenanceBanner maintenance={maintenance} />
      {children}
      <MaintenanceWatch active />
    </>
  );
}
