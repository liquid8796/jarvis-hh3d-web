import { SiteHeader } from "@/components/SiteHeader";
import { requireActiveUser } from "@/lib/auth/guards";
import { getAppSettings } from "@/lib/services/settings";
import { ChatRoom } from "./ChatRoom";

export const metadata = { title: "Phòng Chat" };

/**
 * Phòng Chat — sảnh đàm đạo chung của cả tông môn. Server component chỉ gác cửa và đưa
 * danh tính; mọi chuyện trò là việc của client, nói với /api/chat theo nhịp poll.
 *
 * Sổ khung tag đi vào từ ĐÂY chứ không theo nhịp poll: nó là cấu hình đổi vài lần một năm,
 * kẹp nó vào mỗi hồi đáp 2.5s là trả tiền chuyên chở vĩnh viễn cho một thứ gần như bất động.
 * Admin vừa thêm khung thì người đang mở sảnh thấy nó ở lần tải trang sau — đủ tươi.
 */
export default async function ChatPage() {
  const user = await requireActiveUser();
  const settings = await getAppSettings();

  return (
    <>
      <SiteHeader />
      {/* Trần bề ngang HỮU DỤNG của sảnh thêm đúng 25%: 1200 → 1500px. <main> còn mang
          `sm:px-6` hai bên (48px), nên trần hộp ngoài đi từ 78rem (1248px) thành
          96.75rem (1548px), không phải phép nhân thẳng 78 × 1.25.

          Phải nới CẢ trần này lẫn nhánh tính bề rộng của `.chat-frame` trong globals.css:
          chỉ đổi 78rem ở đây thì trên phần lớn desktop, phép kẹp theo chiều cao bên kia vẫn
          thắng và khung không rộng thêm một pixel nào. 96.75rem giữ đúng cùng hệ số 1.25 với
          BỀ RỘNG HỮU DỤNG cũ, nên trần không vô tình cắt mất mức tăng vừa được yêu cầu;
          `w-full` và `min(100%, …)` bên khung vẫn giữ sảnh vừa màn hình ở khung nhìn hẹp.

          Viết thẳng con số chứ không ghép lúc chạy: Tailwind quét tĩnh, lớp dựng bằng biến sẽ
          không bao giờ được sinh ra CSS. */}
      <main data-backdrop="chat" className="mx-auto w-full max-w-[96.75rem] flex-1 px-4 pb-6 sm:px-6">
        <ChatRoom me={{ id: user.id, name: user.displayName }} tagFrames={settings.chat.tagFrames} />
      </main>
    </>
  );
}
