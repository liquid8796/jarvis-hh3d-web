import { SiteHeader } from "@/components/SiteHeader";
import { requireActiveUser } from "@/lib/auth/guards";
import { getQueueSnapshot } from "@/lib/services/queue";
import { QueueBoard } from "./QueueBoard";

export const metadata = { title: "Hàng Đợi Công Việc" };

/** Cùng bề rộng khung với Linh Đài — hai trang này đứng cạnh nhau trong cùng một luồng việc. */
const SHELL_WIDTH = "max-w-[100rem]";

/**
 * Hàng Đợi Công Việc — cả tông môn nhìn chung một hàng chờ.
 *
 * Câu hỏi trang này trả lời: "đàn của tôi đứng thứ mấy, và vì sao chưa tới lượt?". Trước đây
 * người dùng chỉ thấy đàn của chính mình trên Linh Đài, nên một lượt chờ lâu trông y hệt một
 * lượt hỏng. Thấy cả hàng thì cái chờ ấy có lý do.
 *
 * Server component dựng ảnh chụp đầu tiên để trang không loé lên khoảng trống; từ đó
 * QueueBoard tự hỏi lại theo nhịp.
 */
export default async function QueuePage() {
  const user = await requireActiveUser();
  const snapshot = await getQueueSnapshot(user.id);

  return (
    <>
      <SiteHeader maxWidth={SHELL_WIDTH} />
      <main className={`mx-auto w-full ${SHELL_WIDTH} px-4 pb-24 sm:px-6`}>
        <div className="rise-in mb-8">
          <h1 className="h-display text-3xl font-bold text-gilded">Hàng Đợi Công Việc</h1>
          <p className="mt-1 text-sm text-[var(--color-mist)]">
            Toàn bộ đàn pháp đang chạy và đang chờ trong tông môn, xếp đúng thứ tự linh sứ sẽ
            nhặt việc.
          </p>
        </div>

        <QueueBoard initial={snapshot} />
      </main>
    </>
  );
}
