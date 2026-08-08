import { redirect } from "next/navigation";
import { MaintenanceWall, MaintenanceWatch } from "@/components/Maintenance";
import { getMaintenanceFeed } from "@/lib/services/dashboard";

export const metadata = { title: "Bế Quan Trùng Tu" };

/**
 * Trang bế quan — chỗ mà `MaintenanceGate` đẩy môn đồ tới trong lúc tông môn đóng cửa.
 *
 * Vì sao phải là một TRANG RIÊNG chứ không vẽ bảng chắn ngay tại layout: layout không vẽ
 * `children` thì trang không hiện ra trên màn hình, NHƯNG Next vẫn dựng đoạn trang ấy và gửi
 * kèm trong flight payload — đo được ngày 09/08/2026 trên `/dashboard`: markup chỉ có bảng
 * chắn, mà nội dung Auto vẫn nằm trong `<script>` ở byte 13945. Tức là "ẩn", không phải
 * "không cho vào". Một cú `redirect()` thì kết thúc hẳn hồi đáp: không có đoạn trang nào được
 * dựng xong để mà gửi đi.
 *
 * Trang này KHÔNG gọi guard nào, và đó là điều giữ cho nó không tự đẩy chính mình: nó chỉ đọc
 * cờ, còn ai được vào đâu thì `requireUser()` đã phân xử trước khi đẩy tới đây.
 *
 * Nó vẽ bảng chắn dù `MaintenanceGate` cũng vẽ, và hai chỗ ấy KHÔNG dư nhau — chúng phục vụ hai
 * đường vào khác nhau:
 *   • Tải trang mới (F5, gõ URL) → layout dựng lại → cửa vẽ bảng.
 *   • Điều hướng phía CLIENT (bấm một liên kết trong lúc bế quan vừa bật) → Next TÁI DÙNG layout
 *     và chỉ tải đoạn trang đã đổi, nên cửa không chạy lại. Lúc ấy `redirect()` của guard đưa
 *     client tới đây, và bảng chắn phải nằm sẵn trong chính trang này mới có gì để vẽ.
 */
export default async function MaintenancePage() {
  const maintenance = await getMaintenanceFeed();

  // Cửa đã mở mà còn ai đứng đây (bấm F5 trên một tab cũ, hoặc mở lại bookmark) thì trả họ về
  // trang chủ — một bảng bế quan treo giữa lúc tông môn đang mở là một lời nói dối.
  if (!maintenance.active) {
    redirect("/");
  }

  return (
    <>
      <MaintenanceWall maintenance={maintenance} />
      <MaintenanceWatch active />
    </>
  );
}
