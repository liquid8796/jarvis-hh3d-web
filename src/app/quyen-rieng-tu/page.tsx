import { SiteHeader } from "@/components/SiteHeader";

export const metadata = {
  title: "Quyền Riêng Tư",
  description: "Cách Auto HH3D xử lý dữ liệu tài khoản, nhật ký vận hành và quảng cáo Google AdSense/Adsterra.",
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-[rgba(155,150,190,.14)] pt-5 first:border-t-0 first:pt-0">
      <h2 className="h-display text-lg font-semibold text-gilded">{title}</h2>
      <div className="mt-3 space-y-3 text-sm leading-7 text-[var(--color-mist)]">{children}</div>
    </section>
  );
}

/** Public disclosure for first-party account data and third-party advertising data. */
export default function PrivacyPage() {
  return (
    <>
      <SiteHeader />
      <main data-backdrop="admin" className="mx-auto w-full max-w-4xl px-4 pb-24 sm:px-6">
        <article className="rise-in mt-6 overflow-hidden rounded-2xl border border-[rgba(232,194,92,.2)] bg-[linear-gradient(145deg,rgba(31,27,55,.95),rgba(12,10,26,.98))] shadow-[0_24px_70px_rgba(0,0,0,.32)]">
          <header className="border-b border-[rgba(155,150,190,.14)] px-5 py-6 sm:px-8">
            <p className="text-xs font-bold uppercase tracking-[.16em] text-[var(--color-gold-300)]">Minh bạch dữ liệu</p>
            <h1 className="h-display mt-1 text-2xl font-bold text-gilded sm:text-3xl">Quyền riêng tư</h1>
            <p className="mt-3 text-sm leading-6 text-[var(--color-mist)]">Cập nhật ngày 01/10/2026.</p>
          </header>

          <div className="space-y-6 px-5 py-6 sm:px-8 sm:py-8">
            <Section title="Dữ liệu Auto HH3D xử lý">
              <p>
                Khi bạn đăng ký hoặc sử dụng hệ thống, Auto HH3D có thể lưu thông tin tài khoản, cấu hình nhiệm vụ,
                trạng thái hàng đợi, nhật ký chạy và dữ liệu kỹ thuật cần thiết để đăng nhập, bảo mật và vận hành dịch vụ.
              </p>
              <p>
                Nhật ký kỹ thuật có thể gồm thời điểm truy cập, địa chỉ IP, loại trình duyệt, lỗi và mã định danh phiên.
                Chúng được dùng để bảo vệ tài khoản, chẩn đoán sự cố và ngăn lạm dụng.
              </p>
            </Section>

            <Section title="Google AdSense và cookie quảng cáo">
              <p>
                Website có thể sử dụng Google AdSense khi tài khoản nhà xuất bản đã được cấu hình và Google duyệt tên miền. Google và các đối tác quảng cáo có thể đặt hoặc đọc cookie, dùng web beacon,
                địa chỉ IP, thông tin thiết bị và các mã định danh khác để phân phối, đo lường và chống gian lận quảng cáo.
              </p>
              <p>
                Quảng cáo có thể được cá nhân hoá hoặc không cá nhân hoá tuỳ khu vực, lựa chọn đồng ý và cài đặt tài khoản Google.
                Bạn có thể quản lý lựa chọn quảng cáo tại{" "}
                <a className="text-[var(--color-gold-300)] underline underline-offset-4" href="https://myadcenter.google.com/" target="_blank" rel="noreferrer">
                  Trung tâm quảng cáo của tôi
                </a>.
              </p>
              <p>
                Xem thêm cách Google sử dụng dữ liệu trên website đối tác tại{" "}
                <a className="text-[var(--color-gold-300)] underline underline-offset-4" href="https://policies.google.com/technologies/partner-sites?hl=vi" target="_blank" rel="noreferrer">
                  chính sách dành cho website và ứng dụng đối tác của Google
                </a>.
              </p>
            </Section>

            <Section title="Adsterra và định dạng quảng cáo">
              <p>
                Website có thể tải quảng cáo Adsterra gồm Social Bar và Popunder trên tên miền chính thức.
                Adsterra và các đối tác phân phối của họ có thể xử lý địa chỉ IP, thông tin trình duyệt/thiết bị, cookie và tín hiệu chống gian lận để phân phối và đo lường quảng cáo.
              </p>
              <p>
                Mã Popunder và Social Bar do chính Adsterra trả về theo cấu hình zone của website.
                Auto HH3D không tự kiểm tra tiện ích trình duyệt, không khoá quyền truy cập khi bạn chặn quảng cáo và không thêm cơ chế vượt chặn riêng ngoài mã nhà cung cấp.
              </p>
            </Section>

            <Section title="Chia sẻ và thời gian lưu">
              <p>
                Auto HH3D không bán thông tin đăng nhập hoặc cấu hình nhiệm vụ của bạn. Dữ liệu chỉ được chia sẻ với nhà cung cấp
                hạ tầng, cơ sở dữ liệu, bảo mật và quảng cáo trong phạm vi cần thiết để cung cấp dịch vụ.
              </p>
              <p>
                Dữ liệu được giữ trong thời gian cần thiết cho hoạt động, bảo mật, giải quyết tranh chấp và nghĩa vụ pháp lý;
                sau đó được xoá hoặc ẩn danh theo khả năng kỹ thuật và yêu cầu áp dụng.
              </p>
            </Section>

            <Section title="Quyền lựa chọn và liên hệ">
              <p>
                Bạn có thể chặn hoặc xoá cookie trong trình duyệt, thay đổi cài đặt quảng cáo Google, chặn nội dung quảng cáo bên thứ ba, hoặc ngừng sử dụng dịch vụ.
                Việc chặn cookie có thể làm một số chức năng đăng nhập hoặc quảng cáo hoạt động không đầy đủ.
              </p>
              <p>Khi cần hỏi về dữ liệu tài khoản, hãy liên hệ quản trị viên qua Phòng Chat sau khi đăng nhập.</p>
            </Section>
          </div>
        </article>
      </main>
    </>
  );
}
