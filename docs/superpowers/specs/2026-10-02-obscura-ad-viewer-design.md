# Chuyển đổi Trình duyệt Xem Quảng Cáo sang Obscura & Viết lại CanvasBlocker

**Ngày:** 2026-10-02  
**Mục tiêu:** Thay thế Chromium bằng trình duyệt không đầu Obscura (`h4ckf0r0day/obscura`) cho riêng tiến trình xem và click quảng cáo Adsterra, không bật cờ `--stealth`, và chuyển đổi tiện ích CanvasBlocker thành CDP init script tương thích hoàn toàn với Obscura. Khôi lỗi tông môn (worker) giữ nguyên Chromium.

---

## 1. Bối cảnh & Yêu cầu
1. **Thay thế Chromium trong Ad Viewer**:
   - Chromium tốn nhiều dung lượng (~130MB-400MB) và RAM (~300MB+).
   - Obscura là browser engine không đầu viết bằng Rust với V8 nhúng, hỗ trợ giao thức Chrome DevTools Protocol (CDP), rất nhẹ (~40-68MB nén, ~30MB RAM).
   - Chỉ áp dụng cho workflow xem quảng cáo (`deploy/github/xem-quang-cao.yml`, `scripts/adViewer.mjs`, `scripts/buildAdViewerBundle.mjs`). Tuyệt đối không thay đổi workflow khôi lỗi tông môn (`linh-su.yml`, `scripts/worker.mjs`).
2. **Không bật cờ `--stealth`**:
   - Obscura khi bật `--stealth` sẽ kích hoạt bộ chặn tracker/ad (3.520 domain), khiến Adsterra và đối tác bị chặn hoàn toàn.
   - Obscura phải chạy ở chế độ thường: `obscura serve --port <port> --allow-private-network`.
3. **Viết lại CanvasBlocker cho Obscura**:
   - Obscura không hỗ trợ Chrome Extension (`--load-extension`).
   - Viết lại chức năng của CanvasBlocker thành CDP Init Script (`page.addInitScript(...)`) tự động gieo nhiễu canvas/webgl chống fingerprinting trên mỗi chu kỳ.

---

## 2. Thiết kế Kiến trúc

### A. Module CanvasBlocker cho Obscura (`scripts/obscuraCanvasBlocker.mjs`)
- Xuất hàm `getCanvasBlockerInitScript(cycleSeed)` tạo chuỗi JavaScript inject ở `document_start`.
- Can thiệp:
  - `HTMLCanvasElement.prototype.toDataURL`
  - `HTMLCanvasElement.prototype.toBlob`
  - `CanvasRenderingContext2D.prototype.getImageData`
  - `WebGLRenderingContext.prototype.readPixels` và `WebGL2RenderingContext.prototype.readPixels`
- Gieo nhiễu pseudorandom dựa trên seed mỗi chu kỳ, giữ giá trị hash ổn định trong cùng một chu kỳ nhưng khác biệt giữa các chu kỳ để chống theo dõi liên chu kỳ.
- Bọc ngụy trang `Function.prototype.toString` trả về `function ...() { [native code] }`.
- Đánh dấu cờ `window.__obscura_canvas_blocker__ = true`.

### B. Quản lý Obscura Server trong `scripts/adViewer.mjs`
- Tìm kiếm binary `obscura` (trên Linux runner tại `$XEM_QC_RUNTIME/obscura`, hoặc đường dẫn cấu hình `OBSCURA_BIN`, hoặc PATH, hoặc temp dev binary).
- Khởi chạy tiến trình `obscura serve --port <port> --allow-private-network`.
- Kết nối Playwright: `chromium.connectOverCDP('ws://127.0.0.1:<port>')`.
- Inject `getCanvasBlockerInitScript(seed)` vào context/page.
- Tải trang chủ `https://auto-hh3d.online`, chờ placements ready.
- Xử lý click: click Smartlink / Banner / Native. Do Obscura chuyển hướng ngay trên tab hiện tại khi mở link mới, script theo dõi sự kiện chuyển hướng (`page.url()`), chờ 6–10s đọc trang đích, rồi thực hiện đệ quy nếu có ads tiếp theo.
- Sau mỗi chu kỳ, dọn dẹp context, restart hoặc reset Obscura để bắt đầu chu kỳ mới.

### C. Workflow GitHub Actions (`deploy/github/xem-quang-cao.yml`)
- Thay bước cài đặt Chromium:
  - Tải `https://github.com/h4ckf0r0day/obscura/releases/download/v0.2.3/obscura-x86_64-linux.tar.gz`.
  - Giải nén vào `$XEM_QC_RUNTIME/bin/obscura`.
- Khởi chạy `ad-viewer.mjs` với `OBSCURA_BIN="$XEM_QC_RUNTIME/bin/obscura"`.

### D. Gói phát hành `public/xem-qc/goi-xem-qc.tgz` (`scripts/buildAdViewerBundle.mjs`)
- Đóng gói: `ad-viewer.mjs`, `obscuraCanvasBlocker.mjs`, `playwright-core`, `package.json`.
- Bỏ thư mục extension `deploy/extensions/canvas-blocker` khỏi gói xem quảng cáo.

### E. Kiểm chứng (`scripts/verifyAdViewerHealth.mts`)
- Kiểm tra tính toàn vẹn của `scripts/obscuraCanvasBlocker.mjs`.
- Kiểm tra `adViewer.mjs` sử dụng Obscura CDP server, `connectOverCDP`, inject CanvasBlocker.
- Kiểm tra `xem-quang-cao.yml` tải đúng release Obscura v0.2.3 Linux.
