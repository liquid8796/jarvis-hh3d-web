#!/usr/bin/env node
/**
 * CHẠY MỘT LỆNH TRONG REPO TRÊN VM BACKEND — cánh cửa vận hành sau ngày 16/08/2026.
 *
 *   npm run vm -- npm run roster:purge -- --dry-run
 *   npm run vm -- npm run github:deploy -- --restart
 *   npm run vm -- --env GITHUB_PAT -- npm run github:new
 *
 * Vì sao cần nó: Postgres + Mongo trên VM chỉ nghe 127.0.0.1 — cố ý, không mở cổng DB ra
 * ngoài. Nên mọi script đụng database (roster:purge, github:*, db:migrate, verify:*) phải
 * đứng TRÊN VM, nơi `.env` của app trỏ localhost. Máy nhà chỉ còn cầm SSH.
 *
 * ── VÌ SAO `ops-repo` CHỨ KHÔNG PHẢI `app` ───────────────────────────────────────────────
 *
 * `/opt/jarvis/app` là release do `deployBackend` bung từ `git archive` — nó KHÔNG có `.git`.
 * `github:deploy` dựng gói khôi lỗi từ chính repo (`uncommittedPayloadPaths` gọi git), nên
 * chạy ở đó là chết ngay với「not a git repository」— đã trả giá 16/08/2026. `/opt/jarvis/ops-repo`
 * là bản clone thật: có `.git`, có `.env` trỏ về `shared/`, có `node_modules`.
 *
 * `git pull` trước mỗi lượt là điều kiện ĐÚNG chứ không phải tiện nghi: gói khôi lỗi được dựng
 * từ cây làm việc, nên ops-repo cũ một commit nghĩa là đẩy mã cũ lên sáu kho GitHub mà bảng
 * tổng kết vẫn báo xanh. Pull hỏng (VPN chặn github.com — đo 16/08) thì KÊU TO kèm commit sẽ
 * dùng rồi vẫn chạy: chặn hẳn đường vận hành vì mạng nhà là cái giá đắt hơn.
 *
 * ── VÌ SAO BÍ MẬT KHÔNG ĐI QUA `--env` CỦA sudo ──────────────────────────────────────────
 *
 * `sudo` ghi TRỌN dòng lệnh vào `/var/log/auth.log`. Nên `sudo -u jarvis env GITHUB_PAT=ghp_…`
 * là chép thẳng một PAT có quyền `repo`+`workflow`+`delete_repo` vào một tệp log dạng chữ.
 * Cờ `--env TÊN` ở đây đọc biến từ env của CHÍNH tiến trình này rồi gửi giá trị qua **stdin**
 * của một lượt ssh riêng, ghi vào tệp 0600 của user `jarvis`; lượt chạy thật chỉ thấy ĐƯỜNG DẪN
 * trên dòng lệnh, và một `trap` xoá tệp khi thoát — kể cả khi lệnh hỏng giữa chừng.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";

const VM_HOST = "92.5.130.32";
const VM_USER = "ubuntu";
const SSH_KEY = path.join(process.env.USERPROFILE ?? process.env.HOME ?? "~", ".ssh", "jarvis_oci_ed25519");
/** Bản clone vận hành — bản DUY NHẤT trên VM có `.git`. */
const OPS_REPO = "/opt/jarvis/ops-repo";
/** tmpfs: bí mật không bao giờ chạm đĩa. */
const SECRET_FILE = "/run/jarvis-vm-secrets";

const die = (message: string): never => {
  console.error(`✗ ${message}`);
  process.exit(1);
};

const ssh = (args: string[], input?: string) =>
  spawnSync("ssh", ["-i", SSH_KEY, "-o", "BatchMode=yes", "-o", "ConnectTimeout=25", `${VM_USER}@${VM_HOST}`, ...args], {
    // TTY khi người thật đang gõ: `github:remove` hỏi lại tên kho trước khi xoá, và câu hỏi ấy
    // phải dùng được. Chạy trong máy móc (không TTY) thì bỏ `-t` để khỏi cảnh báo thừa.
    ...(input === undefined ? { stdio: "inherit" as const } : { input, stdio: ["pipe", "inherit", "inherit"] as const }),
  });

