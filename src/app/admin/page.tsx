import { SiteHeader } from "@/components/SiteHeader";
import { requireAdmin } from "@/lib/auth/guards";
import { countJobsForDrain } from "@/lib/services/jobs";
import { getAppSettings } from "@/lib/services/settings";
import { countPending, listUsers } from "@/lib/services/users";
import { AdminTabs } from "./AdminTabs";
import { ChatSettingsForm } from "./ChatSettingsForm";
import { MaintenanceForm } from "./MaintenanceForm";
import { MembershipSettingsForm } from "./MembershipSettingsForm";
import { UserTable } from "./UserTable";
import { CreateUserPanel } from "./CreateUserPanel";

export const metadata = { title: "Tông Môn" };

/**
 * Tông Môn — sổ bộ môn đồ.
 *
 * Tìm kiếm và lọc đi qua URL (`?q=…&status=…`) chứ không nằm trong state của client: một
 * bộ lọc là thứ đáng được chia sẻ, đánh dấu và tải lại mà vẫn nguyên vẹn. Đổi lại, mọi
 * thao tác ghi đều `revalidatePath("/admin")`, nên bảng luôn vẽ từ dữ liệu vừa đổi.
 */
export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string }>;
}) {
  await requireAdmin();

  const params = await searchParams;
  const status =
    params.status === "pending" || params.status === "active" || params.status === "disabled"
      ? params.status
      : undefined;

  const [users, pending, settings, drain] = await Promise.all([
    listUsers({ search: params.q, status }),
    countPending(),
    getAppSettings(),
    countJobsForDrain(),
  ]);

  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-6xl px-4 pb-24 sm:px-6">
        <div className="rise-in mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="h-display text-3xl font-bold text-gilded">Tông Môn</h1>
            <p className="mt-1 text-sm text-[var(--color-mist)]">
              Sổ bộ môn đồ và các cấu hình chung của tông môn.
            </p>
          </div>
          {pending > 0 && (
            <span className="badge badge-pending">
              {pending} đạo hữu đang chờ duyệt
            </span>
          )}
        </div>

        {/* Mỗi khu cấu hình một tab — thêm tính năng sau này là thêm một mục vào mảng. */}
        <AdminTabs
          tabs={[
            {
              key: "monDo",
              label: "Môn Đồ",
              pane: (
                <>
                  <div className="mb-6">
                    <MembershipSettingsForm
                      requireApproval={settings.membership.requireApproval}
                      pendingCount={pending}
                    />
                  </div>
                  <div className="mb-6">
                    <CreateUserPanel />
                  </div>
                  <UserTable users={users} query={params.q ?? ""} status={status ?? ""} />
                </>
              ),
            },
            {
              key: "damDao",
              label: "Đàm Đạo",
              pane: <ChatSettingsForm retentionDays={settings.chat.retentionDays} />,
            },
            {
              key: "baoTri",
              label: settings.maintenance.active ? "Bảo Trì ●" : "Bảo Trì",
              pane: <MaintenanceForm maintenance={settings.maintenance} drain={drain} />,
            },
          ]}
        />
      </main>
    </>
  );
}
