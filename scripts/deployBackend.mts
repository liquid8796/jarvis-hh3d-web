#!/usr/bin/env node
/**
 * PHÁT HÀNH BACKEND LÊN VM OCI — thay vai của deploy:all từ 16/08/2026.
 *
 *   npm run deploy:backend                 phát hành HEAD lên jarvis-oci-01
 *   npm run deploy:backend -- --restart    chỉ khởi động lại service, không chở mã
 *
 * Vì sao dựng cây từ `git archive HEAD` chứ không rsync cây làm việc: một-tới-bốn phiên
 * Claude dùng chung thư mục này (xem bản ghi hai-phien-chung-mot-cay-lam-viec), nên cây
 * làm việc LUÔN có thể đang mang tệp dở của phiên khác. HEAD là thứ duy nhất đã được ai
 * đó quyết định phát hành — cùng lý do với deployAllStations cũ.
 *
 * Bố cục trên VM (setup-backend.sh dựng sẵn nền):
 *
 *   /opt/jarvis/releases/<sha>/   mỗi lượt một thư mục, build xong mới được trỏ vào
 *   /opt/jarvis/app               symlink → release đang phục vụ (systemd đi qua đây)
 *   /opt/jarvis/shared/.env       env sống NGOÀI mọi release; mỗi release symlink .env về đây
 *
 * Build xong TRƯỚC rồi mới lật symlink + restart — thời gian nghỉ của backend là một cú
 * restart service (~2s), không phải cả lượt npm ci + next build. Release cũ giữ lại một
 * bản: lật hỏng thì `ln -sfn` ngược lại là xong, không phải build lại từ đầu.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const VM_HOST = "92.5.130.32";
const VM_USER = "ubuntu";
const SSH_KEY = path.join(process.env.USERPROFILE ?? process.env.HOME ?? "~", ".ssh", "jarvis_oci_ed25519");
const BACKEND_URL = "https://92.5.130.32.sslip.io";

const args = new Set(process.argv.slice(2));
const restartOnly = args.has("--restart");

const ssh = (script: string) => {
  const run = spawnSync(
    "ssh",
    ["-i", SSH_KEY, "-o", "BatchMode=yes", "-o", "ConnectTimeout=25", `${VM_USER}@${VM_HOST}`, script],
    { stdio: ["ignore", "inherit", "inherit"] },
  );
  if (run.status !== 0) {
    throw new Error(`SSH thoát ${run.status} — đọc dòng lỗi ngay trên.`);
  }
};

if (restartOnly) {
  console.log("• Chỉ khởi động lại jarvis-web…");
  ssh("sudo systemctl restart jarvis-web && systemctl is-active jarvis-web");
  process.exit(0);
}

const sha = execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
const subject = execFileSync("git", ["log", "-1", "--format=%s"], { encoding: "utf8" }).trim();
console.log(`• Phát hành commit ${sha} — ${subject}`);
console.log(`  đích: ${VM_USER}@${VM_HOST} → ${BACKEND_URL}`);

// 1. Đóng gói HEAD. `git archive` bung theo .gitattributes nên .sh giữ LF — đúng thứ VM cần.
const tmp = mkdtempSync(path.join(tmpdir(), "deploy-backend-"));
const tarball = path.join(tmp, "app.tar.gz");
try {
  execFileSync("git", ["archive", "--format=tar.gz", "-o", tarball, "HEAD"], { stdio: "inherit" });

  console.log("• Chở gói lên VM…");
  const scp = spawnSync("scp", ["-q", "-i", SSH_KEY, tarball, `${VM_USER}@${VM_HOST}:/tmp/jarvis-app.tar.gz`], {
    stdio: ["ignore", "inherit", "inherit"],
  });
  if (scp.status !== 0) throw new Error(`scp thoát ${scp.status}`);

  // 2. Toàn bộ phần trên VM là MỘT script sh -e: chết ở đâu là dừng ở đó, release đang phục
  //    vụ không bị đụng tới cho đến dòng lật symlink.
  console.log("• Dựng release trên VM (npm ci + next build — vài phút)…");
  ssh(
    [
      "set -e",
      `REL=/opt/jarvis/releases/${sha}-$(date +%H%M%S)`,
      "sudo mkdir -p $REL /opt/jarvis/shared",
      "sudo tar -xzf /tmp/jarvis-app.tar.gz -C $REL",
      "sudo rm -f /tmp/jarvis-app.tar.gz",
      // .env của release là symlink về shared — env sống lâu hơn mọi release
      "sudo ln -sfn /opt/jarvis/shared/.env $REL/.env",
      "sudo chown -R jarvis:jarvis $REL",
      "cd $REL && sudo -u jarvis npm ci --no-audit --no-fund 2>&1 | tail -2",
      // `npm run build` chứ KHÔNG phải `npx next build`: hook prebuild đóng gói khôi lỗi
      // (public/linh-su/goi-linh-su.tgz) — gọi thẳng next là gói ấy vắng mặt và mọi lượt
      // cài khôi lỗi tải về 404. Đã trả giá ngay lượt phát hành đầu tiên.
      "cd $REL && sudo -u jarvis npm run build 2>&1 | tail -12",
      // 3. Lật symlink rồi restart — điểm duy nhất chạm vào bản đang phục vụ.
      //    Gác trước khi lật: /opt/jarvis/app mà là THƯ MỤC thật thì `ln -sfn` sẽ tạo
      //    symlink BÊN TRONG nó chứ không thay nó — app khởi động trong thư mục rỗng,
      //    npx tự tải một bản next lạ và chết với「no production build」. Đã trả giá
      //    ngay lượt phát hành đầu (setup-backend.sh từng dựng sẵn thư mục ấy).
      "[ -L /opt/jarvis/app ] || sudo rm -rf /opt/jarvis/app",
      "sudo ln -sfn $REL /opt/jarvis/app",
      "sudo systemctl restart jarvis-web",
      // 4. Canh cửa: service phải sống VÀ cổng 3000 phải trả lời trong 60s
      "for i in $(seq 1 30); do sleep 2; code=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/ || true); [ \"$code\" != 000 ] && break; done",
      "echo \"jarvis-web: $(systemctl is-active jarvis-web) — HTTP nội bộ: $code\"",
      "[ \"$code\" != 000 ] || (echo '✗ App không trả lời sau 60s — journalctl -u jarvis-web -n 50' && sudo journalctl -u jarvis-web -n 30 --no-pager && exit 1)",
      // 5. Dọn release cũ, giữ lại 2 bản gần nhất để còn đường lùi
      "cd /opt/jarvis/releases && ls -1t | tail -n +3 | xargs -r sudo rm -rf",
    ].join(" && "),
  );

  // 6. Bằng chứng từ NGOÀI: đi đúng đường người dùng sẽ đi (Caddy + TLS)
  const probe = spawnSync("curl", ["-s", "-o", "/dev/null", "-w", "%{http_code}", "--max-time", "30", `${BACKEND_URL}/login`], {
    encoding: "utf8",
  });
  const code = probe.stdout?.trim();
  if (code !== "200") {
    throw new Error(`✗ ${BACKEND_URL}/login trả ${code || "không gì cả"} — backend chưa phục vụ được từ ngoài.`);
  }
  console.log(`✔ ${BACKEND_URL} đang phục vụ (login trả 200) — commit ${sha} đã sống.`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