// ---- Đối số: [--env TÊN]… -- <lệnh> ------------------------------------------------------

const argv = process.argv.slice(2);
/** Tên → giá trị, chốt NGAY lúc soát đối số: đọc lại `process.env` ở dưới là mở cửa cho một
 *  giá trị `undefined` lọt vào thân heredoc dưới dạng chuỗi "undefined". */
const forwarded = new Map<string, string>();

let at = 0;
while (argv[at] === "--env") {
  // `?? ""` chứ không nhờ `die` thu hẹp kiểu: `die` là arrow const nên TypeScript không dùng
  // nó làm cổng luồng điều khiển — cùng lối tránh đã dùng ở `deployGithubKhoiloi.mts`.
  const name = argv[at + 1] ?? "";
  if (!/^[A-Z][A-Z0-9_]*$/.test(name)) {
    die("`--env` phải đi kèm TÊN biến viết hoa, ví dụ: --env GITHUB_PAT");
  }
  const value = process.env[name] ?? "";
  if (value.length === 0) die(`Biến ${name} chưa có giá trị ở máy này — script gọi phải đặt nó trước.`);
  // Heredoc dấu nháy = không giãn nở; chỉ một dòng đúng bằng dấu kết mới phá được nó.
  if (/[\r\n]/.test(value)) die(`Giá trị ${name} chứa xuống dòng — không gửi được an toàn.`);
  forwarded.set(name, value);
  at += 2;
  if (argv[at] === "--") at += 1;
}

const cmd = argv.slice(at);
if (cmd.length === 0) {
  console.error("Cách dùng: npm run vm -- [--env TÊN]… <lệnh chạy trong /opt/jarvis/ops-repo trên VM>");
  process.exit(1);
}

// ---- Gửi bí mật (nếu có) qua stdin, KHÔNG qua dòng lệnh ----------------------------------

if (forwarded.size > 0) {
  const body = [...forwarded].map(([name, value]) => `${name}=${value}`).join("\n");
  const writer = [
    "set -e",
    "umask 077",
    `sudo tee ${SECRET_FILE} >/dev/null <<'JARVIS_SECRET_EOF'`,
    body,
    "JARVIS_SECRET_EOF",
    `sudo chown jarvis:jarvis ${SECRET_FILE}`,
    `sudo chmod 600 ${SECRET_FILE}`,
  ].join("\n");

  const put = ssh(["bash -s"], `${writer}\n`);
  if (put.status !== 0) die(`Không gửi được biến sang VM (ssh thoát ${put.status}).`);
}

// ---- Lượt chạy thật ----------------------------------------------------------------------

const sourceLine = forwarded.size > 0 ? `set -a; . ${SECRET_FILE}; set +a; ` : "";
// Pull chạy bằng CHÍNH `jarvis`, chủ của ops-repo — không phải `ubuntu`. Git từ chối làm việc
// trong một repo của user khác («detected dubious ownership») nên bản đầu của tệp này pull
// bằng `ubuntu` và trượt IM LẶNG: lượt `github:deploy` dựng gói từ một cây chậm năm commit mà
// bảng tổng kết vẫn xanh. Đo 16/08/2026. Khoá deploy cũng nằm ở /home/jarvis/.ssh.
const pull =
  `git pull --ff-only -q || echo "⚠ git pull hỏng — chạy trên commit $(git rev-parse --short HEAD) đang có sẵn" >&2; `;
const remote = [
  `cd ${OPS_REPO}`,
  `sudo -u jarvis bash -c '${pull}${sourceLine}exec "$@"' _ ${cmd.join(" ")}`,
].join(" && ");

const tty = process.stdin.isTTY ? ["-t"] : [];
const run = ssh([...tty, remote]);

// Xoá bí mật ngay, và xoá cả khi lệnh trên hỏng — `finally` của tiến trình này.
if (forwarded.size > 0) {
  const clean = ssh([`sudo rm -f ${SECRET_FILE}`]);
  if (clean.status !== 0) {
    console.error(`⚠ KHÔNG xoá được ${SECRET_FILE} trên VM — vào xoá tay ngay: ssh … 'sudo rm -f ${SECRET_FILE}'`);
  }
}

process.exit(run.status ?? 1);
