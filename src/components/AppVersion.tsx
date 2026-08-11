import pkg from "../../package.json";

/**
 * DẤU BẢN — số phiên bản của chính bản web đang chạy, ghim ở góc dưới bên trái màn hình.
 *
 * Vì sao đọc thẳng `package.json` chứ không qua một biến môi trường: con số ấy vốn đã sống ở
 * đó và được nâng theo từng lượt phát hành (0.67.0 → 0.68.0 trong đúng một ngày). Thêm một
 * biến môi trường là thêm một chỗ để quên, và ngày nó quên thì trang khai một con số SAI —
 * tệ hơn hẳn việc không khai gì, vì người đọc sẽ tin.
 *
 * `process.env.npm_package_version` thì không dùng được: nó chỉ tồn tại trong tiến trình npm
 * lúc build, còn lúc chạy trên Vercel là rỗng — trang sẽ im lặng không hiện gì.
 *
 * Đây là Server Component (không `"use client"`), nên `package.json` chỉ nằm lại phía server;
 * thứ đi ra trình duyệt đúng bằng chuỗi số.
 */
export function AppVersion() {
  // Trường `version` là bắt buộc trong package.json nên TypeScript đã chốt nó là string; chỉ
  // còn ca chuỗi RỖNG là có thật (ai đó xoá số mà quên điền lại). Khai "v" trơn thì vô nghĩa.
  const version = pkg.version.trim();
  if (!version) return null;

  return <p className="app-version">v{version}</p>;
}
