import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The control plane is small and personal; every page depends on the viewer's session,
  // so nothing here chases static generation. Keep the config minimal on purpose.
  reactStrictMode: true,

  /**
   * Hai script cài linh sứ PHẢI được khai là UTF-8 — không phải chuyện thẩm mỹ.
   *
   * Next phục vụ tệp trong public/ với `application/octet-stream`, KHÔNG kèm charset. Mà
   * `Invoke-RestMethod` của PowerShell 5.1 (bản có sẵn trên mọi máy Windows) khi không thấy
   * charset thì mặc định giải mã ISO-8859-1 — nên mọi chữ tiếng Việt trong script biến thành
   * ký tự rác NGAY TRƯỚC KHI `iex` chạy nó. Đo được: "Cài linh sứ" ra "CÃ i linh sá»©".
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
