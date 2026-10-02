# Tích Hợp Trình Duyệt Obscura & Viết Lại CanvasBlocker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Chuyển đổi toàn bộ trình duyệt xem quảng cáo Adsterra sang Obscura v0.2.3 (chạy không bật `--stealth`), viết lại CanvasBlocker thành CDP init script, cập nhật workflow GitHub Actions tải Obscura Linux, đóng gói và phát hành bản cập nhật.

**Architecture:** Tạo module `obscuraCanvasBlocker.mjs` tạo init script can thiệp Canvas/WebGL. Sửa `adViewer.mjs` quản lý tiến trình `obscura serve` và kết nối qua `chromium.connectOverCDP`. Cập nhật workflow `xem-quang-cao.yml` và script đóng gói `buildAdViewerBundle.mjs`.

**Tech Stack:** Node.js, Obscura CDP server (v0.2.3), Playwright-core (`connectOverCDP`), GitHub Actions, Next.js.

**Spec:** `docs/superpowers/specs/2026-10-02-obscura-ad-viewer-design.md`

## Global Constraints
- Chỉ thay đổi workflow và script của **Xem Quảng Cáo** (`deploy/github/xem-quang-cao.yml`, `scripts/adViewer.mjs`, `scripts/buildAdViewerBundle.mjs`).
- Khôi lỗi tông môn (`deploy/github/linh-su.yml`, `scripts/worker.mjs`, `scripts/buildWorkerBundle.mjs`) giữ nguyên Chromium 100%.
- Không bật cờ `--stealth` trên Obscura để tránh chặn quảng cáo Adsterra.
- Giữ nguyên các quy định của `AGENTS.md` khi phát hành (bump patch version, update changelog, build, push, deploy backend, proxies, github stations).

## Review Focus
1. CanvasBlocker init script can thiệp đúng `toDataURL`, `toBlob`, `getImageData`, `readPixels` mà không làm crash trang.
2. `adViewer.mjs` khởi động được `obscura serve`, chờ port ready, kết nối thành công qua CDP.
3. Khi click vào liên kết quảng cáo hoặc Smartlink trong Obscura, script phát hiện được URL thay đổi và không bị văng lỗi.
4. Workflow `xem-quang-cao.yml` tải và giải nén đúng binary `obscura` trên Ubuntu Linux.
5. Gói `public/xem-qc/goi-xem-qc.tgz` đóng gói đầy đủ `ad-viewer.mjs`, `obscuraCanvasBlocker.mjs`, `package.json`, `playwright-core`.

---

### Task 1: Viết module CanvasBlocker cho Obscura (`scripts/obscuraCanvasBlocker.mjs`)

**Files:**
- Create: `scripts/obscuraCanvasBlocker.mjs`
- Test: `scripts/verifyCanvasBlocker.mjs`

**Interfaces:**
- Produces: `getCanvasBlockerInitScript(seed: number | string): string`

- [ ] **Step 1: Viết script test kiểm tra tính đúng đắn của CanvasBlocker init script**
- [ ] **Step 2: Chạy test để xác nhận test chạy**
- [ ] **Step 3: Triển khai `scripts/obscuraCanvasBlocker.mjs`**
  - Chặn `HTMLCanvasElement.prototype.toDataURL`
  - Chặn `HTMLCanvasElement.prototype.toBlob`
  - Chặn `CanvasRenderingContext2D.prototype.getImageData`
  - Chặn `WebGLRenderingContext.prototype.readPixels` và `WebGL2RenderingContext.prototype.readPixels`
  - Tạo nhiễu giả ngẫu nhiên dựa trên seed
  - Mask `toString()` thành `[native code]`
- [ ] **Step 4: Chạy lại test xác nhận PASS**

---

### Task 2: Nâng cấp `scripts/adViewer.mjs` sang Obscura CDP Server & CanvasBlocker

**Files:**
- Modify: `scripts/adViewer.mjs`

