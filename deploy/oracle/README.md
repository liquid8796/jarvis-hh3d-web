# Linh sứ tông môn trên Oracle Cloud Always Free

Worker "sống dai" của hệ thống — tiến trình `worker.mjs` chạy 24/7 trên một VM thuộc gói
**Always Free** của Oracle Cloud (OCI), thay thế hoàn toàn Vercel Sandbox từ v0.11. Nó cầm
`WORKER_TOKEN` toàn cục nên nhận job của **mọi** thành viên; giữ token đó như giữ chìa tàng
khố — không bao giờ đưa cho người dùng (họ có linh phù riêng, phát ở mục Linh Sứ).

## Vì sao chọn cấu hình này

| Lựa chọn | Giá trị | Lý do |
|---|---|---|
| Shape | **VM.Standard.A1.Flex** (Ampere ARM) | Gói Always Free cho tới 4 OCPU + 24GB RAM cho A1 — dư sức nuôi Chromium. Hai con `VM.Standard.E2.1.Micro` (x86, 1GB) cũng free nhưng 1GB thì Chromium chết ngạt. |
| OS | **Ubuntu 24.04 LTS (aarch64)** | Distro được Playwright hỗ trợ chính thức: `playwright install-deps` biết đúng danh sách gói hệ thống; Chromium có bản linux-arm64. Oracle Linux thì phải tự mò danh sách thư viện. |
| Kích cỡ | 2 OCPU / 12GB là đủ | Một worker chỉ chạy MỘT browser một lúc. Lấy 4/24 cũng được (vẫn free) nhưng vùng hay hết capacity A1 — yêu cầu càng nhỏ càng dễ được cấp. |
| Mạng | Chỉ mở SSH (22) | Worker chỉ gọi RA (HTTPS tới web + game). Không có cổng nào cần mở vào — bề mặt tấn công gần bằng không. |

## Tạo VM (console OCI, một lần)

1. Đăng ký/đăng nhập [cloud.oracle.com](https://cloud.oracle.com). Luu ý chọn **home region**
   cẩn thận (không đổi được): region gần (Singapore/Nhật/Hàn) cho độ trễ thấp về VN.
2. **Compute → Instances → Create instance**
   - Image: **Canonical Ubuntu 24.04** — bấm *Change image*, tick đúng bản **aarch64**
     (chọn shape Ampere trước thì console tự lọc).
   - Shape: **Ampere → VM.Standard.A1.Flex**, 2 OCPU / 12GB (kéo slider).
     *Nếu báo "Out of capacity": thử lại giờ khác, giảm về 1 OCPU/6GB, hoặc đổi AD.*
   - Networking: VCN mặc định (Create new nếu chưa có), **Assign public IPv4**.
   - SSH key: dán public key của bạn.
   - Boot volume: mặc định ~47GB là đủ (Chromium + Node ~2GB).
3. Create, chờ **Running**, ghi lại public IP.
4. Security list của subnet mặc định đã chỉ mở 22 — đúng ý, không mở thêm gì.

## Cài linh sứ (trên VM, một lệnh)

```bash
ssh ubuntu@<public-ip>

# rồi trong VM: lấy setup.sh từ repo (hoặc scp lên), và chạy:
WEB_URL='https://auto-hh3d.vercel.app' WORKER_TOKEN='<WORKER_TOKEN trên Vercel>' \
  sudo -E bash setup.sh
```

Script idempotent — **cập nhật engine = chạy lại đúng lệnh đó** (nó tải gói mới nhất từ
`/linh-su/goi-linh-su.tgz`, vốn được đóng lại ở mỗi deploy Vercel).

## Vận hành

```bash
journalctl -u auto-hh3d-linh-su -f     # nhật ký sống
systemctl status auto-hh3d-linh-su     # trạng thái
systemctl restart auto-hh3d-linh-su    # khởi động lại
```

- **Xoay token**: đổi `WORKER_TOKEN` trên Vercel → chạy lại setup.sh với token mới.
  Trong lúc hai bên lệch nhau, worker chỉ bị 401 rồi tự thử lại — không hỏng gì.
- **Kiểm tra sống**: mục Linh Sứ trên dashboard hiện "Linh sứ tông môn — đang trực".

## Rủi ro cần biết trước

- **IP datacenter**: site game nằm sau Cloudflare, và IP dải Oracle có thể bị thử thách
  gắt hơn IP dân cư. Engine đã có ReadinessProbe phát hiện màn chặn Cloudflare và thuật lại
  vào nhật ký job — nếu thấy dòng đó lặp lại nhiều, đường lui là linh sứ máy nhà (IP dân
  cư, cài một lệnh từ mục Linh Sứ).
- **Thu hồi Always Free**: Oracle có quyền thu hồi instance A1 của tài khoản Free Tier khi
  vùng thiếu tài nguyên (hiếm, nhưng có). Nâng cấp tài khoản lên Pay As You Go (vẫn không
  mất phí trong hạn mức Always Free) thì hết bị.
