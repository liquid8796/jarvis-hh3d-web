import { SiteHeader } from "@/components/SiteHeader";
import { requireActiveUser } from "@/lib/auth/guards";
import { listAccounts } from "@/lib/services/accounts";
import { getEditableConfig } from "@/lib/services/configs";
import { getActiveJobs } from "@/lib/services/jobs";
import { hasWorkerToken } from "@/lib/services/workers";
import { ConfigForm } from "./ConfigForm";
import { ControlPanel } from "./ControlPanel";
import { DashboardLiveProvider } from "./DashboardLiveProvider";
import { LinhSuPanel } from "./LinhSuPanel";

export const metadata = { title: "Linh Đài" };

/**
 * Bề rộng khung Linh Đài — thanh trên cùng và phần nội dung dùng CHUNG hằng số này, nếu
 * không header sẽ thụt vào so với hàng thẻ (trước 05/08 header 1024px đứng trên nội dung
 * 1152px, lệch 64px mỗi bên).
 *
 * 100rem = 1600px: trang này là bàn làm việc hai cột — danh sách tài khoản, hai tab nhiệm
 * vụ với lưới tuỳ chọn hai cột, nhật ký chạy — nên 1152px cũ ép mỗi cột còn ~566px và mọi
 * thứ bên trong phải chen nhau. Vẫn có trần, không thả tự do: một biểu mẫu kéo ngang hết
 * màn 2560px thì mắt phải quét quá xa, và các dòng chữ dài ra là khó đọc hơn chứ không dễ.
 */
const SHELL_WIDTH = "max-w-[100rem]";

/**
 * Linh Đài — trang làm việc của một đạo hữu đã được thu nhận: cấu hình đàn pháp bên trái,
 * lư khai đàn + nhật ký tu luyện bên phải. Server component đọc; mọi ghi đi qua actions.
 */
export default async function DashboardPage() {
  const user = await requireActiveUser();
  const [config, accounts, activeJobs, tokenIssued] = await Promise.all([
    getEditableConfig(user.id),
    listAccounts(user.id),
    getActiveJobs(user.id),
    hasWorkerToken(user.id),
  ]);

  return (
    <>
      <SiteHeader maxWidth={SHELL_WIDTH} />
      {/* Lề ngang giữ đúng `px-4 sm:px-6` như thanh trên cùng — hai bên phải cùng một con
          số, nếu không thì ấn môn phái sẽ lệch vài pixel so với mép thẻ bên dưới. */}
      <main className={`mx-auto w-full ${SHELL_WIDTH} px-4 pb-24 sm:px-6`}>
        <div className="rise-in mb-8">
          <h1 className="h-display text-3xl font-bold text-gilded">Linh Đài</h1>
          {/* Ba bước, nói ngay ở dòng đầu. Người mới mở trang này cần biết mình phải làm gì,
              chứ không cần một câu chào hay ho. */}
          <p className="mt-1 text-sm text-[var(--color-mist)]">
            Chào <span className="text-gilded">{user.displayName}</span>. Ba bước: thêm tài khoản
            game → chọn nhiệm vụ → bấm Khai Đàn. Nhiều tài khoản thì chạy cùng lúc cả đội.
          </p>
        </div>

        {/* `minmax(0,…)` chứ không phải `1.1fr_1fr` trần, và `min-w-0` trên cột dọc.
            Grid item lẫn flex item đều mặc định `min-width: auto` — tức "không co nhỏ hơn
            nội dung". Một dòng lệnh cài dài không chỗ ngắt trong <pre> vì thế ĐẨY cột phải
            phình ra ngoài phần của nó và bóp cột trái còn một sợi chỉ (ảnh 02/08). Và
            `overflow-x-auto` trên chính cái <pre> không cứu được: nó chỉ có tác dụng khi
            mọi tổ tiên đều được phép co xuống dưới bề rộng nội dung. */}
        <DashboardLiveProvider initialAccounts={accounts}>
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] xl:gap-8">
            <ConfigForm config={config} />
            <div className="flex min-w-0 flex-col gap-6 xl:gap-8">
              <ControlPanel initiallyRunning={activeJobs.length > 0} />
              <LinhSuPanel hasToken={tokenIssued} />
            </div>
          </div>
        </DashboardLiveProvider>
      </main>
    </>
  );
}
