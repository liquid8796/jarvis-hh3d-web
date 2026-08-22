#!/usr/bin/env node
/**
 * Kiểm chứng ĐỒNG HỒ CHỜ của Mê Cung — cái đã đuổi sạch cả đội ngay sau hiệp đầu.
 *
 *   npm run verify:maze-kick
 *
 * ── CHUYỆN ĐÃ XẢY RA (đàn c242fcb5, khôi lỗi vine-citadel, 22/08/2026) ───────────────────
 *
 * Tông chủ báo: "mê cung chưa đánh đủ trần của ngày thì tự dưng giải tán phòng rồi đàn bị treo
 * luôn ko tiếp tục quest nào cả". Nhật ký của đàn ấy kể lại từng giây:
 *
 *   17:11:58  «Hoang Qui Em» vào phòng · «Bạch Dạ» vào phòng · «Kim Kull» vào phòng
 *   17:12:38  Đủ đội — BẮT ĐẦU! Cả đội đang đánh ải
 *   17:14:34  Xong lượt đánh — huyền tinh hôm nay 142/860 (+142)
 *   17:14:34  Trục xuất «Hoang Qui Em» — không sẵn sàng sau 155s (ngưỡng 20s)   ← cả bốn
 *   17:14:34  Trục xuất «Bạch Dạ» · «Kim Kull» · «Huyền Phá Nguyên»              ← cùng lúc
 *
 * 17:11:58 → 17:14:34 là ĐÚNG 156 giây. Tức đồng hồ "không sẵn sàng" đã chạy suốt trận đánh
 * 116 giây, vì `S.since[tên]` được đặt lúc THẤY NGƯỜI LẦN ĐẦU và không bao giờ đặt lại. Hết
 * trận cả đội về sảnh ở trạng thái chưa bấm sẵn sàng, đồng hồ đã 155s > ngưỡng 20s, và bị đuổi
 * sạch. Người mới vào sau cũng chịu chung số phận sau đúng 20 giây — chưa kịp bấm sẵn sàng.
 * Hệ quả: phòng không bao giờ đủ đội nữa, 142/860 đứng im, và lượt ghé giữ trọn 35 phút ngân
 * sách mà không đánh thêm ải nào — thứ tông chủ thấy thành "đàn treo".
 *
 * ── TỆP NÀY ĐO GÌ, VÀ KHÔNG ĐO GÌ ────────────────────────────────────────────────────────
 *
 * Chạy CHÍNH ba script đang ship trong `profile.json` (đọc ra từ hồ sơ, không chép tay) trong
 * Chromium thật, với `Date.now` bị ghim để thời gian là thứ ta điều khiển được.
 *
 * **Nói thẳng giới hạn:** Mê Cung KHÔNG có bản ghi hình nào trên máy này và cũng chưa có
 * fixture nào trong `npm run smoke` — đó chính là lý do lỗi này ship được. Nên markup dưới đây
 * dựng từ ĐÚNG những selector mà script đang đọc, không phải chép từ `dom/*.html`. Với thứ
 * đang kiểm — NGỮ NGHĨA CỦA MỘT CÁI ĐỒNG HỒ — đó là đủ và trung thực; nó không chứng minh được
 * rằng trang thật vẫn còn dùng những selector ấy. Có bản ghi Mê Cung thì việc đầu tiên nên làm
 * là thay khối markup này bằng bản chép.
 */
import { createServer } from "node:http";
import { chromium } from "playwright-core";
import { loadProfile } from "../src/lib/quest-engine/profile.mjs";

const QUEST_ID = "me-cung";
const KICK_IDLE = 20;

type Step = { action: string; script?: string; steps?: Step[] };

