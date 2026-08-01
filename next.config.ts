import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The control plane is small and personal; every page depends on the viewer's session,
  // so nothing here chases static generation. Keep the config minimal on purpose.
  reactStrictMode: true,

  /**
   * Bộ thông dịch nhiệm vụ phải đi cùng function, dù không dòng `import` nào trỏ tới nó.
   *
   * `runners/sandbox.ts` chỉ ĐỌC mấy tệp này rồi gửi sang VM. Trình phân tích phụ thuộc của
   * Next đi theo import, nên nếu không khai ở đây thì bundle sẽ thiếu chúng và mỗi lần thả
   * sandbox sẽ chết vì ENOENT — trên máy dev thì không bao giờ tái hiện, vì ở đó cả repo
   * nằm sẵn trên đĩa.
   */
  outputFileTracingIncludes: {
    // Khai cho MỌI route thay vì liệt kê /api/cron và /dashboard: cả route lẫn server
    // action đều thả được sandbox, và hôm nào có thêm chỗ thứ ba thì cái thiếu sẽ chỉ lộ ra
    // trên production. Tất cả chỗ này gộp lại chưa tới 130KB — quá rẻ so với một lỗi chỉ
    // xuất hiện sau khi deploy.
    "/**/*": ["./src/lib/quest-engine/**"],
  },
};

export default nextConfig;
