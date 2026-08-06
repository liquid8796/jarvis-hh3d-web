/** Tìm logic khoá/mở nút Điều Hòa trong các file JS của trang lò — thuần đọc. */
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
  await page.waitForTimeout(3000);

  const found = await page.evaluate(`(async () => {
    const bodies = [];
    for (const s of document.querySelectorAll('script[src]')) {
      const u = s.getAttribute('src') || '';
      if (!u.startsWith('/') && !u.includes(location.hostname)) continue;
      try { bodies.push({ from: u.slice(-70), text: await (await fetch(u, { credentials: 'include' })).text() }); }
      catch (e) {}
    }
    for (const s of document.querySelectorAll('script:not([src])')) bodies.push({ from: '(inline)', text: s.textContent || '' });
    const out = [];
    for (const b of bodies) {
      if (!/ldBtnTune/.test(b.text)) continue;
      // moi cum dong den ldBtnTune + moi cho co "68" trong cung file
      const re = /ldBtnTune/g; let m; const seen = new Set();
      while ((m = re.exec(b.text)) !== null) {
        const k = Math.floor(m.index / 500);
        if (seen.has(k)) continue; seen.add(k);
        out.push({ from: b.from, at: m.index, src: b.text.slice(Math.max(0, m.index - 380), m.index + 420).replace(/\\s+/g, ' ') });
        if (out.length > 12) break;
      }
      const t = b.text.search(/68/);
      if (t >= 0) out.push({ from: b.from + ' (quanh "68")', at: t, src: b.text.slice(Math.max(0, t - 350), t + 400).replace(/\\s+/g, ' ') });
    }
    return out;
  })()`);
  for (const h of found as Array<{ from: string; src: string }>) {
    console.log(`\n===== ${h.from} =====\n${h.src.slice(0, 850)}`);
  }
} finally {
  await browser.close().catch(() => {});
}
