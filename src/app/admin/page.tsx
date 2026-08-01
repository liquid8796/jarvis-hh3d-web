import { SiteHeader } from "@/components/SiteHeader";
import { requireAdmin } from "@/lib/auth/guards";
import { countPending, listUsers } from "@/lib/services/users";
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

  const [users, pending] = await Promise.all([
    listUsers({ search: params.q, status }),
    countPending(),
  ]);

  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-6xl px-6 pb-24">
        <div className="rise-in mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="h-display text-3xl font-bold text-gilded">Tông Môn</h1>
            <p className="mt-1 text-sm text-[var(--color-mist)]">
              Sổ bộ môn đồ — duyệt người mới, phong quyền, đình quyền, trục xuất.
            </p>
          </div>
          {pending > 0 && (
            <span className="badge badge-pending">
              {pending} đạo hữu đang chờ duyệt
            </span>
          )}
        </div>

        <div className="mb-6">
          <CreateUserPanel />
        </div>

        <UserTable users={users} query={params.q ?? ""} status={status ?? ""} />
      </main>
    </>
  );
}
