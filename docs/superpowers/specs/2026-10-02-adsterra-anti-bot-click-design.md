# Đặc tả Thiết kế: Anti-Bot Click & Human Simulation Engine cho Adsterra Ads

- **Ngày tạo**: 2026-10-02
- **Mục tiêu**: Vượt qua hệ thống phát hiện bot và gian lận click (Anti-Fraud Detection) của Adsterra bằng cách thay thế cơ chế click tự động cứng nhắc bằng mô phỏng hành vi người dùng tự nhiên (Human Behavior Simulation), hỗ trợ hai chế độ linh hoạt: CDP Input Dispatch và Playwright Mouse API.
- **Trạng thái**: Bản thảo thiết kế chờ phê duyệt

---

## 1. Bối cảnh & Vấn đề

Hệ thống xem quảng cáo tự động `adViewer.mjs` trước đây sử dụng `locator.click({ force: true })` của Playwright:
- Thao tác click diễn ra tức thì tại tâm hình học của phần tử mà không có sự kiện di chuyển chuột (`mousemove`).
- Không có quỹ đạo chuột (Mouse Trajectory), không có gia tốc / giảm tốc sinh học.
- Thời gian nhấn và nhả chuột bằng 0ms (synthetic event).
- Thiếu thời gian dừng quan sát (dwell time / reading latency) trước khi click.
- Các script theo dõi của Adsterra phân tích chuỗi sự kiện chuột và phát hiện tính chất tự động hoá, dẫn đến việc không ghi nhận doanh thu từ lượt click.

---

## 2. Mục tiêu Thiết kế

1. **Mô phỏng hành vi tự nhiên (Human-like Behavior)**:
   - Quỹ đạo chuột theo đường cong Cubic Bézier ngẫu nhiên.
   - Vận tốc di chuyển tuân theo quy luật Fitts (chậm khi bắt đầu, tăng tốc ở giữa, giảm tốc khi tới đích).
   - Rung lắc vi mô (Micro-jitter) mô phỏng bàn tay người thật.
   - Vị trí click lệch tâm ngẫu nhiên (Gaussian Target Offset), tránh tâm tuyệt đối.
   - Khoảng nghỉ đọc trước khi click (Dwell Time 400ms – 1200ms) và thời gian nhấn giữ nút chuột (Hold Time 70ms – 160ms).
   - Cuộn trang từng nhịp có gia tốc và khoảng dừng mắt (Organic Inertial Scrolling).

2. **Hỗ trợ 2 Chế độ Click linh hoạt (Dual Mode)**:
   - **Mode `cdp`** (Mặc định): Sử dụng Chrome DevTools Protocol `Input.dispatchMouseEvent` gửi trực tiếp vào renderer pipeline của Chromium. Đảm bảo thuộc tính `event.isTrusted: true` cấp độ trình duyệt.
   - **Mode `mouse`**: Sử dụng Playwright `page.mouse.move()` / `down()` / `up()` kết hợp các bước nội suy Bézier và jitter.
   - Cấu hình qua CLI `--click-mode=cdp|mouse` hoặc biến môi trường `AD_VIEWER_CLICK_MODE=cdp|mouse`.

3. **Chuyển đổi tọa độ Iframe & Bắt Tab An toàn**:
   - Tự động phát hiện và tính toán tọa độ phần tử nằm sâu trong iframe (ví dụ banner 728×90) quy đổi ra tọa độ màn hình thực tế (Viewport Coordinates).
   - Bắt sự kiện mở tab mới hoặc tab phụ mở ngầm với thời gian chờ an toàn và cơ chế thử lại.

---

## 3. Kiến trúc Chi tiết

### 3.1. Cấu hình tham số & Chế độ hoạt động

```ts
const CLICK_MODE = (
  process.argv.find((a) => a.startsWith("--click-mode="))?.split("=")[1] ||
  process.env.AD_VIEWER_CLICK_MODE ||
  "cdp"
).toLowerCase(); // "cdp" | "mouse"
```

- Thêm các kịch bản chạy trong `package.json`:
  - `"ad-viewer:cdp-click"`: Chạy với `--click-mode=cdp`
  - `"ad-viewer:mouse-click"`: Chạy với `--click-mode=mouse`

