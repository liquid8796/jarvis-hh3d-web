#!/usr/bin/env node
/**
 * CHẠY MỘT LỆNH TRONG REPO TRÊN VM BACKEND — cánh cửa vận hành sau ngày 16/08/2026.
 *
 *   npm run vm -- npm run roster:purge -- --dry-run
 *   npm run vm -- npm run github:deploy -- --restart
 *   npm run vm -- npm run db:migrate
 *
 * Vì sao cần nó: Postgres + Mongo trên VM chỉ nghe 127.0.0.1 — cố ý, không mở cổng DB ra
 * ngoài. Nên mọi script đụng database (roster:purge, github:deploy, db:migrate, verify:*)
 * phải đứng TRÊN VM, nơi `.env` của app trỏ localhost. Máy nhà chỉ còn cầm SSH.
 *
 * Lệnh chạy trong /opt/jarvis/app (release đang phục vụ) bằng user `jarvis` — cùng user,
 * cùng env với chính app, nên「script thấy gì」và「app thấy gì」không bao giờ lệch nhau.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";

const VM_HOST = "92.5.130.32";
const SSH_KEY = path.join(process.env.USERPROFILE ?? process.env.HOME ?? "~", ".ssh", "jarvis_oci_ed25519");

const cmd = process.argv.slice(2);
if (cmd.length === 0) {
  console.error("Cách dùng: npm run vm -- <lệnh chạy trong /opt/jarvis/app trên VM>");
  process.exit(1);
}

// Ghép rồi bọc trong bash -lc: lệnh của người gọi vốn là thứ họ sẽ gõ trong một shell.
const remote = `cd /opt/jarvis/app && sudo -u jarvis ${cmd.join(" ")}`;
const run = spawnSync(
  "ssh",
  ["-i", SSH_KEY, "-o", "BatchMode=yes", "-o", "ConnectTimeout=25", `ubuntu@${VM_HOST}`, remote],
  { stdio: "inherit" },
);
process.exit(run.status ?? 1);
