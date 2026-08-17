#!/usr/bin/env node
/**
 * PHÁT HÀNH BACKEND LÊN VM OCI — blue/green, không một giây gián đoạn.
 *
 *   npm run deploy:all                       phát hành HEAD
 *   npm run deploy:backend -- --rollback     lùi về bản đang nằm ở chỗ chạy kia
 *   npm run deploy:backend -- --same-version phát hành lại đúng số hiệu đang chạy
 *
 * ── VÌ SAO HAI CHỖ CHẠY ───────────────────────────────────────────────────────────────────
 *
 * `next start` PHỚT LỜ SIGTERM. Đo 16/08/2026 trên chính máy này: mỗi `systemctl restart` là
 * systemd chờ đủ `TimeoutStopSec` (90 giây mặc định) rồi SIGKILL — nên lượt phát hành cũ vừa
 * dài thêm một phút rưỡi, vừa kết bằng một cú chém đứt mọi request đang bay.
 *
 * Nay app chạy ở HAI chỗ (`jarvis-web@3000`, `jarvis-web@3001`) và Caddy trỏ vào ĐÚNG MỘT chỗ.
 * Lượt phát hành dựng bản mới ở chỗ đang RẢNH, chờ nó khoẻ, rồi mới đổi một dòng upstream và
 * `caddy reload` — reload của Caddy là êm, kết nối đang mở chạy nốt. Chỗ cũ được để NGUYÊN,
 * không tắt: 230MB đổi lấy một cú lùi bản tức thì (`--rollback` chỉ là đổi ngược dòng ấy).
 *
 * Cố ý KHÔNG cho Caddy cân tải cả hai: giữa lượt phát hành hai chỗ mang hai bản mã khác nhau,
 * mà trang Next xin chunk JS theo hash của chính bản dựng ra nó — chia tải nghĩa là trình duyệt
 * xin chunk của bản A rồi rơi vào bản B và nhận 404.
 *
 * ── VÌ SAO CÓ CỔNG SỐ HIỆU BẢN ────────────────────────────────────────────────────────────
 *
 * `verify:changelog` chỉ đỏ khi BUMP MÀ QUÊN VIẾT TIN — nó không nói gì khi người ta commit mà
 * quên bump. Lưới một chiều ấy để số hiệu đóng băng ở `1.0.0` suốt chín commit (tông chủ báo
 * 16/08/2026:「web vẫn stuck tại v1.0.0」). `AppVersion.tsx` đọc thẳng `package.json`, nên số
 * hiệu chỉ nhúc nhích khi có người sửa tệp ấy. Cổng dưới đây đóng chiều còn lại: **không phát
 * hành được một số hiệu đã đang chạy**. Có `--same-version` cho lượt phát hành lại thật sự cần.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const VM_HOST = "158.180.59.36";
const VM_USER = "ubuntu";
const SSH_KEY = path.join(process.env.USERPROFILE ?? process.env.HOME ?? "~", ".ssh", "jarvis_oci_ed25519");
const BACKEND_URL = "https://158.180.59.36.sslip.io";
/** Đường rẻ nhất chứng minh một chỗ chạy đã SẴN SÀNG: nó chạm database, không chỉ mở cổng. */
const HEALTH_PATH = "/api/maintenance";
const PORTS = [3000, 3001] as const;

const die = (message: string): never => {
  console.error(`\n✗ ${message}`);
  process.exit(1);
};

/**
 * `ssh` dùng mã thoát 255 cho lỗi TẦNG VẬN CHUYỂN của chính nó — phân biệt được với mã thoát
 * của lệnh phía xa (lệnh phía xa gần như không bao giờ trả 255). Phân biệt ấy là bắt buộc ở
 * đây: một cú đứt đường truyền và một lượt build hỏng đòi hai phản ứng ngược nhau.
 */
const SSH_TRANSPORT_FAILURE = 255;
/** Đo 16/08/2026: đường tới VM đứt ở banner exchange dăm lần mỗi giờ, và lượt thử lại luôn qua. */
const SSH_ATTEMPTS = 4;
const SSH_RETRY_MS = 6_000;

