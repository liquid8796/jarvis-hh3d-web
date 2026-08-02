#!/usr/bin/env bash
# =============================================================================
# Cài LINH SỨ TÚC TRỰC — Auto HH3D (Linux / macOS)
#
# Chạy bằng lệnh phát ở mục Linh Sứ trên dashboard:
#   LINH_PHU='<linh phù>' LINH_SU_URL='<web>' bash -c "$(curl -fsSL <web>/linh-su/install.sh)"
#
# KHÔNG cần cài sẵn gì cả — không Node.js, không npm, không sudo.
# Script tự tải một bản Node "xách tay" vào thư mục cài và chỉ dùng bản đó, vì:
#   • Người dùng không phải tự cài gì — đó là toàn bộ mục đích của trang này.
#   • Đường dẫn TUYỆT ĐỐI: systemd/launchd khởi chạy với PATH tối giản, nên một
#     `node` tìm qua PATH là lỗi "chạy tay thì được, tự khởi động thì không".
#   • Máy có Node 18 hay Node do nvm quản lý đều không còn là chuyện của ta.
#
# Linux : systemd user service (thêm linger thì trực cả khi chưa đăng nhập).
# macOS : launchd LaunchAgent (chạy khi đăng nhập).
# Chạy lại = cập nhật. Gỡ: ~/.local/share/auto-hh3d/linh-su/uninstall.sh
# =============================================================================
set -euo pipefail

NODE_VERSION="v24.18.1"   # LTS "Krypton"

TOKEN="${LINH_PHU:-}"
BASE="${LINH_SU_URL:-https://auto-hh3d.vercel.app}"
BASE="${BASE%/}"
DIR="$HOME/.local/share/auto-hh3d/linh-su"
NODE_DIR="$DIR/node"
NODE="$NODE_DIR/bin/node"

if [ -z "$TOKEN" ]; then
  echo "Thiếu linh phù. Hãy copy NGUYÊN VẸN lệnh cài từ mục Linh Sứ trên dashboard." >&2
  exit 1
fi

echo ""
echo "== Cài linh sứ túc trực vào $DIR =="
echo "   (không cần sudo, không đụng gì tới phần còn lại của máy)"

# --- 1. Dừng linh sứ cũ ------------------------------------------------------
# VÒNG NUÔI TRƯỚC, worker sau: run.sh dựng lại node sau 10 giây, nên giết mỗi node là kết
# thúc với hai vòng nuôi cùng đọc một .env — hai linh sứ mang CÙNG một WORKER_ID. Trên
# systemd thì unit lo việc này, nhưng đường nohup (máy không có systemd) thì không ai lo.
systemctl --user stop auto-hh3d-linh-su.service 2>/dev/null || true
pkill -f "$DIR/run.sh" 2>/dev/null || true
pkill -f "$DIR/worker.mjs" 2>/dev/null || true
mkdir -p "$DIR"

# --- 2. Node xách tay --------------------------------------------------------
case "$(uname -s)" in
  Linux)  OS_TAG="linux" ;;
  Darwin) OS_TAG="darwin" ;;
  *) echo "Hệ điều hành $(uname -s) chưa được hỗ trợ." >&2; exit 1 ;;
esac
case "$(uname -m)" in
  x86_64|amd64)  ARCH_TAG="x64" ;;
  aarch64|arm64) ARCH_TAG="arm64" ;;
  *) echo "Kiến trúc $(uname -m) chưa được hỗ trợ." >&2; exit 1 ;;
esac
NODE_NAME="node-$NODE_VERSION-$OS_TAG-$ARCH_TAG"

if [ -x "$NODE" ] && [ "$("$NODE" --version 2>/dev/null)" = "$NODE_VERSION" ]; then
  echo "Node $NODE_VERSION đã có sẵn trong thư mục cài."
