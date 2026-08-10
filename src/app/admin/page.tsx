import { SiteHeader } from "@/components/SiteHeader";
import { requireAdmin } from "@/lib/auth/guards";
import { hasPermission } from "@/lib/auth/permissions";
import { countJobsForDrain } from "@/lib/services/jobs";
import { BACKDROP_PREFIX, humanBytes, listObjectsUnder } from "@/lib/services/media";
import { getAppSettings } from "@/lib/services/settings";
import { mirrorsForAdmin } from "@/app/actions/mirrors";
import { switchStateForAdmin } from "@/app/actions/mirrorSwitch";
import { countPending, listUsers } from "@/lib/services/users";
import type { BackdropChoice } from "@/lib/validation/backdrops";
import { AdminTabs } from "./AdminTabs";
import { BackdropManager } from "./BackdropManager";
import { ChatPurgePanel } from "./ChatPurgePanel";
import { ChatSettingsForm } from "./ChatSettingsForm";
import { TagFrameManager } from "./TagFrameManager";
import { GameDomainForm } from "./GameDomainForm";
import { MaintenanceForm } from "./MaintenanceForm";
import { MirrorPanel } from "./MirrorPanel";
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
  const viewer = await requireAdmin();

  const params = await searchParams;
  const status =
    params.status === "pending" || params.status === "active" || params.status === "disabled"
      ? params.status
      : undefined;

  const [users, pending, settings, drain, backdropStore] = await Promise.all([
    listUsers({ search: params.q, status }),
    countPending(),
    getAppSettings(),
    countJobsForDrain(),
    // Lưới ảnh nền đọc THẲNG từ tàng khố, không từ một sổ trong app_settings — xem ghi chú
    // tại BACKDROP_PREFIX. Kho đóng thì thẻ tự nói ra, nên chỗ này không cần ném.
    listObjectsUnder(`${BACKDROP_PREFIX}/`),
  ]);

  // Đổi byte thành chữ Ở ĐÂY vì `humanBytes` sống trong media.ts — một module kéo theo cả SDK
  // của S3, thứ tuyệt đối không được lọt vào bundle của trình duyệt.
  const backdropImages: BackdropChoice[] = backdropStore.storeClosed
    ? []
    : backdropStore.objects.map((object) => ({
        key: object.key,
        url: object.url,
        sizeLabel: humanBytes(object.size),
      }));

  return (
    <>
      <SiteHeader />
      <main data-backdrop="admin" className="mx-auto w-full max-w-6xl px-4 pb-24 sm:px-6">
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
                  {/* Thanh công cụ của tab: công tắc môn quy bên trái, nút thu nhận bên
                      phải, hai thứ NGANG HÀNG. `items-start` chứ không `items-center` —
                      cụm bên trái cao hơn một cái nút (còn dòng trạng thái, và có lúc cả
                      cảnh báo hàng chờ), nên căn giữa sẽ thả cái nút trôi xuống giữa chừng
                      thay vì thẳng hàng với ô tick. */}
                  <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
                    <MembershipSettingsForm
                      requireApproval={settings.membership.requireApproval}
                      pendingCount={pending}
                    />
                    <CreateUserPanel viewer={viewer} />
                  </div>
                  {/* Sổ khung được QUẢN ở tab Đàm Đạo, nhưng chip tag trong hộp Sửa nằm đây
                      — nên nhãn khung đi xuống từ trang, một nguồn cho cả hai tab. */}
                  <UserTable
                    viewer={viewer}
                    users={users}
                    query={params.q ?? ""}
                    status={status ?? ""}
                    frameLabels={settings.chat.tagFrames.map((frame) => frame.label)}
                  />
                </>
              ),
            },
            {
              key: "damDao",
              label: "Đàm Đạo",
              // Ba thẻ RỜI nhau: cùng một tab vì cùng nói về sảnh đàm đạo, nhưng không chung
              // form — xem ghi chú trong ChatPurgePanel. Thứ tự theo mức nguy hiểm: chỉnh hạn
              // lưu, rồi quản khung, và thanh tẩy — thứ không có đường lui — đứng cuối.
              pane: (
                <div className="flex flex-col gap-6">
                  <ChatSettingsForm retentionDays={settings.chat.retentionDays} />
                  <TagFrameManager frames={settings.chat.tagFrames} />
                  <ChatPurgePanel canPurge={hasPermission(viewer, "chat.purge")} />
                </div>
              ),
            },
            {
              key: "giaoDien",
              label: "Giao Diện",
              // Tab RIÊNG chứ không nhét vào Đàm Đạo: tấm nền là chuyện của cả tông môn, mọi
              // trang đều đứng trên nó — xếp nó cạnh hạn lưu tin nhắn là xếp nhầm hàng.
              pane: (
                <BackdropManager
                  images={backdropImages}
                  truncated={!backdropStore.storeClosed && backdropStore.truncated}
                  storeClosed={Boolean(backdropStore.storeClosed)}
                  defaultBackdrop={settings.appearance.defaultBackdrop}
                  pageBackdrops={settings.appearance.pageBackdrops}
                />
              ),
            },
            {
              key: "baoTri",
              label: settings.maintenance.active ? "Bảo Trì ●" : "Bảo Trì",
              // Tên miền đứng chung tab với bảo trì: cùng là thứ trưởng môn chạm vào khi hệ
              // thống trục trặc, và một cú dời tên miền thường là dịp nên bế quan.
              pane: (
                <div className="flex max-w-2xl flex-col gap-6">
                  <GameDomainForm baseUrl={settings.game.baseUrl} />
                  <MaintenanceForm maintenance={settings.maintenance} drain={drain} />
                </div>
              ),
            },
            // Tab Gương Trạm CHỈ mọc cho người mang site.switch (Gia chủ): với người khác
            // nó không tồn tại chứ không phải "có mà bấm vào bị mắng" — hàng rào thật vẫn
            // là action phía server, đây chỉ là phép lịch sự của giao diện.
            ...(hasPermission(viewer, "site.switch")
              ? [{
                  key: "guongTram",
                  label: "Gương Trạm",
                  pane: <MirrorPanel mirrors={await mirrorsForAdmin()} switchState={await switchStateForAdmin()} />,
                }]
              : []),
          ]}
        />
      </main>
    </>
  );
}
