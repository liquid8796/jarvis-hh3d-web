import { redirect } from "next/navigation";
import { SiteHeader } from "@/components/SiteHeader";
import { SectSeal } from "@/components/SectSeal";
import { requireUser } from "@/lib/auth/guards";

export const metadata = { title: "Chờ Duyệt" };

/** Phòng chờ: đã bái sư nhưng trưởng môn chưa điểm danh — hoặc đã bị đóng cửa. */
export default async function PendingPage() {
  const user = await requireUser();
  if (user.status === "active") {
    redirect("/dashboard");
  }

  const disabled = user.status === "disabled";

  return (
    <>
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-lg flex-col items-center px-6 py-20 text-center">
        <div className="card card-hairline rise-in w-full p-10">
          <SectSeal size="4.4rem" />
          <h1 className="h-display mt-6 text-2xl font-bold text-gilded">
            {disabled ? "Đạo hiệu đã bị phong ấn" : "Thiếp bái sư đã dâng lên"}
          </h1>
          <p className="mt-4 text-sm leading-relaxed text-[var(--color-mist)]">
            {disabled
              ? "Tông môn đã tạm đóng cửa với đạo hiệu này. Muốn rõ nguyên do, hãy liên hệ trưởng môn."
              : "Trưởng môn sẽ xét duyệt trong thời gian tới. Khi được thu nhận, Linh Đài và đàn pháp tự động sẽ mở ra với đạo hữu — quay lại sau nhé."}
          </p>
          <p className="mt-6 text-xs text-[var(--color-mist)]">
            Danh xưng: <span className="text-gilded">{user.displayName}</span> · Đạo hiệu:{" "}
            <span className="text-gilded">{user.username}</span>
          </p>
        </div>
      </main>
    </>
  );
}
