#!/usr/bin/env node
/**
 * Kiểm chứng CỬA SỔ VẼ của Phòng Chat — trên chính gói đã phát hành, bằng cuộn thật.
 *
 *   npm run verify:chat-window
 *   npm run verify:chat-window -- --origin https://auto-hh3d.vercel.app
 *   npm run verify:chat-window -- --no-images    (chặn ảnh, để tách bạch lỗi cuộn với lỗi ảnh)
 *
 * KHÔNG GIEO MỘT TIN THẬT NÀO, và đó là điểm chính. `page.route` chặn `/api/chat` ngay trong
 * trình duyệt rồi trả về tin giả, nên sảnh của tông môn không hề hay biết — khác hẳn mọi
 * `verify:*` khác vốn dựng hàng tạm trong database thật. Thứ được kiểm vẫn là mã client THẬT,
 * trong một Chromium thật, với những cú cuộn thật.
 *
 * Vì sao phải có: cửa sổ vẽ là một mớ tương tác giữa chiều cao vùng cuộn, sự kiện `scroll` và
 * ba lượt đặt chỗ cuộn của mã. `tsc` không soát hộ được gì ở đó, và mắt thì mù trước câu hỏi
 *「có bao nhiêu thẻ đang thật sự nằm trong DOM」. Chính phép thử này đã bắt được cú
 * `scroll-behavior: smooth` lừa `onScroll` — một lỗi CÓ SẴN, âm thầm bắn một request thừa mỗi
 * lần có người mở sảnh, mà không một lượt xem bằng mắt nào nhìn ra.
 *
 * Chạm database THẬT nhưng CHỈ ĐỌC: một câu select lấy id/vai của tài khoản đóng vai, để ký
 * phiên y như `dev:session` và `shot`. Không ghi gì cả.
 */
import { sqlTag } from "./pgTag.mjs";
import { SignJWT } from "jose";
import { chromium } from "playwright-core";
import { loadEnv } from "./loadEnv.mjs";

loadEnv();

const argAfter = (name: string): string | undefined => {
  const at = process.argv.indexOf(`--${name}`);
  return at > -1 ? process.argv[at + 1] : undefined;
};

/** Mặc định là trạm ĐANG PHỤC VỤ. Đổi bằng `--origin` khi muốn soi một trạm gương. */
const ORIGIN = (argAfter("origin") ?? "https://auto-hh3d-1.vercel.app").replace(/\/$/, "");

/**
 * Kho phải LỚN HƠN cửa sổ thì phép cắt mới lộ ra — 120 so với trần 60. Trang cũ 50 tin cho
 * khớp `FEED_PAGE` thật của server.
 */
const NEWEST_PAGE = 120;
const OLDER_PAGE = 50;
/** Phải khớp `RENDER_WINDOW` và `RENDER_WINDOW_STEP` trong ChatRoom.tsx. */
const WINDOW = 60;
const STEP = 40;
/** Cách đáy dưới ngần này thì coi là đang dính đáy — cùng ngưỡng với `onScroll`. */
const AT_BOTTOM_PX = 60;

/**
 * Bề rộng làn chân dung — phải khớp `AVATAR_SIZE` trong ChatRoom.tsx.
 *
 * Con số này ở đây KHÔNG phải để soi cỡ ảnh đại diện (chuyện của mắt, xem `npm run shot`), mà
 * để canh cái làn `.chat-avatar-gap` của tin nối tiếp vẫn còn đủ bề ngang: mất nó là cả cột
 * bong bóng của một người gãy hàng lề, và `tsc` mù trước chuyện ấy.
 */
const AVATAR_LANE = 62;

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL chưa đặt — chạy `npm run env:pull`.");
if (!process.env.AUTH_SECRET) throw new Error("AUTH_SECRET chưa đặt — chạy `npm run env:pull`.");

const username = (argAfter("user") ?? process.env.ADMIN_USERNAME ?? "admin").toLowerCase();
const rows = await sqlTag(process.env.DATABASE_URL)`
  select u.id, u.username,
         coalesce((select array_agg(ur.role_code) from user_roles ur where ur.user_id = u.id), '{}') as roles
    from users u where u.username = ${username} limit 1
`;
const user = rows[0] as { id: string; username: string; roles: string[] } | undefined;
if (!user) throw new Error(`Không có đạo hữu nào tên「${username}」.`);