else
  echo "Tải Node.js $NODE_VERSION ($OS_TAG-$ARCH_TAG, ~30MB)..."
  TARBALL="$(mktemp -d)/$NODE_NAME.tar.xz"
  curl -fsSL -o "$TARBALL" "https://nodejs.org/dist/$NODE_VERSION/$NODE_NAME.tar.xz"

  # Kiểm tính toàn vẹn: ta sắp chạy thứ này như một runtime, nên không tin suông vào
  # việc "tải xong là đúng". Bản tải hỏng hay proxy chen ngang phải lộ ra ngay đây.
  WANT="$(curl -fsSL "https://nodejs.org/dist/$NODE_VERSION/SHASUMS256.txt" | grep " $NODE_NAME.tar.xz\$" | cut -d' ' -f1)"
  if command -v sha256sum >/dev/null 2>&1; then
    GOT="$(sha256sum "$TARBALL" | cut -d' ' -f1)"
  else
    GOT="$(shasum -a 256 "$TARBALL" | cut -d' ' -f1)"   # macOS không có sha256sum
  fi
  if [ -z "$WANT" ] || [ "$GOT" != "$WANT" ]; then
    rm -f "$TARBALL"
    echo "Bản Node tải về không khớp mã kiểm tra — dừng lại cho an toàn." >&2
    echo "  mong đợi: $WANT" >&2
    echo "  nhận được: $GOT" >&2
    exit 1
  fi

  echo "Bung Node..."
  rm -rf "$NODE_DIR"
  mkdir -p "$NODE_DIR"
  # --strip-components=1: tarball bọc ngoài một thư mục tên đầy đủ, ta muốn phẳng.
  tar -xJf "$TARBALL" -C "$NODE_DIR" --strip-components=1
  rm -rf "$(dirname "$TARBALL")"
fi

if [ ! -x "$NODE" ]; then
  echo "Không dựng được Node trong thư mục cài — dừng." >&2
  exit 1
fi
echo "Node $("$NODE" --version) — sẵn sàng (riêng của linh sứ)"

# --- 3. Gói linh sứ ----------------------------------------------------------
echo "Tải gói linh sứ..."
# Xoá bản engine cũ chứ không trộn lên trên: một tệp bị đổi tên ở bản mới mà bản cũ
# còn nằm lại là một quả mìn hẹn giờ.
rm -rf "$DIR/quest-engine" "$DIR/node_modules"
curl -fsSL "$BASE/linh-su/goi-linh-su.tgz" | tar -xz -C "$DIR"

# --- 4. Chromium -------------------------------------------------------------
# Dùng CLI của CHÍNH playwright-core đi kèm gói — không npm, không registry, và không
# thể lệch phiên bản: người tải browser và người dùng browser là cùng một bản mã.
echo "Cài Chromium (~150MB, lần đầu hơi lâu)..."
cd "$DIR"
"$NODE" node_modules/playwright-core/cli.js install chromium

# Thư viện hệ thống Chromium cần: chỉ Linux mới thiếu, và bước này CẦN root nên nó là
# tuỳ chọn — không có sudo thì cài vẫn xong, chỉ báo cho người dùng biết câu lệnh.
if [ "$OS_TAG" = "linux" ]; then
  if sudo -n true 2>/dev/null; then
    sudo "$NODE" node_modules/playwright-core/cli.js install-deps chromium || true
  else
    DEPS_NOTE="Nếu Chromium báo thiếu thư viện: sudo $NODE $DIR/node_modules/playwright-core/cli.js install-deps chromium"
  fi
fi

# --- 5. Cấu hình -------------------------------------------------------------
# GIỮ NGUYÊN ID CŨ nếu máy này đã cài trước đó: ID là danh tính của linh sứ trong sổ điểm
# danh, nên sinh mới mỗi lần cài lại sẽ để lại một xác linh sứ "vắng mặt" trong mục Linh Sứ
# sau MỖI lần cập nhật — người dùng nhìn vào tưởng mình đang nuôi cả một đàn.
WORKER_ID=""
if [ -f "$DIR/.env" ]; then
  WORKER_ID="$(grep -m1 '^WORKER_ID=' "$DIR/.env" 2>/dev/null | cut -d= -f2- || true)"