const sleep = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/**
 * Chạy một script bash trên VM, gửi qua STDIN — khỏi phải trốn dấu nháy qua hai tầng shell.
 *
 * Thử lại CHỈ khi ssh hỏng ở tầng vận chuyển. Lệnh phía xa hỏng thì trả về ngay: chạy lại một
 * lượt `npm ci` đã chết nửa chừng là nhân đôi cái hỏng, không phải chữa nó.
 */
const remote = (script: string, quiet = false) => {
  for (let attempt = 1; ; attempt++) {
    const run = spawnSync(
      "ssh",
      ["-i", SSH_KEY, "-o", "BatchMode=yes", "-o", "ConnectTimeout=25", `${VM_USER}@${VM_HOST}`, "bash -s"],
      { input: script, encoding: "utf8", stdio: ["pipe", quiet ? "pipe" : "inherit", "inherit"] },
    );
    if (run.status !== SSH_TRANSPORT_FAILURE || attempt >= SSH_ATTEMPTS) return run;
    console.error(`  ⚠ đường tới VM đứt (ssh 255) — thử lại lượt ${attempt + 1}/${SSH_ATTEMPTS}…`);
    sleep(SSH_RETRY_MS);
  }
};

const remoteOrDie = (script: string, what: string) => {
  const run = remote(script);
  if (run.status === SSH_TRANSPORT_FAILURE) {
    die(`Không nối được tới VM sau ${SSH_ATTEMPTS} lượt thử (ssh 255) — mạng nhà, hoặc VPN đang bật.`);
  }
  if (run.status !== 0) die(`${what} — lệnh trên VM thoát ${run.status}. Đọc dòng lỗi ngay trên.`);
  return run;
};

// ---- Trạng thái hiện tại trên VM ---------------------------------------------------------

type State = { active: number; idle: number; versionActive: string; versionIdle: string; idleUnit: string };

function readState(): State {
  const probe = remote(
    [
      "set -e",
      "port=$(grep -oE '127[.]0[.]0[.]1:[0-9]+' /etc/caddy/upstream.conf | cut -d: -f2)",
      'if [ "$port" = 3000 ]; then other=3001; else other=3000; fi',
      'ver() { node -p "require(\'/opt/jarvis/slot-$1/package.json\').version" 2>/dev/null || echo "?"; }',
      'echo "active=$port"',
      'echo "idle=$other"',
      'echo "versionActive=$(ver "$port")"',
      'echo "versionIdle=$(ver "$other")"',
      'echo "idleUnit=$(systemctl is-active jarvis-web@$other || true)"',
    ].join("\n"),
    true,
  );
  // Hai nguyên nhân, hai lời khác hẳn nhau: đổ oan cho「nền chưa dựng」khi thật ra chỉ đứt mạng
  // là đẩy người đọc đi chạy lại cả một script dựng nền chẳng để làm gì (đã suýt xảy ra 16/08).
  if (probe.status === SSH_TRANSPORT_FAILURE) {
    die(`Không nối được tới VM sau ${SSH_ATTEMPTS} lượt thử (ssh 255) — mạng nhà, hoặc VPN đang bật. Chưa đụng gì tới máy.`);
  }
  if (probe.status !== 0) die("Không đọc được trạng thái trên VM — nền blue/green đã dựng chưa? (setup-backend.sh)");

  const kv = new Map(
    (probe.stdout ?? "")
      .split("\n")
      .map((line) => line.trim().split("="))
      .filter((parts): parts is [string, string] => parts.length === 2),
  );
  const active = Number(kv.get("active"));
  const idle = Number(kv.get("idle"));
  if (!PORTS.includes(active as (typeof PORTS)[number]) || !PORTS.includes(idle as (typeof PORTS)[number])) {
    die(`/etc/caddy/upstream.conf không trỏ vào cổng nào hợp lệ (đọc ra「${kv.get("active") ?? ""}」).`);
  }
  return {
    active,
    idle,
    versionActive: kv.get("versionActive") ?? "?",
    versionIdle: kv.get("versionIdle") ?? "?",
    idleUnit: kv.get("idleUnit") ?? "unknown",
  };
}

