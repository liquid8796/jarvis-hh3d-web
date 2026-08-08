import { SiteHeader } from "@/components/SiteHeader";
import { requireActiveUser } from "@/lib/auth/guards";
import { ChatRoom } from "./ChatRoom";

export const metadata = { title: "Phòng Chat" };

/**
 * Phòng Chat — sảnh đàm đạo chung của cả tông môn. Server component chỉ gác cửa và đưa
 * danh tính; mọi chuyện trò là việc của client, nói với /api/chat theo nhịp poll.
 */
export default async function ChatPage() {
  const user = await requireActiveUser();

  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 pb-6 sm:px-6">
        <ChatRoom me={{ id: user.id, name: user.displayName, isAdmin: user.role === "admin" }} />
      </main>
    </>
  );
}