fi
if [ -z "$WORKER_ID" ]; then
  SUFFIX="$(LC_ALL=C tr -dc 'a-z0-9' </dev/urandom | head -c 4)"
  WORKER_ID="$(hostname -s | tr '[:upper:]' '[:lower:]' | tr -c 'a-z0-9-' '-' | sed 's/-*$//')-$SUFFIX"
fi
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
  # Cắt nhật ký khi quá 5MB. Linh sứ chạy quanh năm, và khi web không với tới được nó ghi
  # một dòng "claim lỗi" mỗi 5 giây — mất mạng một đêm là vài chục nghìn dòng.
  if [ -f linh-su.log ] && [ "$(wc -c < linh-su.log)" -gt 5242880 ]; then : > linh-su.log; fi
  ./node/bin/node worker.mjs >> linh-su.log 2>&1
  sleep 10
done
RUN
chmod +x "$DIR/run.sh"

# --- 7. Tự khởi động ---------------------------------------------------------
if [ "$OS_TAG" = "linux" ] && command -v systemctl >/dev/null 2>&1; then
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
  # linger = service sống cả khi chưa đăng nhập — đúng nghĩa "túc trực".
  loginctl enable-linger "$USER" 2>/dev/null || echo "(Không bật được linger — linh sứ chỉ trực khi bạn đăng nhập. Bật sau: sudo loginctl enable-linger $USER)"
  START_NOTE="systemctl --user status auto-hh3d-linh-su"
elif [ "$OS_TAG" = "darwin" ]; then
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
  START_NOTE="launchctl list | grep autohh3d"
else
  nohup "$DIR/run.sh" >/dev/null 2>&1 &
  START_NOTE="(Không thấy systemd/launchd — đã chạy nền bằng nohup; tự khởi động cùng máy thì bạn phải tự cấu hình.)"
fi

# --- 8. uninstall.sh ---------------------------------------------------------
cat > "$DIR/uninstall.sh" <<UN
#!/usr/bin/env bash
# Cắt đường tự khởi động TRƯỚC, rồi mới hạ tiến trình — ngược lại thì systemd/launchd
# dựng lại ngay cái vừa bị giết.
systemctl --user disable --now auto-hh3d-linh-su.service 2>/dev/null || true
rm -f "\$HOME/.config/systemd/user/auto-hh3d-linh-su.service"
systemctl --user daemon-reload 2>/dev/null || true
launchctl unload "\$HOME/Library/LaunchAgents/com.autohh3d.linhsu.plist" 2>/dev/null || true
rm -f "\$HOME/Library/LaunchAgents/com.autohh3d.linhsu.plist"
# Vòng nuôi trước, worker sau (xem lý do ở bước 1 của install.sh).
pkill -f "$DIR/run.sh" 2>/dev/null || true
pkill -f "$DIR/worker.mjs" 2>/dev/null || true
sleep 1
rm -rf "$DIR"
rmdir "\$(dirname "$DIR")" 2>/dev/null || true   # thư mục cha rỗng thì đừng để lại dấu vết
echo "Đã gỡ linh sứ túc trực — máy trở lại y như trước khi cài."
UN
chmod +x "$DIR/uninstall.sh"

echo ""
echo "== Xong! Linh sứ「$WORKER_ID」đã lên ca. =="
echo "Nhật ký   : $DIR/linh-su.log"
echo "Trạng thái: $START_NOTE"
echo "Gỡ cài    : $DIR/uninstall.sh"
[ -n "${DEPS_NOTE:-}" ] && echo "$DEPS_NOTE"
echo "Kiểm tra  : mở mục Linh Sứ trên dashboard — sẽ thấy nó điểm danh trong ~10 giây."