/** Đổi upstream của Caddy rồi reload, và tự nghiệm thu qua ĐÚNG đường người dùng đi. */
function switchTo(port: number, expectVersion: string): void {
  remoteOrDie(
    [
      "set -e",
      `echo "reverse_proxy 127.0.0.1:${port}" | sudo tee /etc/caddy/upstream.conf >/dev/null`,
      "sudo systemctl reload caddy",
    ].join("\n"),
    "Không đổi được upstream của Caddy",
  );

  const probe = spawnSync("curl", ["-s", "-o", "/dev/null", "-w", "%{http_code}", "--max-time", "30", `${BACKEND_URL}/login`], {
    encoding: "utf8",
  });
  if (probe.stdout?.trim() !== "200") {
    die(
      `Đã chuyển sang cổng ${port} nhưng ${BACKEND_URL}/login trả「${probe.stdout?.trim() || "không gì cả"}」.\n` +
        `  Lùi lại ngay: npm run deploy:backend -- --rollback`,
    );
  }
  console.log(`✔ ${BACKEND_URL} đang phục vụ từ cổng ${port} — bản ${expectVersion}.`);
}

// ---- Đường lùi bản --------------------------------------------------------------------------

// `--rollback` và `--switch` là MỘT thao tác: trỏ Caddy sang chỗ chạy kia. Hai tên vì hai
// hoàn cảnh, và cả hai đều có thật — lùi về bản cũ, hoặc hoàn tất một lượt phát hành đã dựng
// xong nhưng đứt mạng đúng lúc chuyển (xảy ra 16/08/2026: bản mới nằm khoẻ ở chỗ rảnh, bản cũ
// vẫn phục vụ, chỉ thiếu mỗi cú đổi dòng). Một tên duy nhất sẽ nói dối một trong hai cảnh.
const argv = process.argv.slice(2);
if (argv.includes("--rollback") || argv.includes("--switch")) {
  const state = readState();
  if (state.idleUnit !== "active") {
    die(`Chỗ chạy kia (cổng ${state.idle}) đang「${state.idleUnit}」, không chuyển sang đó được.`);
  }
  console.log(`• Chuyển: cổng ${state.active} (${state.versionActive}) → cổng ${state.idle} (${state.versionIdle})`);
  switchTo(state.idle, state.versionIdle);
  process.exit(0);
}

// ---- Cổng số hiệu bản -----------------------------------------------------------------------

// Đọc từ HEAD chứ không phải cây làm việc: lượt phát hành chở `git archive HEAD`, nên một cú
// bump chưa commit sẽ KHÔNG lên máy — mà cổng thì phải gác đúng thứ sắp được chở đi.
const headPkg = JSON.parse(execFileSync("git", ["show", "HEAD:package.json"], { encoding: "utf8" })) as {
  version?: string;
};
const version = (headPkg.version ?? "").trim();
if (version.length === 0) die("HEAD:package.json không có `version`.");

const state = readState();
if (version === state.versionActive && !argv.includes("--same-version")) {
  die(
    `Bản đang chạy đã là ${version} — phát hành lại cũng không đổi gì trên màn hình.\n\n` +
      `  Mỗi lượt phát hành phải nhích số hiệu (tông chủ chốt 16/08/2026). Hai việc:\n` +
      `    1. package.json  → bump "version"\n` +
      `    2. src/lib/changelog.ts → thêm một mục cho đúng số ấy (npm run verify:changelog để soát)\n` +
      `  rồi commit — cổng này đọc HEAD, nên bump chưa commit là chưa tính.\n\n` +
      `  Thật sự muốn phát hành lại cùng số hiệu: thêm --same-version`,
  );
}

// ---- Dựng bản mới ở chỗ đang RẢNH -----------------------------------------------------------

const sha = execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
const subject = execFileSync("git", ["log", "-1", "--format=%s"], { encoding: "utf8" }).trim();
console.log(`• Phát hành ${version} (${sha}) — ${subject}`);
console.log(`  đang phục vụ: cổng ${state.active} bản ${state.versionActive} → dựng vào cổng ${state.idle}`);