const results: string[] = [];
const check = (name: string, ok: boolean, detail = "") => {
  results.push(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const profile = loadProfile();
const quest = profile.quests.find((q: { id: string }) => q.id === QUEST_ID) as
  | { id: string; steps: Step[] }
  | undefined;
if (!quest) {
  console.error(`✗ không thấy nhiệm vụ ${QUEST_ID} trong hồ sơ.`);
  process.exit(1);
}

/** Duyệt phẳng cả cây bước, vì ba script này nằm ở ba độ sâu khác nhau trong vòng lặp. */
const flat = (steps: Step[]): Step[] =>
  steps.flatMap((s) => [s, ...(Array.isArray(s.steps) ? flat(s.steps) : [])]);
const all = flat(quest.steps ?? []);
const scriptWith = (needle: string) =>
  all.find((s) => s.action === "evaluateJavaScript" && (s.script ?? "").includes(needle))?.script ?? "";

/** Tuỳ chọn được thay ở đây đúng như engine làm lúc chạy: HP tắt, ngưỡng chờ 20 giây. */
const fill = (src: string) =>
  src.replace(/\{\{kickHp\}\}/g, "0").replace(/\{\{kickIdle\}\}/g, String(KICK_IDLE)).replace(/\{\{capCheck\}\}/g, ".mc-cap-on");

const rosterSrc = fill(scriptWith("kick-scan"));
const roundResetSrc = fill(scriptWith("__jvzChestHook"));
const reportSrc = fill(scriptWith("Xong lượt đánh"));

type Player = { name: string; hp: number; ready: boolean };

/** Sảnh phòng, dựng từ đúng những selector script đang đọc (xem ghi chú giới hạn ở đầu tệp). */
const lobby = (players: Player[], daily = "Hôm nay đã nhận 142/860") => `
<div class="mc-ht-daily-text">${daily}</div>
<div id="lobby-ready">${players.filter((p) => p.ready).length}/5</div>
<button id="btn-start">Bắt Đầu</button>
${players
  .map(
    (p) => `<div class="player-card">
  <span class="player-name">${p.name}</span>
  <span class="pp-hp">${p.hp.toLocaleString("vi-VN")}</span>
  ${p.ready ? '<span class="ready-badge is-ready">Sẵn sàng</span>' : '<span class="ready-badge">Chưa sẵn sàng</span>'}
  <button class="btn-kick">Đuổi</button>
</div>`,
  )
  .join("\n")}`;

const TEAM = (ready: boolean): Player[] => [
  { name: "Hoang Qui Em", hp: 850080, ready },
  { name: "Bạch Dạ | 白夜", hp: 907660, ready },
  { name: "Kim Kull", hp: 898495, ready },
];

// `sessionStorage` chỉ tồn tại trên một origin thật — `about:blank` ném SecurityError, mà chính
// sessionStorage là chỗ hai script dưới đây cất số rương và cờ "sảnh vắng". Một máy chủ tí hon
// là đủ, và cũng gần đời thật hơn.
const server = createServer((_req, res) => {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end('<!doctype html><html lang="vi"><body></body></html>');
});
await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
const port = (server.address() as { port: number }).port;

const browser = await chromium.launch({ headless: true, channel: "chromium" });
try {
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${port}/`);
  // Thời gian là thứ đang kiểm, nên nó phải là thứ ta cầm — không ngủ thật giây nào.
  await page.evaluate(() => {
    (window as unknown as { __t: number }).__t = 1_000_000;
    Date.now = () => (window as unknown as { __t: number }).__t;
  });

  const at = (ms: number) => page.evaluate((v) => { (window as unknown as { __t: number }).__t = v; }, 1_000_000 + ms);
  const render = (html: string) => page.evaluate((h) => { document.body.innerHTML = h; }, html);
  const run = (src: string) =>
    page.evaluate(`(() => { const v = (${src}); return typeof v === "function" ? v() : v; })()`) as Promise<unknown>;
  const marked = () =>
    page.evaluate(() =>
      Array.from(document.querySelectorAll(".btn-kick.jarvis-kick")).map(
        (b) => (b.closest(".player-card")?.querySelector(".player-name")?.textContent ?? "?").trim(),
      ),
    );
  const freshVisit = () => page.evaluate(() => {
    (window as unknown as { __jvz?: unknown; __jvzChestHook?: boolean }).__jvz = { roster: null, told: [] };
    delete (window as unknown as { __jvzChestHook?: boolean }).__jvzChestHook;
    document.body.className = "";
    try { sessionStorage.clear(); } catch (e) { /* trang trắng vẫn có sessionStorage */ }
  });

  // ---- 1. Ba script đều tìm thấy trong hồ sơ đang ship ------------------------------------
  {
    check("hồ sơ có script quét phòng", rosterSrc !== "");
    check("hồ sơ có script đầu mỗi vòng", roundResetSrc !== "");
    check("hồ sơ có script báo cáo cuối vòng", reportSrc !== "");
    check(
      "script đầu vòng có nay đặt lại đồng hồ chờ",
      roundResetSrc.includes("S0.since = {}"),
      "thiếu nó thì cả đội bị đuổi ngay sau hiệp đầu",
    );
  }

  // ---- 2. Ngưỡng vẫn còn răng: ai KHÔNG bấm sẵn sàng thì vẫn bị đuổi ----------------------
  {
    await freshVisit();
    await at(0);
    await render(lobby(TEAM(false)));
    await run(rosterSrc);
    check("vừa vào phòng → chưa ai bị đánh dấu", (await marked()).length === 0);

    await at((KICK_IDLE - 5) * 1000);
    await render(lobby(TEAM(false)));
    await run(rosterSrc);
    check(`chờ ${KICK_IDLE - 5}s (dưới ngưỡng) → vẫn chưa ai bị đánh dấu`, (await marked()).length === 0);

    await at((KICK_IDLE + 5) * 1000);
    await render(lobby(TEAM(false)));
    await run(rosterSrc);
    check(`chờ ${KICK_IDLE + 5}s (quá ngưỡng) → cả ba bị đánh dấu`, (await marked()).length === 3, (await marked()).join(", "));
  }

  // ---- 3. Bấm sẵn sàng thì đồng hồ về 0 — không bị đuổi vì "đã ở phòng lâu" ---------------
  {
    await freshVisit();
    await at(0);
    await render(lobby(TEAM(false)));
    await run(rosterSrc);

    await at(15_000);
    await render(lobby(TEAM(true)));
    await run(rosterSrc);
    check("đang sẵn sàng thì không bao giờ bị đánh dấu", (await marked()).length === 0);

    // Bỏ sẵn sàng ở giây 15; ngưỡng phải tính TỪ ĐÓ, không phải từ lúc vào phòng.
    await at(30_000);
    await render(lobby(TEAM(false)));
    await run(rosterSrc);
    check(
      "vừa bỏ sẵn sàng 15s (dưới ngưỡng) → chưa bị đuổi dù đã ở phòng 30s",
      (await marked()).length === 0,
      (await marked()).join(", "),
    );

    await at(40_000);
    await render(lobby(TEAM(false)));
    await run(rosterSrc);
    check("bỏ sẵn sàng quá ngưỡng → mới bị đánh dấu", (await marked()).length === 3);
  }

  // ---- 4. CHÍNH CA ĐÃ HỎNG: hết trận về sảnh, cả đội KHÔNG được bị đuổi ------------------
  {
    await freshVisit();
    await at(0);
    await run(roundResetSrc); // đầu vòng 1
    await render(lobby(TEAM(false)));
    await run(rosterSrc);
    await at(40_000);
    await render(lobby(TEAM(true)));
    await run(rosterSrc); // đủ đội, vào trận

    // Trận đánh 116 giây, đúng bằng bản ghi thật (17:12:38 → 17:14:34).
    await at(156_000);
    await run(roundResetSrc); // đầu vòng 2 — đây là chỗ đồng hồ phải được trả về 0
    await render(lobby(TEAM(false))); // về sảnh, ai cũng chưa bấm sẵn sàng lại
    await run(rosterSrc);
    check(
      "HẾT TRẬN VỀ SẢNH: cả đội KHÔNG bị đuổi (đây là lỗi đã báo)",
      (await marked()).length === 0,
      (await marked()).join(", ") || "sạch",
    );

    // …nhưng ân hạn ấy là ĐÚNG một ngưỡng, không phải vô hạn.
    await at(156_000 + (KICK_IDLE + 5) * 1000);
    await render(lobby(TEAM(false)));
    await run(rosterSrc);
    check("…và ai vẫn không bấm sẵn sàng sau đó thì vẫn bị đuổi như thường", (await marked()).length === 3);
  }

  // ---- 5. Báo cáo cuối vòng không được bịa ra một lượt đánh -------------------------------
  {
    await freshVisit();
    await at(0);
    await run(roundResetSrc);
    await render(lobby(TEAM(true)));
    // Vòng 1: có đánh, có rương.
    await page.evaluate(() => {
      (window as unknown as { __jvz: { battle: boolean } }).__jvz.battle = true;
      sessionStorage.setItem("__jvz_mc_chest", JSON.stringify({ total: 142, cap: 860, gain: 142, already: false }));
    });
    const said1 = String(await run(reportSrc));
    check("vòng có đánh → báo đúng số của lượt ấy", said1.includes("Xong lượt đánh") && said1.includes("142/860") && said1.includes("(+142)"), said1);

    // Vòng 2: KHÔNG lập được đội. Số cũ phải bị xoá, và không được nhận vơ là đã đánh.
    await run(roundResetSrc);
    await render(lobby(TEAM(false)));
    const said2 = String(await run(reportSrc));
    check("vòng KHÔNG đánh → thôi bịa lại con số của vòng trước", !said2.includes("(+142)"), said2);
    check("…và nói thẳng là không lập được đội", said2.includes("không lập được đội"), said2);
    check("…lần đầu thì vẫn thử thêm một vòng", said2.includes("thử thêm một vòng"), said2);
    const bailed1 = await page.evaluate(() => document.body.classList.contains("jvz-mc-noteam"));
    check("…và CHƯA cắm cờ thoát", bailed1 === false);

    // Vòng 3: vẫn không lập được đội → cắm cờ để vòng ngoài thoát, trả đàn về cho nhiệm vụ khác.
    await run(roundResetSrc);
    await render(lobby(TEAM(false)));
    const said3 = String(await run(reportSrc));
    check("hai vòng liền không lập được đội → cắm cờ thoát", await page.evaluate(() => document.body.classList.contains("jvz-mc-noteam")), said3);
    check("…và nói rõ sẽ ghé lại sau", said3.includes("ghé lại sau"), said3);
    check(
      "…cờ ấy được ghim vào sessionStorage để sống qua một cú nạp lại trang",
      await page.evaluate(() => sessionStorage.getItem("__jvz_mc_noteam") === "1"),
    );
  }

  // ---- 6. Nhịp ghé lại: sảnh vắng thì lùi hẳn, và script không được phép NÉM --------------
  {
    const resume = (quest.steps ?? []).at(-1) as { action: string; script?: string } | undefined;
    check("bước cuối vẫn là bước tự khai nhịp ghé lại", resume?.action === "readCooldownSeconds");
    const src = resume?.script ?? "";

    // Bộ smoke biên dịch và GỌI script này trong Node — không có document, không có
    // sessionStorage. Ném ở đó là cả nhiệm vụ rơi về trần một giờ, nên phép đọc nào cũng phải
    // nằm trong try/catch. (Chính chỗ này đã đỏ một lượt trước khi kịp ship.)
    let outside: unknown = "NÉM";
    try {
      outside = new Function(`return (${src});`)()();
    } catch (e) {
      outside = `NÉM: ${(e as Error).message}`;
    }
    check("chạy ngoài trình duyệt: không ném, và rơi về nhịp thường", outside === 60, String(outside));

    await freshVisit();
    await render(lobby(TEAM(false)));
    check("trong trang, sảnh chưa vắng → nhịp thường 60s", (await run(src)) === 60);

    await page.evaluate(() => { try { sessionStorage.setItem("__jvz_mc_noteam", "1"); } catch (e) { /* ignore */ } });
    check("sảnh vắng → lùi 10 phút thay vì quay lại sau một phút để đứng nhìn tiếp", (await run(src)) === 600);
  }

  // ---- 7. Cửa thoát ấy phải nằm trong `until` của vòng NGOÀI, không phải ở StopIf ---------
  {
    const outer = (quest.steps ?? []).find(
      (s) => s.action === "repeat" && ((s as { until?: { selector?: string } }).until?.selector ?? "").includes("jvz-cap-full"),
    ) as { until?: { selector?: string } } | undefined;
    check(
      "vòng ngoài thoát được khi sảnh vắng",
      (outer?.until?.selector ?? "").includes("jvz-mc-noteam"),
      outer?.until?.selector ?? "KHÔNG CÓ",
    );
    // StopIf đầu lượt KHÔNG được mang cờ ấy: nó chạy TRƯỚC khi thử vòng nào, mà cờ chỉ có
    // nghĩa sau hai vòng hụt. Mang vào đó là lượt ghé sau tự dừng trước khi kịp thử.
    const stop = (quest.steps ?? []).find((s) => s.action === "stopIf") as
      | { condition?: { selector?: string } }
      | undefined;
    check(
      "cổng StopIf đầu lượt KHÔNG mang cờ ấy",
      !(stop?.condition?.selector ?? "").includes("jvz-mc-noteam"),
      stop?.condition?.selector ?? "",
    );
  }
} finally {
  await browser.close();
  await new Promise<void>((ok) => server.close(() => ok()));
}

for (const line of results) console.log(`  ${line}`);
const failed = results.filter((r) => r.startsWith("✗"));
if (failed.length > 0) {
  console.error(`\n✗ ${failed.length}/${results.length} phép thử hỏng.`);
  process.exit(1);
}
console.log(`\n✔ Đồng hồ chờ Mê Cung: ${results.length} phép thử thuận.`);
