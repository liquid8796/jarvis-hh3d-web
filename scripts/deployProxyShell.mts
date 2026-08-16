#!/usr/bin/env node
/**
 * LẬT CÁC TRẠM VERCEL THÀNH VỎ PROXY — nửa còn lại của deploy:backend (16/08/2026).
 *
 *   npm run deploy:all                      lật MỌI trạm mà chìa trong env mở được
 *   npm run deploy:all -- --site auto-hh3d-2   đúng một trạm
 *   npm run deploy:all -- --dry-run         kể kế hoạch, không đụng gì
 *
 * Từ ngày backend về VM OCI, một「lượt phát hành trạm」không còn build gì cả: nó đẩy đúng
 * HAI tệp (vercel.json rewrite + __proxy.txt đánh dấu) qua API v13/deployments với files
 * inline. Không CLI, không .vercel/project.json, không git metadata — nghĩa là hết luôn
 * bệnh BLOCKED git-author và hết cảnh mỗi trạm một .env.
 *
 * Đi bằng API thô thay vì `vercel deploy` còn vì một lẽ vận hành: máy nhà có lúc bị chặn
 * api.vercel.com (VPN — đo 16/08/2026), và script này phải chạy được từ chính VM. Nó chỉ
 * cần các biến VERCEL_TOKEN_* trong env — truyền qua SSH env là đủ, không chép tệp bí mật.
 *
 * Trạm được tìm bằng CHÌA, không bằng sổ: hệ sổ gương (mirrors book) đã nghỉ việc cùng
 * ngày với Neon. Mỗi token được hỏi「ngươi thấy những project auto-hh3d* nào」và mọi
 * project thấy được đều được lật — trạm nào thiếu chìa thì ✗ đích danh, như lệ cũ.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "./loadEnv.mjs";

loadEnv();

const BACKEND_URL = "https://92.5.130.32.sslip.io";
const SHELL_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "deploy", "vercel-proxy");
const SHELL_FILES = ["vercel.json", "__proxy.txt"];

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const onlySite = args.includes("--site") ? args[args.indexOf("--site") + 1] : null;

type Target = { token: string; tokenName: string; teamId: string | null; projectId: string; name: string };

const api = async (token: string, url: string, init?: RequestInit) => {
  const res = await fetch(`https://api.vercel.com${url}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...init?.headers },
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const msg = (body as { error?: { message?: string } }).error?.message ?? res.statusText;
    throw new Error(`${url} → ${res.status}: ${msg}`);
  }
  return body;
};

async function discover(): Promise<Target[]> {
  const tokens = Object.entries(process.env)
    .filter(([k, v]) => k.startsWith("VERCEL_TOKEN") && v)
    .map(([k, v]) => ({ tokenName: k, token: String(v) }));
  if (tokens.length === 0) throw new Error("Không thấy biến VERCEL_TOKEN_* nào trong env.");

  const targets: Target[] = [];
  for (const { tokenName, token } of tokens) {
    const teams = (await api(token, "/v2/teams?limit=20")) as { teams?: { id: string }[] };
    for (const teamId of [null, ...(teams.teams ?? []).map((t) => t.id)]) {
      const q = teamId ? `?teamId=${teamId}&limit=100` : "?limit=100";
      const list = (await api(token, `/v9/projects${q}`)) as { projects?: { id: string; name: string }[] };
      for (const p of list.projects ?? []) {
        if (!p.name.startsWith("auto-hh3d")) continue;
        if (targets.some((t) => t.name === p.name)) continue; // chìa nào tới trước giữ trạm ấy
        targets.push({ token, tokenName, teamId, projectId: p.id, name: p.name });
      }
    }
  }
  return targets.sort((a, b) => a.name.localeCompare(b.name));
}

async function deployShell(t: Target): Promise<string> {
  const files = SHELL_FILES.map((file) => ({
    file,
    data: readFileSync(path.join(SHELL_DIR, file)).toString("base64"),
    encoding: "base64",
  }));
  const q = t.teamId ? `?teamId=${t.teamId}` : "";
  const created = (await api(t.token, `/v13/deployments${q}`, {
    method: "POST",
    body: JSON.stringify({
      name: t.name,
      project: t.projectId,
      target: "production",
      files,
      projectSettings: { framework: null, buildCommand: null, installCommand: null, outputDirectory: null },
    }),
  })) as { id: string };

  // Shell tĩnh dựng trong vài giây; 60s là đã rộng gấp nhiều lần.
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const d = (await api(t.token, `/v13/deployments/${created.id}${q}`)) as { readyState?: string };
    if (d.readyState === "READY") return created.id;
    if (d.readyState === "ERROR" || d.readyState === "CANCELED") {
      throw new Error(`deployment ${created.id} kết thúc ở ${d.readyState}`);
    }
  }
  throw new Error(`deployment ${created.id} chưa READY sau 60s`);
}

const targets = (await discover()).filter((t) => !onlySite || t.name === onlySite);
if (targets.length === 0) throw new Error(onlySite ? `Không chìa nào thấy project「${onlySite}」.` : "Không thấy trạm nào.");

console.log(`• Vỏ proxy → ${BACKEND_URL}`);
for (const t of targets) console.log(`  ${dryRun ? "·" : "→"} ${t.name} qua ${t.tokenName}${t.teamId ? ` (team ${t.teamId})` : ""}`);
if (dryRun) {
  console.log("\n--dry-run: dừng ở đây, chưa lật trạm nào.");
  process.exit(0);
}

let failed = 0;
for (const t of targets) {
  try {
    await deployShell(t);
    // Bằng chứng sống: vật đánh dấu phải đọc được qua CHÍNH hostname người dùng vào.
    const probe = await fetch(`https://${t.name}.vercel.app/__proxy.txt`, { redirect: "manual" });
    console.log(`  ✔ ${t.name} — READY, __proxy.txt trả ${probe.status}`);
    if (probe.status !== 200) failed += 1;
  } catch (err) {
    failed += 1;
    console.error(`  ✗ ${t.name} — ${err instanceof Error ? err.message : String(err)}`);
  }
}

if (failed > 0) {
  console.error(`\n✗ ${failed}/${targets.length} trạm chưa lật xong — đọc dòng ✗ ở trên.`);
  process.exit(1);
}
console.log(`\n✔ ${targets.length}/${targets.length} trạm đã thành vỏ proxy về ${BACKEND_URL}.`);