const tmp = mkdtempSync(path.join(tmpdir(), "deploy-backend-"));
const tarball = path.join(tmp, "app.tar.gz");
try {
  // `git archive` bung theo .gitattributes nên .sh giữ LF — đúng thứ VM cần.
  execFileSync("git", ["archive", "--format=tar.gz", "-o", tarball, "HEAD"], { stdio: "inherit" });

  console.log("• Chở gói lên VM…");
  const scp = spawnSync("scp", ["-q", "-i", SSH_KEY, tarball, `${VM_USER}@${VM_HOST}:/tmp/jarvis-app.tar.gz`], {
    stdio: ["ignore", "inherit", "inherit"],
  });
  if (scp.status !== 0) die(`scp thoát ${scp.status}`);

  console.log(`• Dựng release + khởi động cổng ${state.idle} (npm ci + next build — vài phút)…`);
  remoteOrDie(
    [
      "set -e",
      `REL=/opt/jarvis/releases/${sha}-$(date +%H%M%S)`,
      "sudo mkdir -p $REL /opt/jarvis/shared",
      "sudo tar -xzf /tmp/jarvis-app.tar.gz -C $REL",
      "sudo rm -f /tmp/jarvis-app.tar.gz",
      // .env của release là symlink về shared — env sống lâu hơn mọi release
      "sudo ln -sfn /opt/jarvis/shared/.env $REL/.env",
      "sudo chown -R jarvis:jarvis $REL",
      // `npm run build` chứ KHÔNG `npx next build`: hook prebuild đóng gói khôi lỗi
      // (public/linh-su/goi-linh-su.tgz) — gọi thẳng next là gói ấy vắng mặt và mọi lượt cài
      // khôi lỗi tải về 404. Đã trả giá 16/08/2026.
      "cd $REL && sudo -u jarvis npm ci --no-audit --no-fund 2>&1 | tail -2",
      "cd $REL && sudo -u jarvis npm run build 2>&1 | tail -12",
      // Chỗ rảnh trỏ vào release mới. `[ -L ]` gác vì `ln -sfn` vào một THƯ MỤC thật sẽ tạo
      // symlink BÊN TRONG nó thay vì thay thế — app khởi động trong thư mục rỗng.
      `[ -L /opt/jarvis/slot-${state.idle} ] || sudo rm -rf /opt/jarvis/slot-${state.idle}`,
      `sudo ln -sfn $REL /opt/jarvis/slot-${state.idle}`,
      `sudo systemctl enable --now jarvis-web@${state.idle} >/dev/null 2>&1 || true`,
      `sudo systemctl restart jarvis-web@${state.idle}`,
      // Chỗ rảnh KHÔNG nhận traffic, nên chờ ở đây không ai thấy gián đoạn.
      `for i in $(seq 1 45); do sleep 2; code=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:${state.idle}${HEALTH_PATH} || true); [ "$code" = 200 ] && break; done`,
      `echo "cổng ${state.idle}: $(systemctl is-active jarvis-web@${state.idle}) — ${HEALTH_PATH} trả $code"`,
      `[ "$code" = 200 ] || (sudo journalctl -u jarvis-web@${state.idle} -n 30 --no-pager && exit 1)`,
    ].join("\n"),
    `Dựng bản mới ở cổng ${state.idle} không xong — bản ${state.versionActive} ở cổng ${state.active} VẪN đang phục vụ, chưa ai bị ảnh hưởng`,
  );

  // ---- Chuyển traffic: một dòng + một lượt reload êm --------------------------------------
  console.log(`• Chuyển Caddy sang cổng ${state.idle}…`);
  switchTo(state.idle, version);

  // ---- Dọn release cũ, GIỮ hai bản đang được hai chỗ chạy trỏ tới -------------------------
  remoteOrDie(
    [
      "set -e",
      "K1=$(readlink -f /opt/jarvis/slot-3000 2>/dev/null || true)",
      "K2=$(readlink -f /opt/jarvis/slot-3001 2>/dev/null || true)",
      "cd /opt/jarvis/releases",
      "for d in $(ls -1t | tail -n +4); do",
      '  full="/opt/jarvis/releases/$d"',
      '  [ "$full" = "$K1" ] && continue',
      '  [ "$full" = "$K2" ] && continue',
      '  sudo rm -rf "$full"',
      "done",
    ].join("\n"),
    "Dọn release cũ hỏng (bản mới VẪN đang phục vụ)",
  );

  console.log(`  Lùi bản tức thì nếu cần: npm run deploy:backend -- --rollback  (về ${state.versionActive})`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