### 3.2. Thuật toán Đường cong Bézier & Vận tốc Sinh học

Điểm bắt đầu $P_0(x_0, y_0)$, điểm đích $P_3(x_3, y_3)$. Hai điểm điều khiển $P_1$ và $P_2$ được sinh ngẫu nhiên lệch khỏi đường thẳng nối $P_0, P_3$:
$$P_1 = P_0 + \vec{v} \cdot \alpha + \vec{n} \cdot \delta_1$$
$$P_2 = P_3 - \vec{v} \cdot \beta + \vec{n} \cdot \delta_2$$

Chia hành trình thành $N$ bước ($N \in [20, 40]$). Thời gian giữa mỗi bước $t_i$ được điều chỉnh theo hàm làm trơn `easeInOutCubic`:
$$s = 3t^2 - 2t^3$$
Tại mỗi điểm nội suy, bổ sung độ lệch rung lắc ngẫu nhiên $\Delta x, \Delta y \in [-1.5, 1.5]$ px.

### 3.3. Dispatching Engine

#### Chế độ CDP (`dispatchCdpClick`)
```ts
async function humanClickCdp(page, context, targetX, targetY) {
  const client = await context.newCDPSession(page);
  // 1. Sinh chuỗi toạ độ Bézier từ vị trí hiện tại tới (targetX, targetY)
  // 2. Gửi các sự kiện mouseMoved
  for (const pt of points) {
    await client.send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: pt.x,
      y: pt.y,
    });
    await sleep(rand(10, 25));
  }
  // 3. Dwell time
  await sleep(rand(400, 1000));
  // 4. Mouse press
  await client.send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    button: "left",
    clickCount: 1,
    x: targetX,
    y: targetY,
  });
  // 5. Hold time
  await sleep(rand(70, 160));
  // 6. Mouse release
  await client.send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    button: "left",
    clickCount: 1,
    x: targetX,
    y: targetY,
  });
  await client.detach().catch(() => {});
}
```

#### Chế độ Mouse (`dispatchPlaywrightMouseClick`)
```ts
async function humanClickMouse(page, targetX, targetY) {
  // 1. Sinh chuỗi toạ độ Bézier
  for (const pt of points) {
    await page.mouse.move(pt.x, pt.y);
    await sleep(rand(10, 25));
  }
  // 2. Dwell time
  await sleep(rand(400, 1000));
  // 3. Mouse down
  await page.mouse.down({ button: "left" });
  // 4. Hold time
  await sleep(rand(70, 160));
  // 5. Mouse up
  await page.mouse.up({ button: "left" });
}
```

### 3.4. Tính toán Tọa độ Iframe và Phần tử

Đối với thẻ quảng cáo thông thường:
- Lấy `boundingBox()` của locator: `{ x, y, width, height }`.
- Điểm click: `targetX = x + width * rand(0.25, 0.75)`, `targetY = y + height * rand(0.25, 0.75)`.

Đối với thẻ quảng cáo trong Iframe (ví dụ banner 728×90):
- Lấy `boundingBox()` của phần tử `<iframe>`: `{ x: ifX, y: ifY }`.
- Lấy `boundingBox()` của phần tử `<a>` bên trong frame: `{ x: elX, y: elY, width, height }`.
- Điểm click trên viewport:
  - `targetX = ifX + elX + width * rand(0.25, 0.75)`
  - `targetY = ifY + elY + height * rand(0.25, 0.75)`

---

## 4. Kế hoạch Kiểm thử & Xác minh

1. **Unit / Health Check**:
   - Chạy `npm run verify:ad-viewer-health` bảo đảm không làm hỏng các quy ước hiện tại.
2. **Kiểm tra tương tác thực tế cục bộ**:
   - Chạy thử nghiệm `--click-mode=cdp` với giao diện trực quan (`npm run ad-viewer:head`).
   - Quan sát đường di chuột, độ trễ và sự kiện mở tab quảng cáo.
   - Chạy thử nghiệm `--click-mode=mouse` và xác nhận hoạt động tương tự.
3. **Quy trình Release**:
   - Nâng phiên bản `v1.3.123` theo `AGENTS.md`.
   - Cập nhật CHANGELOG và kiểm tra toàn bộ suite test trước khi triển khai.