**Interfaces:**
- Consumes: `getCanvasBlockerInitScript` từ `scripts/obscuraCanvasBlocker.mjs`
- Produces: `runOneCycle(obscuraBin)` khởi chạy Obscura, connect over CDP, inject CanvasBlocker, xem và click ads.

- [ ] **Step 1: Cập nhật hàm tìm binary Obscura (`resolveObscuraBin`)**
  - Hỗ trợ biến môi trường `OBSCURA_BIN`
  - Hỗ trợ thư mục cục bộ `bin/obscura` hoặc `$TEMP/obscura-spike/bin/obscura.exe` hoặc PATH
- [ ] **Step 2: Cập nhật quản lý tiến trình con `obscura serve --port <port> --allow-private-network`**
  - Chờ port sẵn sàng qua `/json/version`
  - Kết nối `chromium.connectOverCDP`
- [ ] **Step 3: Nạp `getCanvasBlockerInitScript` qua `page.addInitScript`**
- [ ] **Step 4: Cập nhật cơ chế xem và click quảng cáo tương thích với hành vi điều hướng in-place của Obscura**
  - Click Smartlink hoặc Creative
  - Chờ đọc trang đích 6–10s
  - Dọn dẹp tiến trình Obscura và context sau mỗi chu kỳ
- [ ] **Step 5: Chạy thử nghiệm 1 chu kỳ cục bộ xác nhận hoạt động**

---

### Task 3: Cập nhật đóng gói bundle `scripts/buildAdViewerBundle.mjs`

**Files:**
- Modify: `scripts/buildAdViewerBundle.mjs`

- [ ] **Step 1: Chép `obscuraCanvasBlocker.mjs` vào staging cùng `adViewer.mjs`**
- [ ] **Step 2: Loại bỏ phụ thuộc vào thư mục extension `deploy/extensions/canvas-blocker`**
- [ ] **Step 3: Đóng gói và kiểm tra dung lượng `public/xem-qc/goi-xem-qc.tgz`**

---

### Task 4: Cập nhật workflow GitHub Actions `deploy/github/xem-quang-cao.yml`

**Files:**
- Modify: `deploy/github/xem-quang-cao.yml`

- [ ] **Step 1: Thay thế bước `Install Chromium` bằng bước tải và giải nén Obscura Linux binary**
  - URL: `https://github.com/h4ckf0r0day/obscura/releases/download/v0.2.3/obscura-x86_64-linux.tar.gz`
  - Giải nén vào `$XEM_QC_RUNTIME/bin`
- [ ] **Step 2: Truyền `OBSCURA_BIN: "$XEM_QC_RUNTIME/bin/obscura"` vào bước chạy xem quảng cáo**

---

### Task 5: Cập nhật bộ kiểm chứng `scripts/verifyAdViewerHealth.mts`

**Files:**
- Modify: `scripts/verifyAdViewerHealth.mts`

- [ ] **Step 1: Cập nhật các assertion xác nhận Obscura CDP server, `connectOverCDP`, `obscuraCanvasBlocker`, và URL tải release Obscura v0.2.3**
- [ ] **Step 2: Chạy `npm run verify:ad-viewer-health` và `npm run verify:github-deploy` xác nhận tất cả xanh**

---

### Task 6: Kiểm tra toàn diện & Phát hành bản mới (v1.3.120) theo `AGENTS.md`

- [ ] **Step 1: Bump version lên `1.3.120` trong `package.json` và `package-lock.json`**
- [ ] **Step 2: Cập nhật `src/lib/changelog.ts` và `CHANGELOG.md`**
- [ ] **Step 3: Chạy toàn bộ kiểm tra: `verify:changelog`, `verify:ad-viewer-health`, `verify:github-deploy`, `npx tsc --noEmit`, `npm run build`**
- [ ] **Step 4: Commit và push lên `origin/master`**
- [ ] **Step 5: Deploy backend (`npm run deploy:backend`), deploy proxy (`npm run deploy:proxy`), deploy GitHub stations (`npm run vm -- npm run github:deploy`)**
- [ ] **Step 6: Xác thực production và báo cáo hoàn thành**
