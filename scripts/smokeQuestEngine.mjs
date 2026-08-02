#!/usr/bin/env node
/**
 * Lưới hồi quy cho bộ thông dịch nhiệm vụ.
 *
 *   node scripts/smokeQuestEngine.mjs
 *
 * Chạy engine thật, trên Chromium thật, trước một trang thật do chính script này dựng. Cố ý
 * KHÔNG mock trình duyệt: mỗi lỗi đắt nhất trong lịch sử bản desktop đều nằm ở chỗ tiếp xúc
 * giữa engine và một trang sống — một cái marker biến mất, một cái nút không chịu đứng yên,
 * một selector vắng mặt rơi về quét cả trang. Mock lại đúng những chỗ ấy thì lưới này chỉ
 * kiểm tra chính giả định của nó.
 *
 * Mỗi ca dưới đây là một chuyện đã xảy ra một lần rồi.
 */

import { createServer } from "node:http";
import { chromium } from "playwright-core";
import { createQuestEngine } from "../src/lib/quest-engine/engine.mjs";
import { createSession } from "../src/lib/quest-engine/session.mjs";
import { parseCookieString } from "../src/lib/quest-engine/runCycle.mjs";
import { parseCooldownSeconds } from "../src/lib/quest-engine/cooldown.mjs";
import { profileForConfig } from "../src/lib/quest-engine/profile.mjs";

const PAGE = `<!doctype html>
<html lang="vi"><head><meta charset="utf-8"><title>Sảnh thử</title>
<style>
  body { font-family: sans-serif; }
  .hidden-twin { position: absolute; opacity: 0; width: 120px; height: 30px; }
  #pulse { animation: drift 220ms infinite alternate; position: relative; }
  @keyframes drift { from { left: 0; } to { left: 60px; } }
  .locked { pointer-events: none; }
</style></head>
<body>
  <div id="counter">Huyền tinh hôm nay: <span id="cap">120/385</span></div>
  <div id="clock">Còn lại 01:02:03</div>

  <!-- Bản sao ẩn đứng TRƯỚC bản thật: judging the first match alone đọc nhầm cái này. -->
  <button class="twin hidden-twin">Khiêu chiến</button>
  <button class="twin" id="real-twin">Khiêu chiến</button>

  <button id="btn-plain">Bấm thường</button>
  <button id="pulse">BẮT ĐẦU</button>

  <button id="btn-disabled" class="btn-disabled">Đã nhận</button>

  <div id="mode-normal" class="is-normal">phòng thường</div>
  <div id="mode-hard" class="is-hard">phòng khó</div>

  <div id="tally">0</div>
  <button id="tick">+1</button>

  <script>
    document.getElementById('btn-plain').addEventListener('click', () => {
      document.getElementById('btn-plain').dataset.hit = '1';
    });
    document.getElementById('pulse').addEventListener('click', () => {
      document.getElementById('pulse').dataset.hit = '1';
    });
    document.getElementById('tick').addEventListener('click', () => {
      const el = document.getElementById('tally');
      el.textContent = String(Number(el.textContent) + 1);
    });
  </script>
</body></html>`;

// ---------------------------------------------------------------------------------------

let passed = 0;
const failures = [];

