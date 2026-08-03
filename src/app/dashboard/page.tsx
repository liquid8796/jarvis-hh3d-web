import { SiteHeader } from "@/components/SiteHeader";
import { requireActiveUser } from "@/lib/auth/guards";
import { getEditableConfig } from "@/lib/services/configs";
import { getActiveJob } from "@/lib/services/jobs";
import { hasWorkerToken } from "@/lib/services/workers";
import { ConfigForm } from "./ConfigForm";
import { ControlPanel } from "./ControlPanel";
import { DashboardLiveProvider } from "./DashboardLiveProvider";
import { LinhSuPanel } from "./LinhSuPanel";

export const metadata = { title: "Linh Đài" };

/**
 * Linh Đài — trang làm việc của một đạo hữu đã được thu nhận: cấu hình đàn pháp bên trái,
 * lư khai đàn + nhật ký tu luyện bên phải. Server component đọc; mọi ghi đi qua actions.
 */
export default async function DashboardPage() {
  const user = await requireActiveUser();
  const [config, activeJob, tokenIssued] = await Promise.all([
    getEditableConfig(user.id),
    getActiveJob(user.id),
    hasWorkerToken(user.id),
  ]);

  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-6xl px-4 pb-24 sm:px-6">
        <div className="rise-in mb-8">
          <h1 className="h-display text-3xl font-bold text-gilded">Linh Đài</h1>
          {/* Ba bước, nói ngay ở dòng đầu. Người mới mở trang này cần biết mình phải làm gì,
              chứ không cần một câu chào hay ho. */}
          <p className="mt-1 text-sm text-[var(--color-mist)]">
            Chào <span className="text-gilded">{user.displayName}</span>. Ba bước: dán tài khoản
            game → chọn nhiệm vụ → bấm Khai Đàn.
          </p>
        </div>

        {/* `minmax(0,…)` chứ không phải `1.1fr_1fr` trần, và `min-w-0` trên cột dọc.
            Grid item lẫn flex item đều mặc định `min-width: auto` — tức "không co nhỏ hơn
            nội dung". Một dòng lệnh cài dài không chỗ ngắt trong <pre> vì thế ĐẨY cột phải
            phình ra ngoài phần của nó và bóp cột trái còn một sợi chỉ (ảnh 02/08). Và
            `overflow-x-auto` trên chính cái <pre> không cứu được: nó chỉ có tác dụng khi
            mọi tổ tiên đều được phép co xuống dưới bề rộng nội dung. */}
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
          <ConfigForm config={config} />
          <div className="flex min-w-0 flex-col gap-6">
            <DashboardLiveProvider>
              <ControlPanel initiallyRunning={activeJob !== null} />
              <LinhSuPanel hasToken={tokenIssued} />
            </DashboardLiveProvider>
          </div>
        </div>
      </main>
    </>
  );
}
