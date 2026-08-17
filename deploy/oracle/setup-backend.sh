#!/usr/bin/env bash
# =============================================================================
#  Dựng nền BACKEND trên jarvis-oci-01 — chạy bằng root, idempotent.
#
#  Từ 16/08/2026 VM này là backend DUY NHẤT của tông môn: chạy trọn app Next.js
#  (UI + API) sau Caddy, kèm PostgreSQL 17 + MongoDB 8.0 nội bộ. Các trạm Vercel
#  chỉ còn là vỏ proxy trỏ về đây; khôi lỗi GitHub gọi thẳng vào đây.
#
#  Script này CHỈ dựng nền (runtime, DB, TLS, firewall, systemd). Mã app đi
#  bằng scripts/deployBackend.mts ở repo — hai việc tách nhau để lượt phát hành
#  thường ngày không phải đụng tới apt.
#
#  PGDG PostgreSQL 17 chứ không phải bản 16 của Ubuntu: dump lấy từ Neon, mà
#  Neon 2026 chạy PG 17 — pg_dump 16 TỪ CHỐI server mới hơn nó.
# =============================================================================
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

APP_DIR=/opt/jarvis/app
APP_USER=jarvis
PG_DB=jarvis
PG_USER=jarvis
CRED_DIR=/etc/jarvis

log() { printf '\n== %s ==\n' "$*"; }

log "[1/8] apt nền"
apt-get update -y
# `gh` là thứ đặt secret WORKER_TOKEN cho kho khôi lỗi mới (github:new) — nó đọc PAT qua biến
# GH_TOKEN nên KHÔNG cần `gh auth login`, chạy headless được. Bản trong apt của Ubuntu 24.04 là
# đủ; thêm repo riêng của GitHub chỉ để lấy bản mới hơn là nợ bảo trì không đổi lại được gì.
apt-get install -y ca-certificates curl gnupg rsync unzip gh

log "[2/8] Node 24"
if ! command -v node >/dev/null 2>&1 || [[ "$(node -v)" != v24* ]]; then
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
  apt-get install -y nodejs
fi
node -v

log "[3/8] PostgreSQL 17 (PGDG)"
if [ ! -f /etc/apt/sources.list.d/pgdg.list ]; then
  install -d /usr/share/postgresql-common/pgdg
  curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
    -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc
  echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt $(. /etc/os-release; echo "$VERSION_CODENAME")-pgdg main" \
    > /etc/apt/sources.list.d/pgdg.list
  apt-get update -y
fi
apt-get install -y postgresql-17 postgresql-client-17
systemctl enable --now postgresql

log "[4/8] MongoDB 8.0"
if [ ! -f /usr/share/keyrings/mongodb-server-8.0.gpg ]; then
  curl -fsSL https://www.mongodb.org/static/pgp/server-8.0.asc | gpg --dearmor -o /usr/share/keyrings/mongodb-server-8.0.gpg
fi
echo "deb [ arch=arm64 signed-by=/usr/share/keyrings/mongodb-server-8.0.gpg ] https://repo.mongodb.org/apt/ubuntu noble/mongodb-org/8.0 multiverse" \
  > /etc/apt/sources.list.d/mongodb-org-8.0.list
apt-get update -y
apt-get install -y mongodb-org mongodb-database-tools mongodb-mongosh
systemctl enable --now mongod

log "[5/8] Caddy"
if ! command -v caddy >/dev/null 2>&1; then
  apt-get install -y debian-keyring debian-archive-keyring apt-transport-https
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y
  apt-get install -y caddy
fi
caddy version

log "[6/8] firewall trên máy (ảnh Ubuntu của OCI chặn sẵn mọi cổng ngoài 22)"
open_port() {
  local port="$1"
  if ! iptables -C INPUT -m state --state NEW -p tcp --dport "$port" -j ACCEPT 2>/dev/null; then
    # Chen TRƯỚC dòng REJECT của ảnh gốc, cùng vị trí với luật 22 có sẵn.
    iptables -I INPUT 5 -m state --state NEW -p tcp --dport "$port" -j ACCEPT
  fi
}
open_port 80
open_port 443
netfilter-persistent save >/dev/null 2>&1 || apt-get install -y iptables-persistent

log "[7/8] role + database Postgres, user hệ thống, thư mục app"
install -d -m 0750 "$CRED_DIR"
if [ ! -f "$CRED_DIR/pg-password" ]; then
  # openssl chứ không phải `tr </dev/urandom | head`: head đóng ống là tr nhận SIGPIPE,
  # và dưới `set -o pipefail` cả script chết với mã 141 — đã đo ngay lượt chạy đầu.
  openssl rand -hex 16 > "$CRED_DIR/pg-password"
  chmod 0600 "$CRED_DIR/pg-password"
fi
PG_PASS=$(cat "$CRED_DIR/pg-password")
sudo -u postgres psql -v ON_ERROR_STOP=1 <<SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '$PG_USER') THEN
    CREATE ROLE $PG_USER LOGIN PASSWORD '$PG_PASS';
  ELSE
    ALTER ROLE $PG_USER LOGIN PASSWORD '$PG_PASS';
  END IF;
