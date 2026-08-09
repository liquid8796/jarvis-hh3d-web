/**
 * Hai phép nguyên thuỷ để dứt điểm một tiến trình trình duyệt, dùng chung bởi `shotPage` và
 * `sweepBrowsers`. Tách ra vì cả hai đều cần, và vì một phép GIẾT thì chỉ nên có đúng một bản.
 */
import { execFileSync } from "node:child_process";

/**
 * Tiến trình này còn sống không.
 *
 * Tín hiệu 0 không gửi gì cả, nó chỉ hỏi. Đây là phép hỏi DUY NHẤT đáng tin trong môi trường
 * này: `tasklist` và `Get-CimInstance Win32_Process` đều trả về rỗng ngay cả lúc Chromium
 * đang chạy (đo 09/08/2026), nên mọi thứ dựa vào việc liệt kê tiến trình đều không kiểm
 * chứng được.
 */
export function stillAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    // EPERM cũng rơi vào đây: tiến trình CÓ tồn tại nhưng ta không có quyền. Coi như "không
    // đụng được" — mà với phép dọn thì hai chuyện ấy dẫn tới cùng một hành động: bỏ qua.
    return false;
  }
}

/**
 * Giết CẢ CÂY theo PID. Trả về `true` nếu sau đó tiến trình đã tắt.
 *
 * `/T` là phần bắt buộc: Chromium đẻ ra một đàn tiến trình con (renderer, GPU, network), và
 * giết mỗi tiến trình chính có thể để lại chúng mồ côi — đúng thứ làm máy nặng mà nhìn vào
 * Task Manager thì không hiểu của ai.
 *
 * Theo PID, TUYỆT ĐỐI không theo tên: Chromium của Playwright cũng tên `chrome.exe`, nên một
 * lệnh `taskkill /IM chrome.exe` là đóng luôn mọi tab Chrome thật của chủ máy.
 */
export function killByPid(pid: number): boolean {
  try {
    execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
  } catch {
    // taskkill trả mã khác 0 cả khi tiến trình đã tự chết trước đó — nên đừng tin mã thoát,
    // hỏi lại bằng tín hiệu 0 ở dưới.
  }
  return !stillAlive(pid);
}
