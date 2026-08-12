#!/usr/bin/env bash
# =============================================================================
# Dựng KHÔI LỖI TÔNG MÔN trên VM Oracle Cloud Always Free — Ubuntu 24.04 aarch64.
#
# Chạy TRÊN VM (user mặc định `ubuntu`, có sudo):
#   WEB_URL='https://auto-hh3d.vercel.app' WORKER_TOKEN='<token tông môn>' \
#     sudo -E bash setup.sh
#
# Idempotent: chạy lại = cập nhật (tải gói mới nhất, cài lại thư viện, restart service).
# Xem deploy/oracle/README.md cho phần tạo VM trên console OCI.
# =============================================================================
set -euo pipefail

WEB_URL="${WEB_URL:-}"
WORKER_TOKEN="${WORKER_TOKEN:-}"
APP_DIR="/opt/auto-hh3d/linh-su"
APP_USER="linhsu"
SERVICE="auto-hh3d-linh-su"

if [ "$(id -u)" -ne 0 ]; then
  echo "Chạy bằng sudo: WEB_URL=... WORKER_TOKEN=... sudo -E bash setup.sh" >&2
  exit 1
fi
if [ -z "$WEB_URL" ] || [ -z "$WORKER_TOKEN" ]; then
  echo "Thiếu WEB_URL hoặc WORKER_TOKEN (nhớ sudo -E để biến môi trường đi qua sudo)." >&2
  exit 1
fi
WEB_URL="${WEB_URL%/}"

echo "== [1/6] Node.js 22 LTS =="
if ! command -v node >/dev/null 2>&1 || [ "$(node --version | sed 's/^v//' | cut -d. -f1)" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
node --version

echo "== [2/6] Người dùng dịch vụ =="
id "$APP_USER" >/dev/null 2>&1 || useradd --system --create-home --shell /usr/sbin/nologin "$APP_USER"

echo "== [3/6] Tải gói khôi lỗi =="
systemctl stop "$SERVICE" 2>/dev/null || true
mkdir -p "$APP_DIR"
curl -fsSL "$WEB_URL/linh-su/goi-linh-su.tgz" | tar -xz -C "$APP_DIR"
chown -R "$APP_USER:$APP_USER" "$APP_DIR"

echo "== [4/6] Chromium =="
cd "$APP_DIR"
# Không `npm install`: playwright-core đã đi sẵn trong gói (xem scripts/buildWorkerBundle.mjs).
# Và CLI tải browser là cli.js của CHÍNH bản ấy, nên không có cách nào lệch phiên bản —
# lỗi "Executable doesn't exist" trở thành bất khả thi thay vì phải canh chừng.
PWC="$APP_DIR/node_modules/playwright-core/cli.js"
# Thư viện hệ thống cài bằng root; bản Chromium tải về ~/.cache của CHÍNH user chạy service
# — hai bước tách nhau, vì gộp một lệnh thì browser rơi vào cache của root và worker mù.
node "$PWC" install-deps chromium
sudo -u "$APP_USER" node "$PWC" install chromium

echo "== [5/6] Cấu hình =="
# WORKER_ID GIỮ NGUYÊN nếu .env đã có — định danh khôi lỗi là KHOÁ CHÍNH trong bảng `workers`
# và nằm trong `automation_jobs.worker_id`, nên đổi nó giữa chừng là sinh một khôi lỗi thứ hai
# trong sổ và bỏ lại đàn đang chạy dưới cái tên cũ.
#
# ĐÃ NGÃ THẬT ngày 09/08/2026: khôi lỗi tông môn được đổi tên sang `tong-mon-khoiloi` (đổi tay
# trong .env + migration 0019), rồi một lượt cài đè chạy đúng script này ghi đè ngược về
# `tong-mon-$(hostname -s)` = `tong-mon-linhsu`. Sổ mọc thêm một dòng rác, và trang Hàng Đợi —
# thứ vẽ THẲNG `worker_id` — bắt đầu hiện sai tên. Phải sửa .env, restart, rồi dọn dòng ấy.
#
# Nên: dòng dưới là MẶC ĐỊNH CHO MÁY MỚI, không phải lệnh áp đặt cho mọi lượt chạy lại.
EXISTING_WORKER_ID=""
if [ -f "$APP_DIR/.env" ]; then
  EXISTING_WORKER_ID="$(sed -n 's/^WORKER_ID=//p' "$APP_DIR/.env" | head -1)"
fi
WORKER_ID="${EXISTING_WORKER_ID:-tong-mon-$(hostname -s)}"
if [ -n "$EXISTING_WORKER_ID" ]; then
  echo "   giữ WORKER_ID đang dùng: $WORKER_ID"
else
  echo "   máy mới — đặt WORKER_ID: $WORKER_ID"
fi

cat > "$APP_DIR/.env" <<ENV
WEB_URL=$WEB_URL
WORKER_TOKEN=$WORKER_TOKEN
WORKER_ID=$WORKER_ID
ENV
chown "$APP_USER:$APP_USER" "$APP_DIR/.env"
chmod 600 "$APP_DIR/.env"

echo "== [6/6] systemd =="
cat > "/etc/systemd/system/$SERVICE.service" <<UNIT
[Unit]
Description=Auto HH3D — linh su tong mon (worker)
After=network-online.target
Wants=network-online.target

[Service]
User=$APP_USER
WorkingDirectory=$APP_DIR
EnvironmentFile=$APP_DIR/.env
ExecStart=/usr/bin/node $APP_DIR/worker.mjs
Restart=always
RestartSec=10
# Chromium chết kiểu gì cũng không được kéo cả VM theo.
#
# 4G là trần cho một máy cài MỚI. Production đang chạy 18G và WORKER_MAX_JOBS=3, đặt trong
# drop-in /etc/systemd/system/auto-hh3d-linh-su.service.d/override.conf — script này cố ý chỉ
# viết lại unit chính nên chạy lại lệnh cài KHÔNG hạ trần về 4G, cũng không xoá mất số đàn
# song song. Đừng đọc dòng dưới rồi tưởng production đang ở 4G; xem bảng trong README.md.
MemoryMax=4G
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable --now "$SERVICE"
sleep 2
systemctl --no-pager --lines=5 status "$SERVICE" || true

echo ""
echo "== Xong! Khôi lỗi tông môn đã lên ca. =="
echo "Nhật ký : journalctl -u $SERVICE -f"
echo "Cập nhật: chạy lại đúng lệnh setup này."
echo "Kiểm tra: mục Khôi Lỗi trên dashboard sẽ hiện 'Khôi lỗi tông môn — đang trực' trong ~30 giây."
