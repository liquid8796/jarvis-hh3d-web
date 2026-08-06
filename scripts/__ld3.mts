/** Lấy handler Điều Hòa (Vt) + luật đếm giữ lửa + chuỗi "cần 3 lần" từ luyen-dan.min.js. */
import { neon } from "@neondatabase/serverless";
import { chromium } from "playwright-core";
import { decryptSecret, isEncrypted } from "../src/lib/crypto/secretBox";
import { parseCookieString, DEFAULT_GAME_BASE_URL } from "../src/lib/quest-engine/cookies.mjs";
import { loadEnv } from "./loadEnv.mjs";

loadEnv();
const sql = neon(process.env.DATABASE_URL!);
const BASE = process.env.GAME_BASE_URL || DEFAULT_GAME_BASE_URL;
const rows = await sql`
  select acc.cookie_envelope from game_accounts acc join users u on u.id = acc.user_id
  where u.role='admin' and acc.label='ironstark' limit 1`;
const env = String((rows[0] as Record<string, unknown>).cookie_envelope);
const jar = parseCookieString(isEncrypted(env) ? decryptSecret(env) : env, BASE) as never[];

const browser = await chromium.launch({
  headless: true,
  args: ["--disable-blink-features=AutomationControlled"],
  ignoreDefaultArgs: ["--enable-automation"],
});
const ctx = await browser.newContext({
  userAgent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36",
  locale: "vi-VN",
  timezoneId: "Asia/Ho_Chi_Minh",
  viewport: { width: 1366, height: 768 },
});
await ctx.addCookies(jar);
const page = await ctx.newPage();
try {
  await page.goto(`${BASE}/luyen-dan-duong`, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForSelector("#ld-app", { timeout: 30000 });
  await page.waitForTimeout(2500);

  const out = await page.evaluate(`(async () => {
    let js = '';
    for (const s of document.querySelectorAll('script[src]')) {
      const u = s.getAttribute('src') || '';
      if (!/luyen-dan/.test(u)) continue;
      js = await (await fetch(u, { credentials: 'include' })).text();
      break;
    }
    if (!js) return { err: 'khong tim thay luyen-dan.min.js' };
    const grab = (re, span, n) => {
      const hits = [];
      let m;
      while ((m = re.exec(js)) !== null && hits.length < n) {
        hits.push(js.slice(Math.max(0, m.index - 120), m.index + span).replace(/\\s+/g, ' '));
      }
      return hits;
    };
    return {
      // handler Vt — cú bấm Điều Hòa làm gì
      vt: grab(/function Vt\\(/g, 1200, 1),
      // chuỗi hướng dẫn quanh "cần" + "lần"
      can: grab(/c\\u1ea7n|cần/g, 260, 8),
      // luật survival/đếm
      survival: grab(/tuneSurvivalActive|tuneCount\\s*[=<>+]/g, 260, 8),
      // hiệu lực theo nguỡng 68
      eff: grab(/tuneEffectiveMaxPct/g, 300, 6),
    };
  })()`);
  for (const [k, arr] of Object.entries(out as Record<string, string[]>)) {
    console.log(`\n===== ${k} =====`);
    (Array.isArray(arr) ? arr : [String(arr)]).forEach((s, i) => console.log(`--- [${i}] ${s.slice(0, 700)}`));
  }
} finally {
  await browser.close().catch(() => {});
}
