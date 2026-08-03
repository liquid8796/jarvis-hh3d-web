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

import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { chromium } from "playwright-core";
import { createQuestEngine } from "../src/lib/quest-engine/engine.mjs";
import { createSession } from "../src/lib/quest-engine/session.mjs";
import { parseCookieString } from "../src/lib/quest-engine/runCycle.mjs";
import { computeNextDelaySeconds, parseCooldownSeconds } from "../src/lib/quest-engine/cooldown.mjs";
import { profileForConfig } from "../src/lib/quest-engine/profile.mjs";
import {
  createQuizReferenceDirectory,
  createReferenceQuiz,
  parseQuizReferenceHtml,
} from "../src/lib/quest-engine/quizReference.mjs";

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

  <div id="quiz-fixture">
    <div id="question">Vũ hồn thứ hai của Đường Tam là gì?</div>
    <button class="quiz-option">Lam Ngân Thảo</button>
    <button class="quiz-option">Nhu Cốt Thỏ</button>
    <button class="quiz-option">Hạo Thiên Chùy</button>
    <button class="quiz-option">Thất Bảo Lưu Ly Tháp</button>
  </div>

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
    document.querySelectorAll('#quiz-fixture .quiz-option').forEach((option) => {
      option.addEventListener('click', (event) => {
        if (!event.isTrusted) return;
        document.getElementById('quiz-fixture').dataset.chosen = option.textContent.trim();
        document.querySelectorAll('#quiz-fixture .quiz-option').forEach((item) => {
          item.classList.toggle('correct', item.textContent.trim() === 'Hạo Thiên Chùy');
        });
      });
    });
  </script>
