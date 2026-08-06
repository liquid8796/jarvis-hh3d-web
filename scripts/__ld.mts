/** Đọc trạng thái lò + cách trang khoá nút Điều Hòa — thuần đọc, không bấm gì. */
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
  await page.waitForTimeout(5000); // đợi XHR trạng thái thật

  const state = await page.evaluate(`(() => {
    const attrs = (el) => {
      if (!el) return '(khong ton tai)';
      const o = {};
      for (const a of el.attributes) o[a.name] = a.value.slice(0, 80);
      return JSON.stringify(o) + ' | disabledProp=' + el.disabled;
    };
    const panel = document.querySelector('#ldPanel') || document.querySelector('#ld-app');
    return {
      tune: attrs(document.querySelector('#ldBtnTune')),
      craft: attrs(document.querySelector('#ldBtnCraft')),
      collect: attrs(document.querySelector('#ldBtnCollect')),
      panelText: panel ? (panel.innerText || '').replace(/\\s+/g, ' ').slice(0, 400) : '(khong co)',
    };
  })()`);
  console.log("=== TRANG LO HIEN TAI ===");
  for (const [k, v] of Object.entries(state as Record<string, string>)) console.log(`${k}: ${v}`);

  // Mã nguồn: mọi chỗ đụng tới ldBtnTune / điều hòa / disabled trong script của trang.
  const src = await page.evaluate(`(() => {
    const all = [...document.querySelectorAll('script:not([src])')].map((s) => s.textContent || '').join('\\n');
    const out = [];
    const re = /ldBtnTune|dieu_hoa|dieuHoa|tune/gi;
    let m; const seen = new Set();
    while ((m = re.exec(all)) !== null) {
      const start = Math.max(0, m.index - 300);
      const key = Math.floor(m.index / 400);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(all.slice(start, m.index + 320).replace(/\\s+/g, ' '));
      if (out.length > 14) break;
    }
    return out;
  })()`);
  console.log("\n=== MA NGUON quanh ldBtnTune ===");
  (src as string[]).forEach((s, i) => console.log(`\n--- [${i}] ---\n${s}`));
} finally {
  await browser.close().catch(() => {});
}
