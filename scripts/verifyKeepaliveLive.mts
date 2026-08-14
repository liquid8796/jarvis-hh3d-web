#!/usr/bin/env node
/**
 * ĐO THẬT NHÁNH TỰ CHỮA CỦA VÒNG NUÔI KHO — `npm run verify:keepalive-live`.
 *
 * KHÁC `verify:github-stations`: bên ấy lái toàn bộ luật qua một `fetch` giả, nên nó chứng minh
 * được「mã phản ứng đúng với câu trả lời ta bịa ra」. Tệp này chứng minh phần còn lại, phần mà
 * `deploy/github-actions.md` §7 tự khai là CHƯA CÓ BẰNG CHỨNG: rằng GitHub thật trả lời đúng như
 * ta đã bịa.
 *
 * Ba giả định đang gánh cả nhánh tự chữa, và cả ba tới nay chỉ sống trong bình chú:
 *
 *   1. `GET …/actions/workflows/{file}` trả `state` là một trong bốn chuỗi ta biết đọc.
 *   2. **`PUT …/enable` trên một workflow ĐANG BẬT vẫn trả 204.** Đây là giả định đắt nhất: nhánh
 *      tự chữa gọi `enable` rồi mới ghi mốc, nên nếu GitHub trả 409/422 cho một workflow đang bật
 *      thì `enableWorkflow` NÉM — và nó ném ở đúng lượt chạy mà tính năng này sinh ra để phục vụ.
 *      Không ai đo được nó bằng `fetch` giả, vì `fetch` giả trả lời theo đúng điều ta tin.
 *   3. `GET …/contents/.github/heartbeat.txt` trả 200 kèm `sha`, hoặc 404 — hai nhánh mà
 *      `commitHeartbeat` rẽ theo. Gửi `sha` sai chiều nào cũng là 422.
 *
 * KHÔNG GHI COMMIT NÀO. Lượt kiểm này chỉ đọc, cộng đúng một lời gọi `enable` vốn không đổi gì —
 * nên nó không để lại dấu chân nào với GitHub, thứ mà cả §7 đánh đổi để có.
 *
 * KHO ĐANG TẮT TAY (`disabled_manually`) thì KHÔNG đụng vào: bật lại giùm là cãi lại một quyết
 * định của con người, và luật ấy đứng ở cả vòng nuôi lẫn ở đây.
 */
import { neon } from "@neondatabase/serverless";
import { decryptSecret, isEncrypted } from "../src/lib/crypto/secretBox";
import { readControlDoc } from "../src/lib/control/read";
import {
  explainFailure,
  parseWorkflowState,
  stationSlug,
  HEARTBEAT_PATH,
  type WorkflowState,
} from "../src/lib/validation/githubStations";
import { pullStationPgFromVercel, resolveActiveStationPg } from "./activeStationPg.mts";
import { loadEnv } from "./loadEnv.mjs";

loadEnv();

const API_ROOT = "https://api.github.com";
const API_VERSION = "2022-11-28";
const USER_AGENT = "auto-hh3d-keepalive-probe";
const REQUEST_TIMEOUT_MS = 15_000;

const die = (message: string): never => {
  console.error(`\n✗ ${message}`);
  process.exit(1);
};

// ---- Database của trạm đang hoạt động ---------------------------------------------------------

const localDatabaseUrl = process.env.DATABASE_URL ?? "";
const doc = await readControlDoc();
const activeSiteId = doc?.activeSiteId ?? null;

let activePg = localDatabaseUrl;
if (activeSiteId) {
  try {
    activePg = await resolveActiveStationPg({ localDatabaseUrl, activeSiteId });
  } catch {
    activePg = pullStationPgFromVercel(activeSiteId);
  }
}
if (activePg.length === 0) die("Không biết phải đọc sổ Kho GitHub ở database nào.");

const sql = neon(activePg);
const rows = (await sql`SELECT value -> 'githubStations' AS stations FROM app_settings WHERE id = 'global'`) as Array<{
  stations: unknown;
}>;
const stations = (Array.isArray(rows[0]?.stations) ? rows[0].stations : []) as Array<Record<string, unknown>>;

if (stations.length === 0) {
  console.log("Sổ Kho GitHub trống — không có kho nào để đo.");
  process.exit(0);
}

console.log(`Đo nhánh tự chữa trên GitHub THẬT — ${stations.length} kho${activeSiteId ? ` (trạm「${activeSiteId}」)` : ""}\n`);

// ---- Lời gọi -----------------------------------------------------------------------------------

async function call(pat: string, method: "GET" | "PUT", path: string): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${API_ROOT}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${pat}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": API_VERSION,
      "user-agent": USER_AGENT,
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const text = await res.text();
  let body: unknown = null;
  if (text.length > 0) {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }
  return { status: res.status, body };
}

let failures = 0;
const say = (ok: boolean, line: string) => {
  if (!ok) failures += 1;
  console.log(`    ${ok ? "✓" : "✗"} ${line}`);
};

// ---- Đo từng kho ---------------------------------------------------------------------------------

