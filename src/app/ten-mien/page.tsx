import { DomainsPanel } from "@/components/DomainsPanel";
import { SiteHeader } from "@/components/SiteHeader";

export const metadata = { title: "Tên Miền" };

/**
 * Danh bạ tên miền là thông tin công khai, nên khách chưa nhập môn cũng mở được từ top menu.
 * Trang chỉ đọc catalog tĩnh; các form đổi cấu hình tên miền game vẫn nằm sau quyền quản trị.
 */
export default function DomainsPage() {
  return (
    <>
      <SiteHeader />
      <main data-backdrop="admin" className="mx-auto w-full max-w-5xl px-4 pb-24 sm:px-6">
        <div className="rise-in mt-6">
          <DomainsPanel />
        </div>
      </main>
    </>
  );
}