</body></html>`;

// Ba trang giả dưới đây giữ đúng các selector/state transition nhìn thấy trong recording
// 02/08. Chúng không mock Playwright: profile schema 43 vẫn điều khiển Chromium thật.
const FREE_CHECKIN_PAGE = `<!doctype html><html lang="vi"><meta charset="utf-8">
<button id="checkInButton">Điểm Danh</button>
<script>checkInButton.onclick=()=>setTimeout(()=>{checkInButton.textContent='Đã Điểm Danh';checkInButton.dataset.claimed='1'},30)</script>`;

const FREE_HUB_PAGE = `<!doctype html><html lang="vi"><meta charset="utf-8">
<div class="nv-quest"><a class="btn-go" onclick="location.href='/phuc-loi-duong'">Làm Ngay ›</a></div>`;

const FREE_WELFARE_PAGE = `<!doctype html><html lang="vi"><meta charset="utf-8">
<div id="countdown-timer">00:00</div>
<div id="chest-1"><img alt="Rương 1" style="width:40px;height:40px"></div>
<div id="chest-2"><img alt="Rương 2" style="width:40px;height:40px"></div>
<div id="chest-3"><img alt="Rương 3" style="width:40px;height:40px"></div>
<div id="chest-4"><img alt="Rương 4" style="width:40px;height:40px"></div>
<script>document.querySelectorAll('[id^=chest-] img').forEach((img,i)=>img.onclick=()=>{
  if(countdown.textContent!=='00:00')return;
  setTimeout(()=>{countdown.textContent='30:00';countdown.dataset.claimed=String(i+1)},30)
});const countdown=document.getElementById('countdown-timer')</script>`;

const FREE_WHEEL_PAGE = `<!doctype html><html lang="vi"><meta charset="utf-8">
<div id="userTurns">2</div><button id="spinButton">Quay Ngay</button>
<div id="prizeSubtitle" style="display:none">Chúc mừng đạo hữu</div>
<script>let spins=0;prizeSubtitle.onclick=()=>prizeSubtitle.style.display='none';spinButton.onclick=()=>{
  spinButton.disabled=true;setTimeout(()=>{spins++;userTurns.textContent=String(2-spins);
  prizeSubtitle.style.display='block';spinButton.dataset.spins=String(spins);spinButton.disabled=false;
  if(spins===2)spinButton.textContent='Hết lượt'},40)
}</script>`;

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

  console.log("\nLịch nhiều vòng");
  const noJitter = { random: () => 0 };
  check(
    "thức dậy theo cooldown sớm nhất",
    computeNextDelaySeconds(
      [
        { outcome: "onCooldown", cooldownSeconds: 3723 },
        { outcome: "completed", cooldownSeconds: 300 },
      ],
      noJitter,
    ) === 300,
  );
  check(
    "vòng không đọc được đồng hồ → ghé lại sau 5 phút",
    computeNextDelaySeconds([], noJitter) === 300,
  );
  check(
    "vòng chỉ có lỗi → nghỉ 30 phút, không quét dồn",
    computeNextDelaySeconds([{ outcome: "failed" }], noJitter) === 1800,
  );
  check(
    "cooldown quá ngắn vẫn có sàn 30 giây",
    computeNextDelaySeconds([{ outcome: "completed", cooldownSeconds: 2 }], noJitter) === 30,
  );
  check(
    "jitter lịch nằm trong 0–25 giây",
    computeNextDelaySeconds([], { random: () => 0.999 }) === 325,
  );

  console.log("\nDanh sách tham khảo Vấn Đáp");
  const referencePage = `
    <table>
      <tr><td>1</td><td>Vũ hồn thứ hai của Đường Tam là gì?</td><td>3. Hạo Thiên Chùy</td></tr>
      <tr><td>2</td><td><b>Công pháp nào của Hàn Lập?</b></td><td>Tất cả đáp án (ghi chú cộng đồng)</td></tr>
      <tr><td>3</td><td>Câu đang có tranh luận?</td><td>1. Phương án A</td></tr>
      <tr><td>4</td><td>Câu đang có tranh luận?</td><td>2. Phương án B</td></tr>
      <tr><td>5</td><td>C&#226;u c&#243; entity &amp; HTML?</td><td>Đáp án entity</td></tr>
    </table>`;
  const parsedReference = parseQuizReferenceHtml(referencePage);
  check("parser đọc đủ câu, gộp câu trùng", parsedReference.size === 4, `nhận ${parsedReference.size}`);
  check(
    "parser giải HTML entity trước khi fold",
    parsedReference.has("cau co entity html"),
    [...parsedReference.keys()].join(" / "),
  );

  let referenceFetches = 0;
  const referenceLogs = [];
  const referenceDirectory = createQuizReferenceDirectory({
    fetchImpl: async () => {
      referenceFetches++;
      return { ok: true, status: 200, text: async () => referencePage };
    },
  });
  const referenceQuiz = createReferenceQuiz({
    url: "https://reference.test/list",
    directory: referenceDirectory,
    log: {
      info: (_scope, message) => referenceLogs.push(message),
      warning: (_scope, message) => referenceLogs.push(message),
      debug: (_scope, message) => referenceLogs.push(message),
    },
  });

  const listedAnswer = await referenceQuiz.resolve({
    text: "Vu hon thu hai cua Duong Tam la gi ?",
    options: ["Nhu Cốt Thỏ", "Hạo Thiên Chùy", "Lam Ngân Thảo"],
  });
  check(
    "bỏ số thứ tự, bỏ dấu rồi chọn theo TEXT chứ không theo vị trí",
    listedAnswer?.option === "Hạo Thiên Chùy" && listedAnswer.index === 1,
    JSON.stringify(listedAnswer),
  );
  check("nhật ký gọi đúng nguồn danh sách tham khảo", listedAnswer?.source === "danh sách tham khảo");

  const answerWithNote = await referenceQuiz.resolve({
    text: "Công pháp nào của Hàn Lập?",
    options: ["Thanh Nguyên Kiếm Quyết", "Tất cả đáp án", "Tam Chuyển Trọng Nguyên Công"],
  });
  check("ghi chú cuối `(…)` không làm lệch đáp án", answerWithNote?.option === "Tất cả đáp án");
  check(
    "hai lần tra trong 12 giờ chỉ tải danh sách một lần",
    referenceFetches === 1,
    `đã tải ${referenceFetches} lần`,
  );
  check(
    "nguồn tự mâu thuẫn thì không chọn bừa",
    (await referenceQuiz.resolve({
      text: "Câu đang có tranh luận?",
      options: ["Phương án A", "Phương án B", "Phương án C"],
    })) === null,
  );
  check(
    "câu không có trong danh sách thì trả null, không Gemini",
    (await referenceQuiz.resolve({
      text: "Câu hoàn toàn mới?",
      options: ["A", "B", "C", "D"],
    })) === null,
  );

  let fakeNow = 1_000;
  let staleFetches = 0;
  const staleWarnings = [];
  const staleDirectory = createQuizReferenceDirectory({
    freshnessMs: 50,
    now: () => fakeNow,
    fetchImpl: async () => {
      staleFetches++;
      if (staleFetches > 1) throw new Error("mạng thử nghiệm đứt");
      return { ok: true, status: 200, text: async () => referencePage };
    },
  });
  const staleQuiz = createReferenceQuiz({
    url: "https://reference.test/stale",
    directory: staleDirectory,
    log: {
      info() {},
      debug() {},
      warning: (_scope, message) => staleWarnings.push(message),
    },
  });
  await staleQuiz.resolve({
    text: "Vũ hồn thứ hai của Đường Tam là gì?",
    options: ["Hạo Thiên Chùy", "Khác"],
  });
  fakeNow += 100;
  const staleFallback = await staleQuiz.resolve({
    text: "Vũ hồn thứ hai của Đường Tam là gì?",
    options: ["Hạo Thiên Chùy", "Khác"],
  });
  check("refresh lỗi vẫn giữ bản cache cũ", staleFallback?.option === "Hạo Thiên Chùy");
  check("refresh lỗi chỉ cảnh báo, không ném sập quest", staleWarnings.length === 1);

  const cookies = parseCookieString("wordpress_logged_in_ab=x|y|z=; other=2", "https://e.test");
  check("cookie tách ở dấu = ĐẦU TIÊN", cookies[0]?.value === "x|y|z=", `nhận ${cookies[0]?.value}`);
  check("cookie thứ hai vẫn còn", cookies.length === 2 && cookies[1].name === "other");

  // Ca 02/08 nguyên bản: người dùng dán bản xuất JSON của desktop ({url, cookies:[…]}),
  // parser cũ trả MẢNG RỖNG không một lời phàn nàn, browser đi tay trắng, và lỗi nổi lên ở
  // tận #lobby-overview của Mê Cung. Từ nay JSON là công dân hạng nhất, và số không là lỗi.
  const desktopExport = JSON.stringify({
    url: "https://hoathinh3d.am",
    cookies: [
      { domain: ".hoathinh3d.am", name: "wordpress_logged_in_ab", value: "x|y", path: "/", expirationDate: 1786862460.3, secure: true, httpOnly: true },
      { domain: "hoathinh3d.am", name: "fakesessid", value: "s1" },
      { domain: ".google.com", name: "NID", value: "rác-site-khác" },
    ],
  });
  const fromJson = parseCookieString(desktopExport, "https://hoathinh3d.am");
  check("bản xuất JSON của desktop đọc được", fromJson.length === 2, `nhận ${fromJson.length}`);
  check(
    "cookie site KHÁC bị loại — export 'tất cả' không được tiêm rác",
    !fromJson.some((c) => c.name === "NID"),
  );
  check(
    "expirationDate → expires (giây, số nguyên)",
    fromJson[0]?.expires === 1786862460,
    `nhận ${fromJson[0]?.expires}`,
  );

  const fromArray = parseCookieString('[{"name":"a","value":"1"}]', "https://e.test");
  check("mảng JSON trần của extension cũng đọc được", fromArray.length === 1 && fromArray[0].url === "https://e.test");

  check("JSON không phải cookie → 0, để chỗ gọi từ chối to", parseCookieString('{"hello":42}', "https://e.test").length === 0);
  check("rác không định dạng → 0", parseCookieString("xin chào thế giới", "https://e.test").length === 0);
  check(
    "header 'Cookie:' copy nguyên cũng hiểu",
    parseCookieString("Cookie: a=1; b=2", "https://e.test").length === 2,
  );

  // cookies.mjs phải là module LÁ, và đây là chốt giữ cho nó ở nguyên như vậy.
  //
  // Server action của Next import nó. Ngày nào nó mọc thêm một `import` — nhất là một
  // đường dẫn ngược về engine, nơi profile.mjs đọc profile.json ngay ở thân module —
  // thì /dashboard sập TOÀN BỘ server action ngay lúc nạp module, kèm một TypeError về
  // `URL` chẳng nói gì về nguyên nhân, và CHỈ trên bản production (Turbopack thay `URL`
  // bằng bản của nó nên `fileURLToPath` của Node từ chối). Dev không bao giờ tái hiện.
  // Bỏ chú thích trước khi soát: chính tệp ấy KỂ về `readFileSync(fileURLToPath(…))` trong
  // phần giải thích vì sao nó phải sạch, nên soát trên văn bản thô là tự bắt nhầm mình.
  const leafCode = readFileSync(
    new URL("../src/lib/quest-engine/cookies.mjs", import.meta.url),
    "utf8",
  )
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  check(
    "cookies.mjs không import gì — an toàn cho bundle của Next",
    !/^\s*import\s/m.test(leafCode),
    (leafCode.match(/^\s*import\s.*$/m) ?? [])[0],
  );
  check(
    "cookies.mjs không đụng đĩa",
    !/require\(|node:fs|readFileSync|fileURLToPath/.test(leafCode),
    (leafCode.match(/require\(|node:fs|readFileSync|fileURLToPath/) ?? [])[0],
  );

  // Engine web phải hiểu MỌI loại bước và MỌI loại điều kiện mà hồ sơ dùng.
  //
  // Hồ sơ được SINH RA từ bản desktop, nên một loại mới có thể theo lệnh `export` trôi
  // sang mà không ai đụng vào mã web. Và cả hai chỗ đều nuốt cái lạ trong im lặng:
  // `executeStep` trả "bước lạ", còn `conditionProbe` rơi vào `default: return false` —
  // tức một `when` không bao giờ nổ, một `stopIf` không bao giờ chặn. Không dòng lỗi nào.
  // Chốt này bắt đúng khoảnh khắc hồ sơ vượt lên trước engine.
  const profileRaw = JSON.parse(
    readFileSync(new URL("../src/lib/quest-engine/profile.json", import.meta.url), "utf8"),
  );
  const engineSrc = readFileSync(new URL("../src/lib/quest-engine/engine.mjs", import.meta.url), "utf8");
  const scriptsSrc = readFileSync(new URL("../src/lib/quest-engine/boardScripts.mjs", import.meta.url), "utf8");

  const usedActions = new Set();
  const usedConds = new Set();
  const walkSteps = (steps) => {
    for (const s of steps ?? []) {
      if (s.action) usedActions.add(s.action);
      for (const c of [s.condition, s.when, s.until, s.stopIf]) if (c?.kind) usedConds.add(c.kind);
      if (s.steps) walkSteps(s.steps);
    }
  };
  for (const q of profileRaw.quests) walkSteps(q.steps);

  const handledActions = new Set([...engineSrc.matchAll(/case\s+"([a-zA-Z]+)"/g)].map((m) => m[1]));
  // Điều kiện được phân giải TRONG TRANG bởi conditionProbe, không phải trong engine.mjs.
  const probeBody = scriptsSrc.slice(scriptsSrc.indexOf("export function conditionProbe"));
  const handledConds = new Set([...probeBody.matchAll(/case\s+"([a-zA-Z]+)"/g)].map((m) => m[1]));

  const missingActions = [...usedActions].filter((a) => !handledActions.has(a));
  const missingConds = [...usedConds].filter((c) => !handledConds.has(c));
  check(
    `engine hiểu đủ ${usedActions.size} loại bước hồ sơ dùng`,
    missingActions.length === 0,
    missingActions.join(", "),
  );
  check(
    `conditionProbe hiểu đủ ${usedConds.size} loại điều kiện hồ sơ dùng`,
    missingConds.length === 0,
    missingConds.join(", "),
  );

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
  // Hồ sơ 42 mang thang phân giải đã bỏ nấc 5★ (đan chỉ rơi 1–4★, desktop 1.35.0): "giữ từ
  // 4 sao" giờ là block-list một mục. keepLevelOf đọc số sao NHỎ NHẤT trong giá trị nên tự
  // thích nghi — ca này ghim đúng điều đó.
  check(
    "keepStarsFrom=4 → giữ 4 sao trở lên",
    opt(luyenDan, "decompose").selectedValue === "dược khí 4 sao",
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
    "mọi quest trong hồ sơ đều khai hạng VIP/Thường rõ ràng",
    loadProfile().quests.every((q) => typeof q.requiresVip === "boolean"),
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
  const legacyVipPlan = questsForAccount(legacy, { isVip: true });
  check(
    "quest cũ thiếu trường được coi là VIP-only",
    freePlan.length === 1 && freePlan[0].requiresVip === false &&
      legacyVipPlan.length === 1 && legacyVipPlan[0].name === "cũ, thiếu trường",
    `VIP=${legacyVipPlan.map((q) => q.name).join(", ")} · thường=${freePlan.map((q) => q.name).join(", ")}`,
  );

  console.log("\nLinh phù (worker token)");

  // Một chỗ băm duy nhất — chỗ phát (issueWorkerToken) và chỗ soát (authorizeWorker) đều
  // gọi hàm này; hai bên mà tự băm riêng thì lệch nhau là khoá mọi linh sứ ngoài cửa.
  const { hashWorkerToken } = await import("../src/lib/auth/worker.ts");
  check(
    "hash ổn định — phát và soát gặp nhau",
    hashWorkerToken("lp_abc") === hashWorkerToken("lp_abc"),
  );
  check(
    "token khác → hash khác",
    hashWorkerToken("lp_abc") !== hashWorkerToken("lp_abd"),
  );
  check(
    "hash là sha-256 hex (64 ký tự) — khớp cột worker_token_hash",
    /^[0-9a-f]{64}$/.test(hashWorkerToken("lp_abc")),
    hashWorkerToken("lp_abc").slice(0, 12),
  );

  check(
    "quest không được bật thì vẫn tắt",
    profile.quests.filter((q) => q.enabled).length === 2,
  );

  // Schema 42: ngưỡng "chưa sẵn sàng sau N giây" đi cùng đường tự-nhập với kickHp.
  const idleCfg = profileForConfig(
    { ...cfg, quests: { ...cfg.quests, meCung: { ...cfg.quests.meCung, kickIdleSec: 45 } } },
    () => {},
  ).quests.find((q) => q.name === "Mê Cung");
  check(
    "kickIdleSec=45 → option kickIdle nhận '45'",
    idleCfg.options.find((o) => o.key === "kickIdle")?.selectedValue === "45",
    idleCfg.options.find((o) => o.key === "kickIdle")?.selectedValue,
  );

  // Mười nhiệm vụ một-công-tắc: bật một cái là đúng cái đó sáng đèn trong hồ sơ.
  const withDaily = profileForConfig(
    { ...cfg, quests: { ...cfg.quests, diemDanh: { enabled: true }, teLe: { enabled: true } } },
    () => {},
  );
  check(
    "bật Điểm Danh + Tế Lễ → sáng cả hai flow Điểm Danh và đúng flow theo hạng",
    withDaily.quests.filter((q) => q.name === "Điểm Danh").length === 2 &&
      withDaily.quests.filter((q) => q.name === "Điểm Danh").every((q) => q.enabled) &&
      withDaily.quests.find((q) => q.name === "Tế Lễ Tông Môn")?.enabled === true &&
      withDaily.quests.filter((q) => q.enabled).length === 5 &&
      questsForAccount(withDaily, { isVip: true }).some((q) => q.id === "diem-danh") &&
      !questsForAccount(withDaily, { isVip: true }).some((q) => q.id === "diem-danh-thuong") &&
      questsForAccount(withDaily, { isVip: false }).some((q) => q.id === "diem-danh-thuong") &&
      !questsForAccount(withDaily, { isVip: false }).some((q) => q.id === "diem-danh"),
    withDaily.quests.filter((q) => q.enabled).map((q) => q.name).join(" · "),
  );
  const { loadProfile: loadProfileForSchema } = await import("../src/lib/quest-engine/profile.mjs");
  check(
    "hồ sơ đang ở schema 43",
    loadProfileForSchema().schemaVersion === 43,
    String(loadProfileForSchema().schemaVersion),
  );

  // --- kiểm trên trang thật ---------------------------------------------------------
  const server = createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    const path = new URL(req.url ?? "/", "http://fixture.test").pathname.replace(/\/$/, "") || "/";
    if (path === "/diem-danh") res.end(FREE_CHECKIN_PAGE);
    else if (path === "/nhiem-vu-hang-ngay") res.end(FREE_HUB_PAGE);
    else if (path === "/phuc-loi-duong") res.end(FREE_WELFARE_PAGE);
    else if (path === "/vong-quay-phuc-van") res.end(FREE_WHEEL_PAGE);
    else res.end(PAGE);
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
    const quizEngine = createQuestEngine({ log, quiz: referenceQuiz });
    const runQuiz = (quest) => quizEngine.run(session, { dailyQuestPath: "/" }, quest);

    console.log("\nBa flow tài khoản thường từ recording 02/08");
    const exportedProfile = loadProfileForSchema();

    const checkinFree = exportedProfile.quests.find((q) => q.id === "diem-danh-thuong");
    const checkinResult = await run(checkinFree);
    check("Điểm Danh mở trang riêng và chờ server đổi nhãn", checkinResult.outcome === "completed", checkinResult.outcome);
    check("Điểm Danh đã phát claim thật", (await page.locator("#checkInButton").getAttribute("data-claimed")) === "1");

    const welfareFree = exportedProfile.quests.find((q) => q.id === "phuc-loi-duong-thuong");
    const welfareResult = await run(welfareFree);
    check("Phúc Lợi Đường nhận đúng một rương mỗi lượt", welfareResult.outcome === "completed", welfareResult.outcome);
    check(
      "Phúc Lợi Đường đọc lại cooldown 30 phút",
      welfareResult.cooldownSeconds === 1800 &&
        (await page.locator("#countdown-timer").getAttribute("data-claimed")) === "1",
      String(welfareResult.cooldownSeconds),
    );

    const wheelFree = exportedProfile.quests.find((q) => q.id === "vong-quay-phuc-van-thuong");
    const wheelResult = await run(wheelFree);
    check("Vòng Quay đóng overlay rồi quay tới hết lượt", wheelResult.outcome === "completed", wheelResult.outcome);
    check(
      "Vòng Quay tiêu hết hai lượt fixture",
      (await page.locator("#spinButton").getAttribute("data-spins")) === "2" &&
        (await page.locator("#userTurns").textContent()) === "0",
    );

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

    console.log("\nVấn Đáp trên trang sống");
    infos.length = 0;
    const quizResult = await runQuiz(questOf([
      {
        action: "answerQuiz",
        selector: "#question",
        optionsSelector: "#quiz-fixture .quiz-option",
        timeoutMs: 5000,
      },
    ]));
    check("engine dùng danh sách và hoàn tất bước answerQuiz", quizResult.outcome === "completed", quizResult.outcome);
    check(
      "đáp án đi qua click Playwright thật và được trang ghi nhận",
      (await page.evaluate(() => document.getElementById("quiz-fixture").dataset.chosen)) === "Hạo Thiên Chùy",
    );
    check(
      "nhật ký flow ghi nguồn danh sách tham khảo",
      infos.some((message) => message.includes("danh sách tham khảo")),
      infos.join(" / "),
    );

    await page.evaluate(() => {
      document.getElementById("question").textContent = "Câu chưa hề có trong danh sách?";
      delete document.getElementById("quiz-fixture").dataset.chosen;
      document.querySelectorAll("#quiz-fixture .quiz-option").forEach((item) => item.classList.remove("correct"));
    });
    const unknownQuiz = await runQuiz(questOf([
      {
        action: "answerQuiz",
        selector: "#question",
        optionsSelector: "#quiz-fixture .quiz-option",
        timeoutMs: 5000,
      },
    ]));
    check(
      "câu lạ kết thúc an toàn để giữ lượt",
      unknownQuiz.outcome === "alreadyDone" && unknownQuiz.message.includes("chưa biết đáp án"),
      `${unknownQuiz.outcome}: ${unknownQuiz.message}`,
    );
    check(
      "câu lạ không bấm đại lựa chọn nào",
      (await page.evaluate(() => document.getElementById("quiz-fixture").dataset.chosen)) === undefined,
    );

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

    console.log("\nwaitForCondition realtime");

    // Ca ăn tiền: một trạng thái chỉ LOÉ 150ms. Vòng poll 300ms cũ lấy mẫu trước và sau cú
    // loé rồi kết luận "không có gì" — chính xác kiểu sự kiện mà Mê Cung không được phép
    // hụt. MutationObserver được gọi ngay tại mutation nên phải bắt được.
    await page.evaluate(() => {
      const el = document.createElement("div");
      el.id = "flash";
      el.style.display = "none";
      el.textContent = "loé";
      document.body.appendChild(el);
      setTimeout(() => { el.style.display = "block"; }, 400);
      setTimeout(() => { el.style.display = "none"; }, 550);
    });
    const flash = await run(questOf([
      { action: "waitForCondition", timeoutMs: 3000,
        condition: { selector: "#flash", kind: "visible" } },
    ]));
    check("trạng thái loé 150ms được bắt", flash.outcome === "completed", flash.outcome);

    // Thức dậy ngay tại mutation, không phải ở nhịp poll kế: phần tử hiện ở t=600ms, cả
    // bước phải xong quanh đó chứ không phải cộng thêm một nhịp lấy mẫu.
    await page.evaluate(() => {
      const el = document.createElement("div");
      el.id = "late";
      el.style.display = "none";
      el.textContent = "muộn";
      document.body.appendChild(el);
      setTimeout(() => { el.style.display = "block"; }, 600);
    });
    const t0 = Date.now();
    const late = await run(questOf([
      { action: "waitForCondition", timeoutMs: 5000,
        condition: { selector: "#late", kind: "visible" } },
    ]));
    const lateMs = Date.now() - t0;
    check("phần tử đến muộn vẫn được chờ tới nơi", late.outcome === "completed", late.outcome);
    check("và thức dậy sát sự kiện (đo được " + lateMs + "ms)", lateMs < 1600, `${lateMs}ms`);

    const never = await run(questOf([
      { action: "waitForCondition", timeoutMs: 900,
        condition: { selector: "#khong-bao-gio", kind: "visible" } },
    ]));
    check("điều kiện không bao giờ đúng vẫn ra timeout có tên",
      never.outcome === "failed" && /Hết .*s chờ/.test(never.message ?? ""), never.message);

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
