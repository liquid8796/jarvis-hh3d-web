#!/usr/bin/env node
/**
 * Hồi quy riêng cho "bấm reply → nhảy tới tin gốc".
 *
 * Không ghi chat thật: route /api/chat bị Chromium chặn và trả fixture. Postgres chỉ được ĐỌC
 * một user để ký session, giống verifyChatWindow.mts.
 */
import { SignJWT } from "jose";
import { chromium } from "playwright-core";
import { loadEnv } from "./loadEnv.mjs";
import { sqlTag } from "./pgTag.mjs";

loadEnv();

const argAfter = (name: string): string | undefined => {
  const at = process.argv.indexOf(`--${name}`);
  return at > -1 ? process.argv[at + 1] : undefined;
};

const ORIGIN = (argAfter("origin") ?? "http://127.0.0.1:3110").replace(/\/$/, "");
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL chưa đặt.");
if (!process.env.AUTH_SECRET) throw new Error("AUTH_SECRET chưa đặt.");

const username = (argAfter("user") ?? process.env.ADMIN_USERNAME ?? "admin").toLowerCase();
const rows = await sqlTag(process.env.DATABASE_URL)`
  select u.id, u.username,
         coalesce((select array_agg(ur.role_code) from user_roles ur where ur.user_id = u.id), '{}') as roles
    from users u where u.username = ${username} limit 1
`;
const user = rows[0] as { id: string; username: string; roles: string[] } | undefined;
if (!user) throw new Error(`Không có đạo hữu nào tên「${username}」.`);

const token = await new SignJWT({
  username: user.username,
  role: (user.roles ?? []).some((r) =>
    ["gia-chu", "chuong-mon", "thai-thuong-truong-lao"].includes(r),
  )
    ? "admin"
    : "user",
})
  .setProtectedHeader({ alg: "HS256" })
  .setSubject(user.id)
  .setIssuedAt()
  .setExpirationTime("10m")
  .sign(new TextEncoder().encode(process.env.AUTH_SECRET));

type FakeMessage = {
  id: string;
  userId: string;
  author: string;
  isAdmin: boolean;
  tags: string[];
  text: string;
  sticker: null;
  attachments: [];
  replyTo: { id: string; author: string; excerpt: string } | null;
  reactions: [];
  createdAt: string;
  editedAt: null;
  deleted: false;
};

const BASE = Date.now() - 1_000_000;
const fakeMessage = (n: number): FakeMessage => ({
  id: `fake-${n}`,
  userId: n % 2 === 0 ? "member-even" : "member-odd",
  author: n % 2 === 0 ? "Đạo Hữu A" : "Đạo Hữu B",
  isAdmin: false,
  tags: [],
  text: `Tin thử số ${n}`,
  sticker: null,
  attachments: [],
  replyTo: null,
  reactions: [],
  createdAt: new Date(BASE + n * 1000).toISOString(),
  editedAt: null,
  deleted: false,
});

const browser = await chromium.launch({ headless: true });
let failed = false;
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addCookies([
    { name: "jarvis_session", value: token, url: ORIGIN, httpOnly: true, sameSite: "Lax" },
  ]);
  const page = await context.newPage();
  let olderServed = 0;

  await page.route("**/api/chat**", async (route) => {
    const request = route.request();
    if (request.method() !== "GET") return route.fulfill({ json: { ok: true } });

    const wantsOlder = new URL(request.url()).searchParams.has("beforeAt");
    if (!wantsOlder) {
      const messages = Array.from({ length: 50 }, (_, i) => fakeMessage(350 + i));
      messages[messages.length - 1] = {
        ...messages[messages.length - 1],
        replyTo: { id: "fake-240", author: "Đạo Hữu A", excerpt: "Tin thử số 240" },
      };
      return route.fulfill({ json: { messages, typing: [], avatars: {} } });
    }

    olderServed += 1;
    const start = olderServed === 1 ? 300 : olderServed === 2 ? 250 : 200;
    const messages =
      olderServed <= 3 ? Array.from({ length: 50 }, (_, i) => fakeMessage(start + i)) : [];
    return route.fulfill({ json: { messages, typing: [], avatars: {} } });
  });

  await page.goto(`${ORIGIN}/chat`, { waitUntil: "domcontentloaded", timeout: 30_000 });
  const quote = page.locator(".chat-quote").last();
  await quote.waitFor({ timeout: 30_000 });

  const tag = await quote.evaluate((el) => el.tagName);
  if (tag !== "BUTTON") throw new Error(`quote phải là BUTTON, nhận ${tag}`);

  await quote.click();
  const target = page.locator('[data-msg-id="fake-240"]');
  await target.waitFor({ state: "attached", timeout: 15_000 });
  // Target vừa được React gắn vào DOM; cho layout effect đúng một nhịp để thực hiện cú cuộn/chớp.
  await page.waitForTimeout(120);

  const probe = await page.evaluate(() => {
    const scroller = document.querySelector(".chat-scroll");
    const target = document.querySelector('[data-msg-id="fake-240"]');
    if (!(scroller instanceof HTMLElement) || !(target instanceof HTMLElement)) return null;
    const s = scroller.getBoundingClientRect();
    const t = target.getBoundingClientRect();
    return {
      visible: t.bottom > s.top && t.top < s.bottom,
      highlighted: target.classList.contains("chat-message-jump"),
      topGap: Math.round(t.top - s.top),
    };
  });

  if (olderServed !== 3) throw new Error(`phải lật đúng 3 page, đã lật ${olderServed}`);
  if (!probe?.visible) throw new Error(`target chưa vào viewport: ${JSON.stringify(probe)}`);
  if (!probe.highlighted) throw new Error(`target không được highlight: ${JSON.stringify(probe)}`);

  console.log("✓ quote là button thật");
  console.log("✓ tự lật đúng 3 page cũ để tìm tin gốc");
  console.log(`✓ target vào viewport và highlight (topGap=${probe.topGap}px)`);
  console.log("✔ Reply jump đứng vững trong Chromium thật.");
  await context.close();
} catch (error) {
  failed = true;
  console.error(error);
} finally {
  await browser.close();
}

process.exit(failed ? 1 : 0);