/** Trạng thái nào đã gặp ngoài đời — in ở cuối để lần sau biết mình đã đo được những nhánh nào. */
const statesSeen = new Map<WorkflowState, number>();

for (const raw of stations) {
  const station = {
    owner: String(raw.owner ?? ""),
    repo: String(raw.repo ?? ""),
    workflowFile: String(raw.workflowFile ?? "linh-su.yml"),
    pat: String(raw.pat ?? ""),
    enabled: raw.enabled !== false,
  };
  const slug = stationSlug(station);
  console.log(`  ${slug}${station.enabled ? "" : "  (đang tắt trong sổ)"}`);

  if (!isEncrypted(station.pat)) {
    say(false, "phong bì PAT hỏng hoặc trống — dán lại PAT ở form Sửa kho");
    continue;
  }
  let pat: string;
  try {
    pat = decryptSecret(station.pat);
  } catch {
    say(false, "không giải mã được PAT — ENCRYPTION_KEY của trạm này khác lúc PAT được ghi");
    continue;
  }

  const base = `/repos/${encodeURIComponent(station.owner)}/${encodeURIComponent(station.repo)}`;
  const wf = `${base}/actions/workflows/${encodeURIComponent(station.workflowFile)}`;

  // ── Giả định 1: GET workflow trả một `state` ta biết đọc ────────────────────────────────────
  const first = await call(pat, "GET", wf);
  if (first.status !== 200) {
    say(false, explainFailure(first.status, first.body, `hỏi trạng thái ${station.workflowFile}`));
    continue;
  }
  const rawState = (first.body as { state?: unknown } | null)?.state;
  const state = parseWorkflowState(rawState);
  statesSeen.set(state, (statesSeen.get(state) ?? 0) + 1);
  say(
    state !== "unknown",
    `GET workflow → state = ${JSON.stringify(rawState)}` +
      (state === "unknown" ? "  ← GitHub khai một trạng thái LẠ, mã không biết đọc" : ""),
  );

  // ── Giả định 2: PUT enable trên workflow ĐANG BẬT vẫn 204 ───────────────────────────────────
  if (state === "disabled_manually") {
    say(true, "đang TẮT TAY — cố ý không gọi enable (bật lại giùm là cãi lại người đã tắt)");
  } else if (state === "disabled_inactivity") {
    say(
      false,
      "lịch ĐÃ BỊ TẮT vì im lặng — đây là ca thật của nhánh tự chữa, nhưng bật lại mà không ghi " +
        "mốc thì kho vẫn đứng ở ngày thứ 60. Bấm「Nuôi ngay」ở tab Kho GitHub để bật VÀ ghi mốc.",
    );
  } else {
    const enabled = await call(pat, "PUT", `${wf}/enable`);
    say(
      enabled.status === 204,
      `PUT enable trên workflow đang bật → ${enabled.status}` +
        (enabled.status === 204
          ? "  (giả định trong bình chú ĐÚNG)"
          : `  ← nhánh tự chữa sẽ NÉM ở đây: ${explainFailure(enabled.status, enabled.body, "bật lại lịch")}`),
    );

    // Bật một cái đang bật không được phép đổi gì — đọc lại cho chắc, vì "204" chỉ là lời hứa.
    const again = await call(pat, "GET", wf);
    const stateAgain = parseWorkflowState((again.body as { state?: unknown } | null)?.state);
    say(again.status === 200 && stateAgain === state, `đọc lại sau enable → state vẫn ${stateAgain}`);
  }

  // ── Giả định 3: tệp mốc trả 200 kèm sha, hoặc 404 ───────────────────────────────────────────
  const beat = await call(pat, "GET", `${base}/contents/${HEARTBEAT_PATH}`);
  if (beat.status === 200) {
    const sha = (beat.body as { sha?: unknown } | null)?.sha;
    say(typeof sha === "string" && sha.length > 0, `tệp mốc đã có, GitHub kèm sha = ${String(sha).slice(0, 7)}…`);
  } else if (beat.status === 404) {
    say(true, "chưa có tệp mốc (404) — lượt ghi đầu sẽ đi nhánh TẠO MỚI, đúng thiết kế");
  } else {
    say(false, explainFailure(beat.status, beat.body, `đọc ${HEARTBEAT_PATH}`));
  }
}

// ---- Tổng kết ------------------------------------------------------------------------------------

console.log("\n── Trạng thái workflow đã gặp ngoài đời ─────────────");
for (const [state, n] of statesSeen) console.log(`  ${state.padEnd(22)} ${n} kho`);
const chuaGap = (["active", "disabled_inactivity", "disabled_manually"] as const).filter((s) => !statesSeen.has(s));
if (chuaGap.length > 0) {
  console.log(`  (chưa gặp: ${chuaGap.join(", ")} — những nhánh ấy vẫn chỉ có bằng chứng từ fetch giả)`);
}

if (failures > 0) {
  console.log(`\n✗ ${failures} phép đo KHÔNG đạt — đọc từng dòng ✗ ở trên.`);
  process.exit(1);
}
console.log("\n✔ Mọi giả định của nhánh tự chữa đều đúng trên GitHub thật. Không commit nào được tạo ra.");