const roles: string[] = user.roles ?? [];
const token = await new SignJWT({
  username: user.username,
  role: roles.some((r) => ["gia-chu", "chuong-mon", "thai-thuong-truong-lao"].includes(r)) ? "admin" : "user",
})
  .setProtectedHeader({ alg: "HS256" })
  .setSubject(user.id)
  .setIssuedAt()
  .setExpirationTime("10m")
  .sign(new TextEncoder().encode(process.env.AUTH_SECRET));

/** Tin giả — đúng hình dạng `/api/chat` trả về. `n` càng lớn càng mới. */
const fakeMessage = (n: number) => ({
  id: `fake-${n}`,
  userId: n % 3 === 0 ? user.id : "nguoi-khac",
  author: n % 3 === 0 ? "Kiểm Thử" : "Đạo Hữu Khác",
  isAdmin: false,
  tags: [],
  text: `Tin thử số ${n}`,
  sticker: null,
  attachments: [],
  replyTo: null,
  reactions: [],
  // Cách nhau một phút, tính lùi từ hiện tại — đủ xa để phép gộp tin không gộp chúng lại.
  createdAt: new Date(Date.now() - (400 - n) * 60_000).toISOString(),
  editedAt: null,
  deleted: false,
});

const results: string[] = [];
const check = (name: string, ok: boolean, detail = "") => {
  results.push(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addCookies([
    { name: "jarvis_session", value: token, url: ORIGIN, httpOnly: true, sameSite: "Lax" },
  ]);
  const page = await context.newPage();

  const noise: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") noise.push(`${m.type()}: ${m.text().slice(0, 160)}`);
  });

  // `--no-images`: không có gì mọc thêm SAU lượt vẽ đầu, để tách bạch「cửa sổ tính sai」với
  //「ảnh tải xong thì trang cao lên rồi trôi khỏi đáy」. Hai triệu chứng ấy giống hệt nhau.
  if (process.argv.includes("--no-images")) {
    await page.route("**/*", async (route) =>
      route.request().resourceType() === "image" ? route.abort() : route.fallback(),
    );
  }

  let olderServed = 0;
  await page.route("**/api/chat**", async (route) => {
    const request = route.request();
    if (request.method() !== "GET") return route.continue();

    if (!new URL(request.url()).searchParams.has("beforeAt")) {
      const messages = Array.from({ length: NEWEST_PAGE }, (_, i) => fakeMessage(280 + i));
      return route.fulfill({ json: { messages, typing: [], avatars: {} } });
    }

    // Ba trang cũ rồi hết — trang rỗng chính là tín hiệu `reachedTop` của client.
    olderServed += 1;
    const messages =
      olderServed > 3
        ? []
        : Array.from({ length: OLDER_PAGE }, (_, i) => fakeMessage(280 - olderServed * OLDER_PAGE + i));
    return route.fulfill({ json: { messages, typing: [], avatars: {} } });
  });

  await page.goto(`${ORIGIN}/chat`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".chat-row", { timeout: 30_000 });
  await page.waitForTimeout(1500);

  type Probe = {
    rows: number;
    scrollTop: number;
    toBottom: number;
    khoiNguon: boolean;
  };
  const probe = () =>
    page.evaluate(`(() => {
      const el = document.querySelector(".chat-scroll");
      return {
        rows: document.querySelectorAll(".chat-row").length,
        scrollTop: Math.round(el.scrollTop),
        toBottom: Math.round(el.scrollHeight - el.scrollTop - el.clientHeight),
        khoiNguon: document.body.innerText.includes("Khởi nguồn của sảnh"),
      };
    })()`) as Promise<Probe>;

  /**
   * Cuộn TỨC THÌ. `scroll-behavior: smooth` của sảnh làm một lệnh `scrollTop = …` trượt dần,
   * nên phép thử chờ theo đồng hồ sẽ đo đúng lúc animation còn đang chạy — đã mất hai lượt
   * chạy vì đúng chuyện đó, và mỗi lượt trông y hệt một bản vá hỏng.
   */
  const scrollTo = async (where: "top" | "bottom") => {
    await page.evaluate(`(() => {
      const el = document.querySelector(".chat-scroll");
      el.scrollTo({ top: ${where === "top" ? "0" : "el.scrollHeight"}, behavior: "instant" });
    })()`);
    await page.waitForTimeout(900);
  };

  const first = await probe();
  check(`kho ${NEWEST_PAGE} tin → chỉ dựng ${WINDOW} thẻ`, first.rows === WINDOW, `dựng ${first.rows} thẻ`);
  check("mở ra là đứng ở tin mới nhất", first.toBottom < AT_BOTTOM_PX, `còn ${first.toBottom}px tới đáy`);
  check("chưa trùm hết kho thì KHÔNG nói「Khởi nguồn」", !first.khoiNguon);

  /**
   * CHIỀU CAO CHẾT của tin nối tiếp — phép thử canh đúng cái bẫy đã gỡ ngày 17/08/2026.
   *
   * Trước đó tin nối tiếp vẫn dựng vòng tròn chân dung, chỉ đeo thêm `.invisible`
   * (`visibility: hidden`): ẩn với mắt, nhưng vẫn là một flex item cao 62px, nên MỌI tin nối
   * tiếp cao 62px trong khi bong bóng của nó chỉ ~38px. Không phép đo nào của repo bắt được:
   * `tsc` không biết gì về chiều cao, và ảnh chụp thì trông "hơi thưa" chứ không trông SAI.
   *
   * Nay làn ấy là `.chat-avatar-gap` cao 0, nên hàng phải cao ĐÚNG bằng cột bong bóng. Ai lỡ
   * trả `.invisible` về chỗ cũ sẽ thấy hàng vọt lên 62px và phép thử này đỏ.
   */
  const groupedBox = (await page.evaluate(`(() => {
    const row = document.querySelector(".chat-row.grouped");
    if (!row) return null;
    const gap = row.querySelector(".chat-avatar-gap");
    const box = (el) => (el ? Math.round(el.getBoundingClientRect().height) : -1);
    return {
      row: box(row),
      col: box(row.querySelector(".chat-bubble-col")),
      laneWidth: gap ? Math.round(gap.getBoundingClientRect().width) : -1,
      laneHeight: box(gap),
    };
  })()`)) as { row: number; col: number; laneWidth: number; laneHeight: number } | null;

  check(
    "tin nối tiếp cao ĐÚNG bằng bong bóng, không bị làn chân dung đội lên",
    groupedBox !== null && groupedBox.row === groupedBox.col && groupedBox.row < AVATAR_LANE,
    groupedBox === null
      ? "không có tin nối tiếp nào trong cửa sổ để đo"
      : `hàng ${groupedBox.row}px · bong bóng ${groupedBox.col}px · trần cũ ${AVATAR_LANE}px`,
  );
  check(
    "…mà làn chân dung vẫn chừa đủ bề ngang cho hàng lề",
    groupedBox !== null && groupedBox.laneWidth === AVATAR_LANE && groupedBox.laneHeight === 0,
    groupedBox === null ? "" : `làn ${groupedBox.laneWidth}×${groupedBox.laneHeight}px`,
  );

  await scrollTo("top");
  const grown1 = await probe();
  check(
    `cuộn tới đỉnh → nới cửa sổ thêm ${STEP}, lấy từ kho`,
    grown1.rows === WINDOW + STEP && olderServed === 0,
    `dựng ${grown1.rows} thẻ, đã xin ${olderServed} trang`,
  );
  check("…và giữ nguyên chỗ đang đọc, không bị ném về đỉnh", grown1.scrollTop > 80, `scrollTop=${grown1.scrollTop}`);

  await scrollTo("top");
  check("nới lượt hai → trùm hết kho", (await probe()).rows === NEWEST_PAGE);

  await scrollTo("top");
  await page.waitForTimeout(1200);
  const fetched = await probe();
  check(
    "hết kho mới đi xin trang cũ",
    fetched.rows === NEWEST_PAGE + OLDER_PAGE && olderServed === 1,
    `dựng ${fetched.rows} thẻ, đã xin ${olderServed} trang`,
  );

  await scrollTo("bottom");
  const back = await probe();
  check(`về đáy → cửa sổ co lại còn ${WINDOW}`, back.rows === WINDOW, `dựng ${back.rows} thẻ`);
  check("…và vẫn đứng ở đáy sau khi co", back.toBottom < AT_BOTTOM_PX, `còn ${back.toBottom}px tới đáy`);

  for (const line of results) console.log(`  ${line}`);
  console.log(
    noise.length === 0
      ? "\n  ✓ không một dòng console error/warning nào"
      : `\n  ⚠ console:\n${noise.map((n) => `     ${n}`).join("\n")}`,
  );

  const failed = results.filter((r) => r.startsWith("✗"));
  if (failed.length > 0) {
    console.error(`\n✗ ${failed.length}/${results.length} phép thử hỏng.`);
    process.exitCode = 1;
  } else {
    console.log(`\n✔ Cửa sổ vẽ Phòng Chat: ${results.length} phép thử thuận.`);
  }
} finally {
  await browser.close();
}
