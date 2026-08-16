import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The control plane is small and personal; every page depends on the viewer's session,
  // so nothing here chases static generation. Keep the config minimal on purpose.
  reactStrictMode: true,

  /**
   * Server Actions đi qua vỏ proxy Vercel PHẢI được khai host ở đây — không phải tuỳ chọn.
   *
   * Từ 16/08/2026 trình duyệt đứng ở `auto-hh3d*.vercel.app` còn app đứng sau Caddy trên VM,
   * nên lớp chống CSRF của Next so `origin` (vercel.app) với `x-forwarded-host` (sslip.io)
   * và huỷ MỌI action với「Invalid Server Actions request」— đo 16/08/2026: đăng nhập chết
   * trắng trang, journal ghi đúng câu ấy. GET không sao (không có lớp so này), nên mọi phép
   * probe chỉ đọc trang đều xanh trong khi form nào cũng hỏng.
   *
   * Danh sách ĐÍCH DANH chứ không phải `*.vercel.app`: wildcard là mở cửa CSRF cho mọi
   * deployment vercel.app trên đời đổi lấy việc đỡ một dòng khi thêm trạm.
   */
  experimental: {
    serverActions: {
      allowedOrigins: [
        "auto-hh3d.vercel.app",
        "auto-hh3d-1.vercel.app",
        "auto-hh3d-2.vercel.app",
        "auto-hh3d-3.vercel.app",
        "auto-hh3d-4.vercel.app",
        "92.5.130.32.sslip.io",
      ],
    },
  },

  /**
   * Hai script cài khôi lỗi PHẢI được khai là UTF-8 — không phải chuyện thẩm mỹ.
   *
   * Next phục vụ tệp trong public/ với `application/octet-stream`, KHÔNG kèm charset. Mà
   * `Invoke-RestMethod` của PowerShell 5.1 (bản có sẵn trên mọi máy Windows) khi không thấy
   * charset thì mặc định giải mã ISO-8859-1 — nên mọi chữ tiếng Việt trong script biến thành
   * ký tự rác NGAY TRƯỚC KHI `iex` chạy nó. Đo được: "Cài khôi lỗi" ra "CÃ i linh sá»©".
   *
   * Người dùng vẫn cài xong (mã lệnh là ASCII), nhưng họ đọc một màn hình đầy rác và không
   * biết chuyện gì đang xảy ra với máy mình — với một script tải runtime về chạy thì đó là
   * điều tệ nhất có thể xảy ra cho lòng tin.
   */
  async headers() {
    return [
      {
        source: "/linh-su/:script(install\\.ps1|install\\.sh)",
        headers: [{ key: "Content-Type", value: "text/plain; charset=utf-8" }],
      },
    ];
  },
};

export default nextConfig;
