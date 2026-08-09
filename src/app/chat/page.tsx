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
      {/* 60rem = max-w-3xl (48rem) rộng thêm 25%. Viết thẳng con số chứ không ghép lúc chạy:
          Tailwind quét tĩnh, lớp dựng bằng biến sẽ không bao giờ được sinh ra CSS. */}
      <main data-backdrop="chat" className="mx-auto w-full max-w-[60rem] flex-1 px-4 pb-6 sm:px-6">
        <ChatRoom me={{ id: user.id, name: user.displayName }} tagFrames={settings.chat.tagFrames} />
      </main>
    </>
  );
}
