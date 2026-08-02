import { SiteHeader } from "@/components/SiteHeader";
import { requireActiveUser } from "@/lib/auth/guards";
import { getEditableConfig } from "@/lib/services/configs";
import { getActiveJob } from "@/lib/services/jobs";
import { ConfigForm } from "./ConfigForm";
import { ControlPanel } from "./ControlPanel";

export const metadata = { title: "Linh Đài" };

/**
 * Linh Đài — trang làm việc của một đạo hữu đã được thu nhận: cấu hình đàn pháp bên trái,
 * lư khai đàn + nhật ký tu luyện bên phải. Server component đọc; mọi ghi đi qua actions.
 */
export default async function DashboardPage() {
  const user = await requireActiveUser();
  const [config, activeJob] = await Promise.all([
    getEditableConfig(user.id),
    getActiveJob(user.id),
  ]);

  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-6xl px-4 pb-24 sm:px-6">
        <div className="rise-in mb-8">
          <h1 className="h-display text-3xl font-bold text-gilded">Linh Đài</h1>
          <p className="mt-1 text-sm text-[var(--color-mist)]">
            Chào đạo hữu <span className="text-gilded">{user.displayName}</span> — khắc cấu hình,
            khai đàn, rồi để linh sứ lo phần còn lại.
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1.1fr_1fr]">
          <ConfigForm config={config} />
          <ControlPanel initiallyRunning={activeJob !== null} />
        </div>
      </main>
    </>
  );
}
