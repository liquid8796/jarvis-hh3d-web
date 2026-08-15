import pkg from "../../package.json";
import { ChangelogTag } from "./ChangelogTag";
import { DEFAULT_RELEASE_NOTES, mergeReleaseNotes } from "@/lib/changelog";
import { getRenderSettings } from "@/lib/services/settings";

/**
 * DẤU BẢN — số phiên bản của chính bản web đang chạy, ghim ở góc dưới bên trái màn hình, và từ
 * bản 0.86.0 là cửa mở BẢN TIN CẬP NHẬT.
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
 * thứ đi ra trình duyệt đúng bằng chuỗi số và danh sách tin. Đó cũng là lý do phần bấm được
 * nằm ở một tệp riêng (`ChangelogTag`) thay vì gắn `"use client"` lên chính tệp này: đổi tệp
 * này thành client là ném nguyên `package.json` — gồm cả danh sách phụ thuộc và mọi npm
 * script — sang trình duyệt.
 *
 * LƯỢT ĐỌC SỔ Ở ĐÂY KHÔNG TỐN THÊM MỘT CÂU TRUY VẤN NÀO: `getRenderSettings` là `cache()` của
 * React, mà layout gốc đã gọi nó cho cửa bế quan và tấm nền trong cùng lượt dựng.
 */
export async function AppVersion() {
  // Trường `version` là bắt buộc trong package.json nên TypeScript đã chốt nó là string; chỉ
  // còn ca chuỗi RỖNG là có thật (ai đó xoá số mà quên điền lại). Khai "v" trơn thì vô nghĩa.
  const version = pkg.version.trim();
  if (!version) return null;

  const settings = await getRenderSettings();
  const notes = mergeReleaseNotes(DEFAULT_RELEASE_NOTES, settings.changelog.notes, settings.changelog.hidden);

  return <ChangelogTag version={version} notes={notes} />;
}
