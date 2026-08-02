#!/usr/bin/env bash
# =============================================================================
# Cài LINH SỨ TÚC TRỰC — Auto HH3D (Linux / macOS)
#
# Chạy bằng lệnh phát ở mục Linh Sứ trên dashboard:
#   LINH_PHU='<linh phù>' LINH_SU_URL='<web>' bash -c "$(curl -fsSL <web>/linh-su/install.sh)"
#
# Linux : systemd user service (tự chạy khi máy bật, không cần đăng nhập nếu bật linger).
# macOS : launchd LaunchAgent (tự chạy khi đăng nhập).
# Chạy lại = cập nhật. Gỡ: ~/.local/share/auto-hh3d/linh-su/uninstall.sh
# =============================================================================
set -euo pipefail

TOKEN="${LINH_PHU:-}"
BASE="${LINH_SU_URL:-https://auto-hh3d.vercel.app}"
BASE="${BASE%/}"
DIR="$HOME/.local/share/auto-hh3d/linh-su"
OS="$(uname -s)"

if [ -z "$TOKEN" ]; then
  echo "Thiếu linh phù. Hãy copy NGUYÊN VẸN lệnh cài từ mục Linh Sứ trên dashboard." >&2
  exit 1
fi

echo ""
echo "== Cài linh sứ túc trực vào $DIR =="

# --- 1. Node.js >= 20 --------------------------------------------------------
node_major() { command -v node >/dev/null 2>&1 && node --version | sed 's/^v//' | cut -d. -f1 || echo 0; }

if [ "$(node_major)" -lt 20 ]; then
  echo "Chưa có Node.js (>= 20)."
  if [ "$OS" = "Linux" ] && command -v apt-get >/dev/null 2>&1 && command -v sudo >/dev/null 2>&1; then
    echo "Đang cài Node 22 LTS qua NodeSource (cần sudo)..."
    curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
    sudo apt-get install -y nodejs
  elif [ "$OS" = "Darwin" ] && command -v brew >/dev/null 2>&1; then
    echo "Đang cài Node qua Homebrew..."
    brew install node@22 || brew install node
  fi
  if [ "$(node_major)" -lt 20 ]; then
    echo "Không tự cài được Node.js — cài từ https://nodejs.org rồi chạy lại lệnh này." >&2
    exit 1
  fi
fi
echo "Node.js $(node --version) — được"

# --- 2. Dừng linh sứ cũ nếu có ----------------------------------------------
pkill -f "$DIR/worker.mjs" 2>/dev/null || true

# --- 3. Tải và bung gói ------------------------------------------------------
mkdir -p "$DIR"
echo "Tải gói linh sứ..."
curl -fsSL "$BASE/linh-su/goi-linh-su.tgz" | tar -xz -C "$DIR"

# --- 4. Thư viện + Chromium --------------------------------------------------
cd "$DIR"
echo "Cài thư viện (npm install)..."
npm install --omit=dev --no-fund --no-audit --loglevel=error

# Bản Chromium phải khớp CHÍNH XÁC bản playwright-core trong gói — đọc từ gói, không đoán.
PW="$(node -p "require('./package.json').dependencies['playwright-core']")"
echo "Cài Chromium cho Playwright $PW (lần đầu hơi lâu, ~150MB)..."
if [ "$OS" = "Linux" ] && sudo -n true 2>/dev/null; then
  # --with-deps kéo đủ thư viện hệ thống Chromium cần — trên Ubuntu đây là đường êm nhất.
  npx --yes "playwright@$PW" install --with-deps chromium
else
  npx --yes "playwright@$PW" install chromium
  [ "$OS" = "Linux" ] && echo "(Nếu Chromium thiếu thư viện hệ thống: sudo npx playwright@$PW install-deps chromium)"
fi