END
\$\$;
SQL
sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname = '$PG_DB'" | grep -q 1 \
  || sudo -u postgres createdb -O "$PG_USER" "$PG_DB"

id -u "$APP_USER" >/dev/null 2>&1 || useradd --system --create-home --shell /usr/sbin/nologin "$APP_USER"
# KHÔNG dựng sẵn $APP_DIR: nó là SYMLINK do deployBackend lật vào release — dựng sẵn một
# thư mục thật ở đó làm `ln -sfn` tạo symlink bên trong thay vì thay thế (đã trả giá 16/08).
install -d -o "$APP_USER" -g "$APP_USER" /opt/jarvis/releases

log "[8/8] systemd (hai chỗ chạy) + Caddyfile"

# BLUE/GREEN: hai bản app ở cổng 3000 và 3001, Caddy trỏ vào ĐÚNG MỘT bản mỗi lúc.
#
# Vì sao không phải một bản như trước: `next start` PHỚT LỜ SIGTERM, nên `systemctl restart`
# đứng chờ hết `TimeoutStopSec` rồi mới SIGKILL — đo 16/08/2026 trên chính máy này: 90 giây
# mỗi lượt phát hành, kết bằng một cú chém đứt mọi request đang bay. Có hai chỗ chạy thì lượt
# phát hành dựng bản mới ở chỗ ĐANG RẢNH rồi mới chuyển Caddy sang, nên người dùng không thấy
# một giây gián đoạn nào.
#
# Vì sao KHÔNG cho Caddy cân tải cả hai cùng lúc: trong lúc phát hành hai chỗ mang hai bản mã
# khác nhau, mà trang Next tham chiếu chunk JS theo hash của chính bản dựng ấy — chia tải nghĩa
# là trình duyệt xin chunk của bản A rồi rơi vào bản B và nhận 404. Một-bản-một-lúc là điều kiện
# đúng, không phải chuyện đơn giản hoá.
#
# `%i` của unit mẫu là SỐ CỔNG, và cũng là tên thư mục — một con số, một chỗ khai.
cat > /etc/systemd/system/jarvis-web@.service <<'UNIT'
[Unit]
Description=Jarvis HH3D - backend Next.js (cong %i)
After=network-online.target postgresql.service mongod.service
Wants=network-online.target

[Service]
Type=simple
User=jarvis
WorkingDirectory=/opt/jarvis/slot-%i
ExecStart=/usr/bin/npx next start -p %i
Restart=always
RestartSec=3
# `next start` không chịu SIGTERM (đã đo). Traffic đã được Caddy rút đi TRƯỚC khi dừng, nên
# chém sau 20 giây là an toàn — và giữ mặc định 90 giây chỉ tổ kéo dài mỗi lượt phát hành.
TimeoutStopSec=20
# 24GB máy, hai chỗ chạy: mỗi bên 8G vẫn còn dư rộng cho Postgres + Mongo + đệm hệ thống.
MemoryMax=8G
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
UNIT

install -d -o "$APP_USER" -g "$APP_USER" /opt/jarvis/releases

# MỘT DÒNG này là nguồn sự thật duy nhất cho「bản nào đang phục vụ」: lượt phát hành ghi lại nó
# rồi `caddy reload`. Đặt ngoài Caddyfile để đổi bản không phải viết lại cả tệp cấu hình.
if [ ! -f /etc/caddy/upstream.conf ]; then
  echo "reverse_proxy 127.0.0.1:3000" > /etc/caddy/upstream.conf
fi

# sslip.io là đường TLS chính (Let's Encrypt HTTP-01 qua cổng 80); khối IP trần
# thử thêm chứng chỉ IP shortlived — hỏng cũng không kéo khối kia theo.
cat > /etc/caddy/Caddyfile <<'CADDY'
158.180.59.36.sslip.io {
	import /etc/caddy/upstream.conf
	encode zstd gzip
}

158.180.59.36 {
	import /etc/caddy/upstream.conf
	encode zstd gzip
}
CADDY

systemctl daemon-reload
systemctl enable caddy
# RELOAD chứ không restart khi Caddy đang chạy: restart cắt mọi kết nối đang mở, mà script này
# còn được chạy lại trên một máy ĐANG PHỤC VỤ (nó idempotent, đó là chủ ý). Reload thì êm.
systemctl reload caddy 2>/dev/null || systemctl restart caddy

log "XONG — nền đã dựng"
echo "  Postgres : $(pg_lsclusters --no-header | head -1)"
echo "  MongoDB  : $(systemctl is-active mongod)"
echo "  Caddy    : $(systemctl is-active caddy)"
echo "  App dir  : $APP_DIR (user $APP_USER) — mã app đi bằng scripts/deployBackend.mts"
echo "  PG cred  : $CRED_DIR/pg-password (root-only)"