function check(name, condition, detail = "") {
  if (condition) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

/** Một quest tuỳ biến dựng nhanh quanh vài bước. */
const questOf = (steps, options = []) => ({
  id: "test",
  name: "Thử",
  enabled: true,
  kind: "customSteps",
  matchTexts: [],
  steps,
  options,
  fallbackCooldownSeconds: 3600,
  order: 0,
});

async function main() {
  // --- các kiểm thuần, không cần trình duyệt ---------------------------------------
  console.log("\nParser & lớp dịch cấu hình");

  check("cooldown 01:02:03 → 3723s", parseCooldownSeconds("Còn lại 01:02:03") === 3723);
  check(
    "hh:mm:ss được thử TRƯỚC mm:ss",
    parseCooldownSeconds("01:23:45") === 5025,
    `nhận ${parseCooldownSeconds("01:23:45")}`,
  );
  check("'2 giờ 5 phút' → 7500s", parseCooldownSeconds("còn 2 giờ 5 phút") === 7500);
  check("chữ không có thời gian → null", parseCooldownSeconds("chưa tới lượt") === null);

  const cookies = parseCookieString("wordpress_logged_in_ab=x|y|z=; other=2", "https://e.test");
  check("cookie tách ở dấu = ĐẦU TIÊN", cookies[0]?.value === "x|y|z=", `nhận ${cookies[0]?.value}`);
  check("cookie thứ hai vẫn còn", cookies.length === 2 && cookies[1].name === "other");

  const notes = [];
  const cfg = {
    gameCookie: "a=b",
    runner: "local",
    quests: {
      meCung: { enabled: true, mode: "is-hard", kickHp: 250_000, capCheck: false },
      luyenDan: { enabled: true, tier: "Cực Phẩm", keepStarsFrom: 4 },
    },
  };
  const profile = profileForConfig(cfg, (m) => notes.push(m));
  const meCung = profile.quests.find((q) => q.name === "Mê Cung");
  const luyenDan = profile.quests.find((q) => q.name === "Luyện Đan Đường");
  const opt = (q, k) => q.options.find((o) => o.key === k);

  check("Mê Cung được bật theo config", meCung.enabled === true);
  check("mode → is-hard", opt(meCung, "mode").selectedValue === "is-hard");
  // Ca đắt nhất của lớp dịch: một ngưỡng HP không nằm trong danh sách mà bị rơi về lựa
  // chọn đầu tiên nghĩa là "Không trục xuất" — người dùng gõ 250.000 rồi xem cả lượt chạy
  // không đuổi ai, mà chẳng có dòng nhật ký nào giải thích.
  check("kickHp lạ được giữ nguyên văn", opt(meCung, "kickHp").selectedValue === "250000");
  check("kickHp lạ bật allowCustom", opt(meCung, "kickHp").allowCustom === true);
  check("và việc đó được kể lại", notes.some((n) => n.includes("250000")), notes.join(" / "));
  check("capCheck=false → nhánh «không kiểm tra»", opt(meCung, "capCheck").selectedValue.includes("«"));
  check("tier → Cực Phẩm", opt(luyenDan, "tier").selectedValue === "Cực Phẩm");
  check(
    "keepStarsFrom=4 → giữ 4 sao trở lên",
    opt(luyenDan, "decompose").selectedValue === "dược khí 4 sao|dược khí 5 sao",
    opt(luyenDan, "decompose").selectedValue,
  );

  // Mốc 1 và 5 từng bị hoán chỗ giữa form và lớp dịch. Đan chỉ rơi 1–4 sao, nên "giữ từ 5"
  // là phân giải sạch — chọn nhầm chỗ này thì người dùng bấm "giữ tất cả" rồi mất tất cả,
  // và không có một dòng lỗi nào để lần ra.
  const keepAll = profileForConfig(
    { ...cfg, quests: { ...cfg.quests, luyenDan: { ...cfg.quests.luyenDan, keepStarsFrom: 1 } } },
    () => {},
  ).quests.find((q) => q.name === "Luyện Đan Đường");
  check(
    "keepStarsFrom=1 → giữ TẤT CẢ, không phân giải gì",
    opt(keepAll, "decompose").selectedValue === "dược khí",
    opt(keepAll, "decompose").selectedValue,
  );
  const keepNone = profileForConfig(
    { ...cfg, quests: { ...cfg.quests, luyenDan: { ...cfg.quests.luyenDan, keepStarsFrom: 0 } } },
    () => {},
  ).quests.find((q) => q.name === "Luyện Đan Đường");
  check(
    "keepStarsFrom=0 → phân giải tất cả",
    opt(keepNone, "decompose").selectedValue.includes("«"),
    opt(keepNone, "decompose").selectedValue,
  );

  console.log("\nHạng tài khoản");

  const { questsForAccount } = await import("../src/lib/quest-engine/engine.mjs");
  const { loadProfile } = await import("../src/lib/quest-engine/profile.mjs");

  check(
    "mọi quest trong hồ sơ đều khai requiresVip",
    loadProfile().quests.every((q) => q.requiresVip === true),
  );
  check("tài khoản VIP chạy đủ những gì đã bật", questsForAccount(profile, { isVip: true }).length === 2);
  check("tài khoản thường không đụng quest VIP", questsForAccount(profile, { isVip: false }).length === 0);

  // Trường vắng mặt phải đọc là VIP-only: mọi quest có trước trường này đều được ghi trên
  // tài khoản VIP, nên hồ sơ cũ thiếu trường phải hành xử như thể đã khai vậy. Đọc ngược
  // chiều thì tài khoản thường chạy đủ 12 quest VIP — và hỏng cả 12.
  const legacy = {
    quests: [
      { name: "cũ, thiếu trường", enabled: true, order: 1 },
      { name: "mới, hàng thường", enabled: true, order: 2, requiresVip: false },
    ],
  };
  const freePlan = questsForAccount(legacy, { isVip: false });
  check(
    "quest cũ thiếu trường được coi là VIP-only",
    freePlan.length === 1 && freePlan[0].requiresVip === false,
    freePlan.map((q) => q.name).join(", "),
  );

  console.log("\nChính sách chọn linh sứ");

  const { decideRunner, sandboxAllowedFor } = await import("../src/lib/runners/policy.ts");
  const onlyLuyenDan = {
    ...cfg,
    quests: { ...cfg.quests, meCung: { ...cfg.quests.meCung, enabled: false } },
  };

  check("tông chủ được mở sandbox", sandboxAllowedFor({ role: "admin" }) === true);
  check("đạo hữu thường thì chưa", sandboxAllowedFor({ role: "member" }) === false);

  // Ràng buộc phải sống Ở ĐÂY chứ không chỉ ở form: một document đã nằm sẵn trong database
  // từ hồi `sandbox` còn là mặc định vẫn mang đúng chữ đó, và nó không đi qua form lần nào.
  const denied = decideRunner({ ...onlyLuyenDan, runner: "sandbox" }, { sandboxAllowed: false });
  check("chưa được mở → ép về máy nhà", denied.runner === "local", denied.runner);
  check("và nói rõ vì sao", denied.reason.includes("thử nghiệm"), denied.reason);

  process.env.SANDBOX_ENABLED = "1";
  const allowed = decideRunner({ ...onlyLuyenDan, runner: "sandbox" }, { sandboxAllowed: true });
  check("được mở + chỉ Luyện Đan → sandbox", allowed.runner === "sandbox", allowed.reason);

  // Quyền không được phép lấn át hình dạng nhiệm vụ: Mê Cung vẫn phải là máy nhà, kể cả với
  // tông chủ, vì mất VM giữa trận là bốn người khác mất lượt oan.
  const meCungAdmin = decideRunner({ ...cfg, runner: "sandbox" }, { sandboxAllowed: true });
  check("Mê Cung vẫn về máy nhà kể cả với tông chủ", meCungAdmin.runner === "local", meCungAdmin.reason);
  delete process.env.SANDBOX_ENABLED;
  check(
    "quest không được bật thì vẫn tắt",
    profile.quests.filter((q) => q.enabled).length === 2,
  );

  // --- kiểm trên trang thật ---------------------------------------------------------
  const server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(PAGE);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const browser = await chromium.launch({ headless: true });
  const infos = [];
  const debugs = [];
  const log = {
    info: (_s, m) => infos.push(m),
    warning: (_s, m) => infos.push(m),
    debug: (_s, m) => debugs.push(m),
  };

  try {
    const page = await browser.newPage();
    const session = createSession(page, {
      baseUrl,
      // Session ghi vào cùng kênh debug với engine: call log của Playwright là nhân chứng
      // duy nhất gọi được tên thứ chặn một cú click, và ca forceClick dưới kia kiểm chính nó.
      log: { info: () => {}, warning: () => {}, debug: (m) => debugs.push(m) },
      minActionDelayMs: 0,
      maxActionDelayMs: 1,
    });
    const engine = createQuestEngine({ log });
    const run = (quest) => engine.run(session, { dailyQuestPath: "/" }, quest);

    console.log("\nĐiều kiện trên trang sống");
    await session.navigate(baseUrl);

    const cond = (c) => session.evaluate(
      (arg) => globalThis.__probe(arg),
      c,
    );
    // Nạp conditionProbe vào trang một lần để gọi lại nhiều lần cho gọn.
    const { conditionProbe } = await import("../src/lib/quest-engine/boardScripts.mjs");
    await page.evaluate(`globalThis.__probe = ${conditionProbe.toString()}`);

    check("visible là câu hỏi ∃ — bản sao ẩn không che được bản thật",
      (await cond({ selector: ".twin", kind: "visible" })) === true);
    check("disabled là câu hỏi ∀ — còn một cái sống thì chưa phải disabled",
      (await cond({ selector: ".twin", kind: "disabled" })) === false);
    check("class trông-như-disabled vẫn tính là disabled",
      (await cond({ selector: "#btn-disabled", kind: "enabled" })) === false);
    // Đây là ca "#mc-ht-daily-used → 385 khớp nhầm ATK 5.385".
    check("selector vắng mặt KHÔNG rơi về quét cả trang",
      (await cond({ selector: "#khong-ton-tai", kind: "textMatches", text: "385" })) === false);
    check("selector rỗng thì mới là cả trang",
      (await cond({ selector: "", kind: "textMatches", text: "huyen tinh" })) === true);
    check("textMatches bỏ dấu được",
      (await cond({ selector: "#counter", kind: "textMatches", text: "huyen tinh hom nay" })) === true);
    check("textMatches 'a|b' là phép HOẶC",
      (await cond({ selector: "#counter", kind: "textMatches", text: "999/385|120/385" })) === true);
    check("textNotMatches là phép PHỦ ĐỊNH của HOẶC",
      (await cond({ selector: "#counter", kind: "textNotMatches", text: "999/385|120/385" })) === false);

    console.log("\nGuard, stopIf, kênh tường thuật");

    // Guard không đúng thì bước KHÔNG được thực hiện. Khác hẳn `optional`, thứ vẫn bấm rồi
    // mới tha lỗi — với một cú click thì chính việc bấm mới là rủi ro.
    await run(questOf([
      { action: "click", selector: "#btn-plain", timeoutMs: 2000,
        when: { selector: "#khong-ton-tai", kind: "visible" } },
    ]));
    check("guard sai → không bấm",
      (await page.evaluate(() => document.getElementById("btn-plain").dataset.hit)) === undefined);
    check("và nhật ký nêu tên điều kiện",
      debugs.some((d) => d.includes("chưa hội đủ điều kiện")), debugs.join(" / "));

    await run(questOf([
      { action: "click", selector: "#btn-plain", timeoutMs: 2000,
        when: { selector: "#counter", kind: "visible" } },
    ]));
    check("guard đúng → có bấm",
      (await page.evaluate(() => document.getElementById("btn-plain").dataset.hit)) === "1");

    const stopped = await run(questOf([
      { action: "stopIf", text: "đã đủ huyền tinh hôm nay", timeoutMs: 2000,
        condition: { selector: "#cap", kind: "textMatches", text: "120/385" } },
      { action: "click", selector: "#tick", timeoutMs: 2000 },
    ]));
    check("stopIf khớp → alreadyDone chứ không failed", stopped.outcome === "alreadyDone", stopped.outcome);
    check("stopIf giữ nguyên lời người viết", stopped.message === "đã đủ huyền tinh hôm nay");
    check("bước sau stopIf không chạy",
      (await page.evaluate(() => document.getElementById("tally").textContent)) === "0");

    infos.length = 0;
    debugs.length = 0;
    await run(questOf([
      { action: "evaluateJavaScript", timeoutMs: 2000,
        script: "() => '!Tiểu Minh vừa vào phòng (HP 210000)\\nkick-scan thr=250000 n=4'" },
    ]));
    check("dòng '!' lên kênh người đọc",
      infos.some((m) => m === "Tiểu Minh vừa vào phòng (HP 210000)"), infos.join(" / "));
    check("dòng còn lại xuống kênh số liệu",
      debugs.some((d) => d.includes("kick-scan thr=250000")), debugs.join(" / "));
    check("và số liệu KHÔNG lẫn lên kênh người đọc",
      !infos.some((m) => m.includes("kick-scan")));

    console.log("\nforceClick trên một cái nút không chịu đứng yên");

    // Chuyện thật: site animate #btn-start bằng ready-glow, hộp bao không đứng yên nổi hai
    // khung hình, và mọi cú click thường chết vì "waiting for element to be stable" — trên
    // đúng cái nút mà quest vừa dò thấy sẵn sàng.
    const plain = await run(questOf([
      { action: "click", selector: "#pulse", timeoutMs: 1500 },
    ]));
    check("click thường chết trên phần tử đang animate", plain.outcome === "failed", plain.outcome);
    check("và lý do của Playwright được giữ lại",
      debugs.some((d) => /stable|timeout|exceeded/i.test(d)), debugs.slice(-2).join(" / "));

    const forced = await run(questOf([
      { action: "click", selector: "#pulse", timeoutMs: 1500, forceClick: true },
    ]));
    check("forceClick thì bấm được", forced.outcome === "completed", forced.outcome);
    check("và cú bấm thật sự tới nơi",
      (await page.evaluate(() => document.getElementById("pulse").dataset.hit)) === "1");

    console.log("\nOption sống & repeat");

    // Option thay vào selector, và ĐỔI GIỮA CHỪNG phải có hiệu lực ngay bước sau — đây là
    // khiếu nại 01/08: đổi ngưỡng trục xuất mà script vẫn chạy giá trị cũ tới ~95 phút.
    const liveQuest = questOf(
      [
        { action: "repeat", timeoutMs: 2000, maxIterations: 6, maxSeconds: 30,
          until: { selector: "#tally", kind: "textMatches", text: "{{stopAt}}" },
          steps: [{ action: "click", selector: "#tick", timeoutMs: 2000 }] },
      ],
      [{ key: "stopAt", label: "Dừng ở", allowCustom: true, selectedValue: "2",
         choices: [{ value: "2", label: "2" }, { value: "4", label: "4" }] }],
    );

    await page.evaluate(() => { document.getElementById("tally").textContent = "0"; });
    await run(liveQuest);
    check("until đọc option → dừng đúng ở 2",
      (await page.evaluate(() => document.getElementById("tally").textContent)) === "2");

    await page.evaluate(() => { document.getElementById("tally").textContent = "0"; });
    liveQuest.options[0].selectedValue = "4"; // người dùng đổi lựa chọn
    await run(liveQuest);
    check("đổi option → until mới có hiệu lực ngay",
      (await page.evaluate(() => document.getElementById("tally").textContent)) === "4");

    // until được kiểm TRƯỚC thân vòng, nên một vòng đã đạt mục tiêu sẵn thì không chạy lần nào.
    await page.evaluate(() => { document.getElementById("tally").textContent = "4"; });
    await run(liveQuest);
    check("until đã đạt sẵn → thân vòng không chạy lần nào",
      (await page.evaluate(() => document.getElementById("tally").textContent)) === "4");

    // Trần số vòng luôn có hiệu lực, kể cả khi until không bao giờ đúng.
    await page.evaluate(() => { document.getElementById("tally").textContent = "0"; });
    await run(questOf([
      { action: "repeat", timeoutMs: 2000, maxIterations: 3, maxSeconds: 30,
        until: { selector: "#tally", kind: "textMatches", text: "999" },
        steps: [{ action: "click", selector: "#tick", timeoutMs: 2000 }] },
    ]));
    check("trần số vòng chặn được vòng lặp không có lối ra",
      (await page.evaluate(() => document.getElementById("tally").textContent)) === "3");

    console.log("\nBước tuỳ chọn & cooldown");

    const optional = await run(questOf([
      { action: "click", selector: "#khong-ton-tai", timeoutMs: 800, optional: true },
      { action: "readCooldownSeconds", selector: "#clock", timeoutMs: 2000 },
    ]));
    check("bước optional hỏng không làm hỏng cả quest", optional.outcome === "completed", optional.outcome);
    check("cooldown đọc từ trang → 3723s", optional.cooldownSeconds === 3723, String(optional.cooldownSeconds));

    const fatal = await run(questOf([
      { action: "click", selector: "#khong-ton-tai", timeoutMs: 800 },
    ]));
    check("bước bắt buộc hỏng thì quest hỏng", fatal.outcome === "failed", fatal.outcome);
  } finally {
    await browser.close().catch(() => {});
    server.close();
  }

  console.log(`\n${passed} thuận, ${failures.length} nghịch.`);
  if (failures.length > 0) {
    for (const f of failures) console.log(`  ✗ ${f}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