# --- 5. Cấu hình -------------------------------------------------------------
SUFFIX="$(LC_ALL=C tr -dc 'a-z0-9' </dev/urandom | head -c 4)"
WORKER_ID="$(hostname -s | tr '[:upper:]' '[:lower:]' | tr -c 'a-z0-9-' '-' | sed 's/-*$//')-$SUFFIX"
cat > "$DIR/.env" <<ENV
WEB_URL=$BASE
WORKER_TOKEN=$TOKEN
WORKER_ID=$WORKER_ID
ENV
chmod 600 "$DIR/.env"

# --- 6. run.sh — vòng nuôi: worker chết là dựng lại sau 10 giây --------------
cat > "$DIR/run.sh" <<'RUN'
#!/usr/bin/env bash
cd "$(dirname "$0")"
set -a; . ./.env; set +a
while true; do
  node worker.mjs >> linh-su.log 2>&1
  sleep 10
done
RUN
chmod +x "$DIR/run.sh"

# --- 7. Tự khởi động ---------------------------------------------------------
if [ "$OS" = "Linux" ] && command -v systemctl >/dev/null 2>&1; then
  mkdir -p "$HOME/.config/systemd/user"
  cat > "$HOME/.config/systemd/user/auto-hh3d-linh-su.service" <<UNIT
[Unit]
Description=Auto HH3D — linh su tuc truc

[Service]
ExecStart=$DIR/run.sh
Restart=always
RestartSec=10

[Install]
WantedBy=default.target
UNIT
  systemctl --user daemon-reload
  systemctl --user enable --now auto-hh3d-linh-su.service
  # linger = service sống cả khi chưa đăng nhập — đúng nghĩa "túc trực". Không có quyền thì thôi.
  loginctl enable-linger "$USER" 2>/dev/null || echo "(Không bật được linger — linh sứ chỉ trực khi bạn đăng nhập. Bật sau: sudo loginctl enable-linger $USER)"
  START_NOTE="systemd: systemctl --user status auto-hh3d-linh-su"
elif [ "$OS" = "Darwin" ]; then
  PLIST="$HOME/Library/LaunchAgents/com.autohh3d.linhsu.plist"
  mkdir -p "$HOME/Library/LaunchAgents"
  cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.autohh3d.linhsu</string>
  <key>ProgramArguments</key><array><string>$DIR/run.sh</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
</dict></plist>
PLIST
  launchctl unload "$PLIST" 2>/dev/null || true
  launchctl load "$PLIST"
  START_NOTE="launchd: launchctl list | grep autohh3d"
else
  nohup "$DIR/run.sh" >/dev/null 2>&1 &
  START_NOTE="(Không thấy systemd/launchd — đã chạy nền bằng nohup; tự khởi động cùng máy thì bạn phải tự cấu hình.)"
fi

# --- 8. uninstall.sh ---------------------------------------------------------
cat > "$DIR/uninstall.sh" <<UN
#!/usr/bin/env bash
systemctl --user disable --now auto-hh3d-linh-su.service 2>/dev/null || true
rm -f "\$HOME/.config/systemd/user/auto-hh3d-linh-su.service"
launchctl unload "\$HOME/Library/LaunchAgents/com.autohh3d.linhsu.plist" 2>/dev/null || true
rm -f "\$HOME/Library/LaunchAgents/com.autohh3d.linhsu.plist"
pkill -f "$DIR/worker.mjs" 2>/dev/null || true
rm -rf "$DIR"
echo "Đã gỡ linh sứ túc trực."
UN
chmod +x "$DIR/uninstall.sh"

echo ""
echo "== Xong! Linh sứ「$WORKER_ID」đã lên ca. =="
echo "Nhật ký : $DIR/linh-su.log"
echo "Trạng thái: $START_NOTE"
echo "Gỡ cài  : $DIR/uninstall.sh"
echo "Kiểm tra: mở mục Linh Sứ trên dashboard — sẽ thấy nó điểm danh trong ~10 giây."
