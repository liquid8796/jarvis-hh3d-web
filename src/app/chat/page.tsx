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
      {/* Trần bề ngang của sảnh — 60rem cho tới 31/08/2026, nay 78rem (1248px).

          Trần cũ là thứ ĐANG quyết định cỡ khung trên mọi màn hình desktop, và đó là chỗ nó
          sai: `.chat-frame` đã có sẵn một phép kẹp theo CHIỀU CAO khung nhìn (xem
          globals.css), tức nó tự biết không được cao quá màn hình. Chồng thêm một trần bề
          ngang cứng nghĩa là trên màn 1080p khung đứng ở 912px trong khi còn chỗ cho 971px,
          và trên màn 1440p nó vẫn cứ 912px giữa một khung nhìn cao 1300px — càng màn to càng
          phí. 78rem đủ cao để phép kẹp chiều cao luôn là vế thắng ở mọi tỉ lệ màn thường gặp,
          mà vẫn còn là một cái trần thật cho màn siêu rộng, nơi một sảnh chat kéo hết 2560px
          chỉ làm mắt phải quét xa hơn.

          Viết thẳng con số chứ không ghép lúc chạy: Tailwind quét tĩnh, lớp dựng bằng biến sẽ
          không bao giờ được sinh ra CSS. */}
      <main data-backdrop="chat" className="mx-auto w-full max-w-[78rem] flex-1 px-4 pb-6 sm:px-6">
        <ChatRoom me={{ id: user.id, name: user.displayName }} tagFrames={settings.chat.tagFrames} />
      </main>
    </>
  );
}
