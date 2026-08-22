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

import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createQuestEngine, enabledQuestsInOrder, questsForAccount } from "../src/lib/quest-engine/engine.mjs";
import { createSession } from "../src/lib/quest-engine/session.mjs";
import { parseCookieString, runCycle } from "../src/lib/quest-engine/runCycle.mjs";
// Nhập thẳng từ module LÁ: `detectWordPressUser` chỉ biết định dạng cookie, không đi qua engine.
import { DEFAULT_GAME_BASE_URL, detectWordPressUser } from "../src/lib/quest-engine/cookies.mjs";
import {
  _observeGate,
  _resetGate,
  acquireQuestSlot,
  isDedicatedPageQuest,
} from "../src/lib/quest-engine/questGate.mjs";
import { profileDirForJob } from "../src/lib/quest-engine/browserProfile.mjs";
import {
  COMPLETION_ENDS_DAY_QUEST_IDS,
  DAILY_QUOTA_QUEST_IDS,
  PEER_GATED_QUEST_IDS,
  peersDoneForQuota,
  reachedDailyQuota,
} from "../src/lib/quest-engine/dailyQuota.mjs";
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
  <!-- Dấu "đã đăng nhập" mà readinessProbe tìm. Rỗng và không mang chữ nào: mấy ca dưới đây
       hỏi cả trang bằng textMatches, một chữ thừa ở đây là một ca khác đổi kết quả. -->
  <div id="wpadminbar"></div>
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
// 02/08. Chúng không mock Playwright: profile schema 44 vẫn điều khiển Chromium thật.
const FREE_CHECKIN_PAGE = `<!doctype html><html lang="vi"><meta charset="utf-8">
<button id="checkInButton">Điểm Danh</button>
<script>checkInButton.onclick=()=>setTimeout(()=>{checkInButton.textContent='Đã Điểm Danh';checkInButton.dataset.claimed='1'},30)</script>`;

// Cùng trang ấy ở trạng thái SITE ĐÃ NHỚ: ghé lại trong ngày là nút render sẵn chữ "Đã Điểm
// Danh". Phải là một trang riêng chứ không phải trạng thái còn sót của ca trước — ca kia kiểm
// đường bấm được, và hai ca dùng chung một trạng thái là hai ca ràng buộc nhau vô cớ.
const FREE_CHECKIN_DONE_PAGE = `<!doctype html><html lang="vi"><meta charset="utf-8">
<button id="checkInButton">Đã Điểm Danh</button>`;

// Chữ "Thí Luyện" hiện THÀNH VĂN BẢN chứ không chỉ nằm trong href: vipProbe đọc innerText và
// trả null chừng nào chưa thấy tên một nhiệm vụ nào — null nghĩa là "hub chưa render xong",
// nên một hub thiếu chữ khiến runCycle poll đủ 20 giây rồi mới bỏ cuộc.
/**
 * Hàng quest trên hub của tài khoản THƯỜNG.
 *
 * Hàng Bí Cảnh chép NGUYÊN VĂN từ `dom/01-load.html` của bản ghi
 * bi-canh-tong-mon-20260818-013136 — kể cả cái `onclick="nvOpenHistory(…);return false;"` khiến
 * href không bao giờ được đi tới, vì flow không bấm vào nó, chỉ ĐỌC sự có mặt của nó. Và khi hết
 * lượt, hàng đổi sang đúng hình dạng mà bản ghi chụp được ở hàng Tế Lễ đã xong: `.nv-quest done`
 * với `<span class="btn-done-label">`, KHÔNG còn thẻ `a.btn-go` nào.
 */
const freeHubRows = (biCanhSpent) => `<div class="nv-quest"><a class="btn-go" onclick="location.href='/phuc-loi-duong'">Làm Ngay ›</a></div>
<div class="nv-quest"><span>Thí Luyện Tông Môn</span><a class="btn-go" href="/thi-luyen-tong-mon-hh3d/?nv_embed=1">Làm Ngay ›</a></div>
${biCanhSpent
    ? `<div class="nv-quest done "><div class="nv-qb"><h4>Bí Cảnh Tông Môn</h4><div class="nv-prog-row"><span class="nv-prog-txt">5/5</span></div></div><div class="nv-quest-action"><span class="btn-done-label">Xong</span></div></div>`
    : `<div class="nv-quest "><div class="nv-qb"><h4>Bí Cảnh Tông Môn</h4><div class="nv-prog-row"><span class="nv-prog-txt">0/5</span></div></div><div class="nv-quest-action"><a href="/bi-canh-tong-mon/" class="btn-go" onclick="nvOpenHistory('/bi-canh-tong-mon/','⚔ Bí Cảnh Tông Môn');return false;">Đến Đánh ›</a></div></div>`}
<nav id="menu-menu"><li><a href="/bi-canh-tong-mon"><span>Bí Cảnh</span></a></li></nav>`;

/**
 * Hub nhiệm vụ ngày, kèm mục「Phần Thưởng Hoạt Động」— dựng NGUYÊN VĂN từ bản ghi
 * phan-thuong-hoat-dong-20260817-022120: thẻ mở lấy từ `dom/01-load.html`, thẻ đã nhận từ
 * `dom/06-click.html`, hộp thưởng từ `dom/03-click.html`. Ba điều fixture này cố ý giữ:
 *
 *   • **Hai rương cho HAI tiêu đề hộp khác nhau** —「Nhận Thưởng Thành Công!」(mốc 75%) và
 *     「Hoàn Thành Xuất Sắc!」(mốc 100%), đọc được ở video 00:56 và 01:04. Đây là thứ chặn một
 *     phép kiểm đi so tiêu đề: rương thứ hai sẽ bị khai là hỏng.
 *   • **Trang dùng CHUNG một hộp cho cả tin mừng lẫn tin dữ**, phân biệt bằng class `.nv-err`
 *     (CSS của trang khai đủ `.nv-err`/`.nv-warn`) — nên fixture bật/tắt được bằng `refuse`.
 *   • **Nút đi qua「Đang xử lý...」rồi mới bị GỠ**, và thẻ đổi sang `.claimed` ngay lúc AJAX về
 *     (bản ghi: nút biến mất ở cùng nhịp hộp hiện ra, chứ không đợi bấm Đóng).
 *
 * Chữ trong `.nv-locked-txt` là chỗ DUY NHẤT không có trong bản ghi — hôm ấy cả hai rương đều
 * đã mở. Class thì có thật (CSS của trang), và script không đọc chữ ấy, chỉ đọc class.
 */
const hubPage = (pt) => `<!doctype html><html lang="vi"><meta charset="utf-8">
<style>
  #nv-modal-overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,.6)}
  #nv-modal-overlay.nv-open{display:block}
  #nv-modal-box{width:320px;margin:80px auto;background:#161a24;padding:20px}
</style>
${freeHubRows(pt.biCanhSpent === true)}
<div class="nv-overview"><div class="nv-ring-wrap"><div class="nv-ring-label${pt.ring === "100%" ? " full" : ""}">${pt.ring}</div></div></div>
${pt.section
    ? `<p class="nv-sec">Phần Thưởng Hoạt Động</p>
<div class="nv-rewards">${pt.cards
        .map((card, i) => {
          const inner = `<div class="nv-rcard-pct">${card.pct}</div>`
            + `<img id="chest-pt-${i + 1}" class="nv-chest" alt="Rương ${i + 1}">`
            + `<div class="nv-rcard-items">${card.lines.map((l) => `${l[0]} ${l[1].replace("+", "")} ${l[2]}`).join("<br>")}</div>`;
          if (card.state === "claimed") {
            return `<div class="nv-rcard claimed" id="rc${i + 1}">${inner}<div class="nv-claimed-txt">Đã nhận</div></div>`;
          }
          if (card.state === "locked") {
            return `<div class="nv-rcard locked" id="rc${i + 1}">${inner}<div class="nv-locked-txt">Chưa đạt mốc</div></div>`;
          }
          return `<div class="nv-rcard unlocked" id="rc${i + 1}">${inner}<button class="nv-claim-btn" id="btn${i + 1}">Nhận Thưởng</button></div>`;
        })
        .join("")}</div>`
    : ""}
<div id="nv-modal-overlay" class=""><div id="nv-modal-box"><div id="nv-modal-bar"></div><div id="nv-modal-inner">
  <div id="nv-modal-icon">🎁</div><h3 id="nv-modal-title"></h3><div id="nv-modal-body"></div>
  <button id="nv-modal-btn">Đóng</button>
</div></div></div>
<script>
const PT = ${JSON.stringify({ cards: pt.cards, refuse: pt.refuse })};
const overlay = document.getElementById('nv-modal-overlay');
const openModal = (kind, title, lines) => {
  overlay.className = 'nv-open' + (kind ? ' ' + kind : '');
  document.getElementById('nv-modal-title').textContent = title;
  document.getElementById('nv-modal-body').innerHTML = '<div class="nv-reward-lines">' + lines.map((l) =>
    '<div class="nv-reward-line nv-rl-gold"><span class="nv-rl-icon">' + l[0] + '</span>'
    + '<span class="nv-rl-text"><span class="nv-rl-val">' + l[1] + '</span>' + l[2] + '</span></div>').join('') + '</div>';
};
document.getElementById('nv-modal-btn').onclick = () => { overlay.className = ''; document.body.dataset.closed = String((Number(document.body.dataset.closed) || 0) + 1); };
for (const [i, card] of PT.cards.entries()) {
  const btn = document.getElementById('btn' + (i + 1));
  if (!btn) continue;
  btn.onclick = () => {
    btn.disabled = true; btn.textContent = 'Đang xử lý...';
    fetch('/pt-claim?stage=' + (i + 1));
    setTimeout(() => {
      if (PT.refuse) {
        btn.disabled = false; btn.textContent = 'Nhận Thưởng';
        openModal('nv-err', 'Chưa đủ điều kiện nhận rương này', []);
        return;
      }
      const rc = document.getElementById('rc' + (i + 1));
      rc.className = 'nv-rcard claimed';
      btn.remove();
      const done = document.createElement('div');
      done.className = 'nv-claimed-txt'; done.textContent = 'Đã nhận';
      rc.appendChild(done);
      openModal('', card.title, card.lines);
    }, 60);
  };
}
</script>`;

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

/**
 * Trang Bí Cảnh Tông Môn, dựng theo bản ghi bi-canh-tong-mon-20260818-013136.
 *
 * BỐN điều của trang thật mà fixture này cố ý giữ, vì bỏ cái nào là mở đường cho một lỗi thật
 * đi lọt:
 *
 *   • **Vỏ trang KHÔNG có nút nào cả.** Thân HTML server giao (14KB) chỉ có khung + một khối
 *     JSON; `boss-system.js` vẽ toàn bộ điều khiển sau đó. Một fixture giao sẵn nút là fixture
 *     xoá mất chính cái cửa sổ mà bước `waitForSelector` sinh ra để chờ.
 *   • **Trạng thái cooldown tới MUỘN HƠN nút**, qua `POST /wp-json/tong-mon/v1/check-attack-cooldown`
 *     (bản ghi: `{"can_attack":true,"cooldown_interval":420}`). Nên trong khoảng giữa, nút đã
 *     hiện với chữ "KHIÊU CHIẾN" mà sự thật chưa về — đúng cái bẫy đã cắn Hoang Vực.
 *   • **Chữ trên nút bị CSS viết hoa** (`text-transform`), nên `innerText` trả "CÒN 6:57" chứ
 *     không phải "Còn 6:57" như JS của trang ghi vào. Fixture giữ nguyên cả hai vế để phép so
 *     chữ phải đi qua đúng lớp gấp dấu mà engine dùng.
 *   • **Nút KHIÊU CHIẾN đổi chữ trong khi modal VẪN ĐANG MỞ** (bấm 18:32:08 → "CÒN 6:57" lúc
 *     18:32:10,6). Nhân chứng của flow đứng ở đó, nên fixture phải giữ đúng thứ tự ấy.
 *
 * Nhân chứng của FIXTURE (site không có): `data-attacked` / `data-refused` trên body.
 *
 * @param broken  nút Tấn Công nhận cú bấm rồi KHÔNG làm gì — ca "cú bấm rơi vào hư không"
 * @param state   "ready" · "cooldown" (còn lượt, chưa tới giờ) · "spent" (hết 5 lượt hôm nay)
 * @param lastTurn  chỉ còn ĐÚNG MỘT lượt: đánh xong thì nút nhảy sang "Hết lượt hôm nay" chứ
 *   không phải đồng hồ — nửa còn lại của điều kiện nhân chứng `":|hết lượt"`
 * @param paintMs  bao lâu thì boss-system.js vẽ xong khối điều khiển
 * @param stateMs  bao lâu thì câu trả lời cooldown về (luôn SAU paintMs)
 */
const biCanhPage = ({ broken = false, state = "ready", lastTurn = false, paintMs = 120, stateMs = 400 } = {}) => `<!doctype html><html lang="vi"><meta charset="utf-8">
<style>#challenge-boss-btn{text-transform:uppercase}</style>
<a href="javascript:void(0)" class="fixed-back-btn"><span>Trở Lại</span></a>
<div class="boss-game-container">
  <div class="game-title"><h1>Bí Cảnh Tông Môn</h1></div>
  <div class="boss-info"><div id="boss-slot"></div></div>
</div>
<div id="attack-modal" style="display:none">
  <button id="attack-boss-btn">Tấn Công</button><button id="back-button">Trở lại</button>
</div>
<script>
const STATE = ${JSON.stringify(state)};
const BROKEN = ${JSON.stringify(broken)};
// 1. boss-system.js vẽ khối điều khiển — LUÔN mở, luôn "KHIÊU CHIẾN", vì lúc này nó chưa hỏi ai.
setTimeout(() => {
  document.getElementById('boss-slot').innerHTML =
    '<div id="boss-timer-text">88:28:39</div>'
    + '<div class="boss-hp-section"><div class="hp-percentage">69.84%</div></div>'
    + '<button id="challenge-boss-btn" class="challenge-btn">KHIÊU CHIẾN</button>'
    + '<div class="attack-info-display"><span>Lượt đánh còn lại: <span class="attack-count">'
    + (STATE === 'spent' ? '0' : ${JSON.stringify(lastTurn ? "1" : "5")}) + '</span></span></div>';
}, ${paintMs});
// 2. …rồi /check-attack-cooldown trả lời, và câu trả lời chỉ biết LẤY ĐI lời mời.
const setCooldownText = (mmss) => {
  const btn = document.getElementById('challenge-boss-btn');
  btn.disabled = true; btn.classList.add('disabled');
  btn.innerHTML = '<i class="fas fa-hourglass-half"></i> Còn ' + mmss;
};
setTimeout(() => {
  const btn = document.getElementById('challenge-boss-btn');
  if (!btn) return;
  fetch('/btm-cooldown');
  if (STATE === 'cooldown') setCooldownText('6:52');
  else if (STATE === 'spent') {
    btn.disabled = true; btn.classList.add('disabled');
    btn.innerHTML = '<i class="fas fa-ban"></i> Hết lượt hôm nay';
  }
}, ${stateMs});
document.addEventListener('click', (e) => {
  const t = e.target;
  if (t.id === 'challenge-boss-btn') {
    if (t.disabled) { document.body.dataset.refused = '1'; return; }
    setTimeout(() => { document.getElementById('attack-modal').style.display = 'block'; }, 150);
  } else if (t.id === 'attack-boss-btn') {
    if (BROKEN) return; // site nuốt cú bấm: không POST, không đổi gì
    fetch('/btm-attack');
    t.disabled = true;
    document.body.dataset.attacked = String(+(document.body.dataset.attacked || 0) + 1);
    const left = document.querySelector('.attack-count');
    const remaining = Math.max(0, +left.textContent - 1);
    left.textContent = String(remaining);
    // Nút KHIÊU CHIẾN đổi chữ SAU đó một nhịp, và modal vẫn đang mở — đúng nhịp bản ghi.
    setTimeout(() => {
      if (remaining === 0) {
        const btn = document.getElementById('challenge-boss-btn');
        btn.disabled = true; btn.classList.add('disabled');
        btn.innerHTML = '<i class="fas fa-ban"></i> Hết lượt hôm nay';
      } else setCooldownText('6:57');
    }, 250);
  } else if (t.id === 'back-button') {
    document.getElementById('attack-modal').style.display = 'none';
  }
});
</script>`;

// Trang thí luyện theo recording 05/08: một rương (#chestImage) + đồng hồ chung
// #countdown-timer; mở rương lúc 00:00 là đồng hồ nhảy 29:59 trong ~2s.
const FREE_TRIAL_PAGE = `<!doctype html><html lang="vi"><meta charset="utf-8">
<div id="countdown-timer">00:00</div>
<img id="chestImage" class="chest-close" alt="Rương thí luyện" style="width:60px;height:60px">
<script>const timer=document.getElementById('countdown-timer');
chestImage.onclick=()=>{if(timer.textContent!=='00:00')return;
  setTimeout(()=>{timer.textContent='29:59';timer.dataset.claimed='1'},30)}</script>`;

// Trang tế lễ theo bản ghi 13/08 (te-le-tong-mon-20260813-001731), markup chép từ `dom/*.html`.
// Ba chỗ CỐ Ý giữ đúng như trang thật, vì cả ba đều đủ sức giấu một lỗi thật:
//
//   • Hộp xác nhận là component của CHÍNH SITE (`#hh3d-confirm-layer`), không phải SweetAlert2.
//     Trang đã gỡ swal2 hẳn — 0 lần xuất hiện trong toàn bộ HTML — nên một fixture còn dựng
//     `.swal2-confirm` là fixture tự bịa ra một trang không tồn tại, và bộ chạy thử sẽ xanh
//     mướt trong khi production chờ hết giờ rồi hỏng. Đó đúng là bài học của Luyện Đan 12/08.
//   • Hộp ấy được DỰNG RA lúc bấm và GỠ KHỎI DOM lúc đóng, không phải ẩn đi — bản chụp trước
//     và sau cú confirm đều không có phần tử nào tên vậy.
//   • Nút sau lượt THÀNH CÔNG vẫn mang `data-done="0"`: trang chỉ đổi chữ, `disabled` và class.
//     Cái tên `data-done` mời người ta gác cửa bằng nó; bản chụp 04-click nói rằng đừng.
//
// `data-offered` / `data-cancelled` là NHÂN CHỨNG CỦA FIXTURE, không phải markup của site —
// chúng chỉ để bài kiểm hỏi "đã đi qua nhánh nào", và hồ sơ không đọc chúng bao giờ.
//
// Là HÀM vì site thật nhớ lễ PHÍA SERVER: lần ghé sau, trang render sẵn trạng thái đã tế —
// đó chính là điều kiện StopIf của flow, và bài "lần hai phải dừng" kiểm đúng nó. Trạng thái
// render-sẵn ấy mang `data-done="1"` theo đúng CSS của trang (`[data-done="1"]` cũng bị làm
// xám như `[disabled]`); đó là suy ra từ CSS chứ không phải đo được, và không ảnh hưởng gì —
// cửa dừng đọc CHỮ, thứ duy nhất đã thấy nói thật ở cả hai trạng thái.
const freeSacrificePage = (offered) => offered
  ? `<!doctype html><html lang="vi"><meta charset="utf-8">
<button id="te-le-button" class="btn group-button" data-done="1" disabled><i class="fas fa-times"></i> Đã Tế Lễ</button>`
  : `<!doctype html><html lang="vi"><meta charset="utf-8">
<button id="te-le-button" class="btn btn-danger group-button" data-done="0"><i class="fas fa-praying-hands"></i> Tế Lễ</button>
<script>const btn=document.getElementById('te-le-button');
const LAYER='<div id="hh3d-confirm-layer" role="alertdialog" aria-modal="true" style="z-index:200000">'
  +'<div class="hh3d-confirm__backdrop" aria-hidden="true"></div><div class="hh3d-confirm__panel">'
  +'<div class="hh3d-confirm__head"><h2 class="hh3d-confirm__title" id="hh3d-confirm-title">Xác nhận tế lễ</h2></div>'
  +'<div class="hh3d-confirm__body"><p class="hh3d-confirm__text" id="hh3d-confirm-text">Đạo hữu chắc chắn dùng 10 Tinh Thạch tế lễ cho Tông Môn?</p></div>'
  +'<div class="hh3d-confirm__actions"><button type="button" class="hh3d-confirm__btn hh3d-confirm__btn--cancel">Hủy</button>'
  +'<button type="button" class="hh3d-confirm__btn hh3d-confirm__btn--confirm">Tế Lễ</button></div></div></div>';
const close=()=>{const l=document.getElementById('hh3d-confirm-layer');if(l)l.remove()};
btn.onclick=()=>{if(btn.disabled)return;document.body.insertAdjacentHTML('beforeend',LAYER);
  document.querySelector('.hh3d-confirm__btn--cancel').onclick=()=>{close();btn.dataset.cancelled='1'};
  document.querySelector('.hh3d-confirm__btn--confirm').onclick=()=>{close();
    fetch('/te-le-offered');
    setTimeout(()=>{btn.innerHTML='<i class="fas fa-times"></i> Đã Tế Lễ';btn.disabled=true;
      btn.className='btn group-button';btn.dataset.offered='1'},40)}}</script>`;

// Trang Khoáng Mạch theo bản ghi 14/08 (khoang-mach-20260814-133812). KHÁC mọi fixture trước:
// trang thật chạy trong IFRAME của hub (?nv_embed=1) nên dom/*.html của bản ghi KHÔNG chứa nó,
// và body HTML trong network.json bị cắt ở 32KB đầu (toàn <head>). Markup dưới đây vì thế dựng
// từ hai nguồn chứng cứ còn lại: selector THẬT của 64 cú click trong steps.json (recorder xuyên
// được iframe) + 83 control từ các lượt quét trạng thái — không có dòng nào bịa từ trí nhớ.
//
//   • Trang này CÒN SweetAlert2 — ngược với trang tế lễ. Ba hộp xác nhận đã ghi đều là
//     `.swal2-container … button.swal2-confirm` (click#47/#236/#246). Đừng "đồng bộ cho gọn"
//     sang #hh3d-confirm-layer: hai trang, hai họ hộp, và fixture phải theo trang của NÓ.
//   • Dòng của MÌNH trong sổ mỏ nhận diện bằng cặp class chỉ nó mới có: `button.chua-dat`
//     (đang đào, disabled) ↔ `button.claim-reward` (chữ「Nhận Thưởng」khi chín, và VẪN class
//     ấy với chữ「Đã nhận (Xs)」sau khi nhận — nên phép nhận diện phải hỏi thêm CHỮ).
//   • Dòng mình cố ý nằm TRANG 2 của sổ (bản ghi: sổ 2-3 trang, vị trí dòng mình đổi theo
//     vai) — bắt flow phải lật trang thật chứ không ăn may trang đầu.
//   • Trần Tu Vi / Tinh Thạch là SỐ do server render trên trang; đầy cả hai = hết ngày.
//
// Nhân chứng của fixture (site không có): data-entered / data-bought / data-seized /
// data-claimed / data-refused trên <body> — bài kiểm hỏi「đã đi nhánh nào, có cú bấm nào bị
// server từ chối không」.
const khoangMachPage = (km) => {
  const lists = {
    1: { cls: "class-khoang-vang", names: ["Thiên", "Địa", "Hồng Hoang"] },
    2: { cls: "class-khoang-bac", names: ["Âm Minh Chi Địa", "Thông Thiên Kiếm Phái", "Bất Diệt Sơn"] },
    3: { cls: "class-khoang-dong", names: ["Bách Đoạn Sơn", "Thạch Thôn", "Hỏa Quốc"] },
  };
  return `<!doctype html><html lang="vi"><meta charset="utf-8">
<div id="wrapper">
${km.hideStats
    ? `<div id="mine-stats-plain">Lượt tấn công: ${km.attacksUsed} / 3 · Tu Vi: ${km.tuVi} / ${km.tuViCap} · Tinh Thạch: ${km.tinhThach} / ${km.tinhThachCap}</div>`
    : `<div class="stats-container">
  <div class="stat-item stat-attack"><i class="fas fa-bolt"></i> Lượt tấn công: ${km.attacksUsed} / 3</div>
  <div class="stat-item stat-tuvi"><i class="fas fa-fist-raised"></i> Tu Vi: ${km.tuVi} / ${km.tuViCap}</div>
  <div class="stat-item stat-tinhthach"><img alt="Tinh Thạch"> Tinh Thạch: ${km.tinhThach} / ${km.tinhThachCap}</div>
  <div class="stat-item stat-defeat"><i class="fas fa-skull-crossbones"></i> Đã bị sát hại: 5 lần</div>
  <div class="stat-item stat-satkhi"><i class="fas fa-fire"></i> Sát Khí: 0 / 7</div>
</div>`}
<div class="mine-buttons">
  <button class="mine-type-button${km.type === 1 ? " active" : ""}">Thượng</button>
  <button class="mine-type-button${km.type === 2 ? " active" : ""}">Trung</button>
  <button class="mine-type-button${km.type === 3 ? " active" : ""}">Hạ (Tân Thủ)</button>
</div>
<button id="shopButton">TIỆM</button>
<div id="shop-container" style="display:none">
  <div class="shop-item"><div class="shop-item-content">Ẩn Thân Phù<button class="shop-item-button">Mua Ngay</button></div></div>
  <div class="shop-item"><div class="shop-item-content">Bát Quái Trận Đồ<button class="shop-item-button">Mua Ngay</button></div></div>
  <div class="shop-item"><div class="shop-item-content">Linh Quang Phù<button class="shop-item-button">Mua Ngay</button></div></div>
  <div class="shop-item"><div class="shop-item-content">Hộ Thân Phù<button class="shop-item-button">Mua Ngay</button></div></div>
  <div class="shop-item"><div class="shop-item-content">Linh Thạch Túi<button class="shop-item-button">Mua Ngay</button></div></div>
  <div class="shop-item"><div class="shop-item-content">Trận Kỳ<button class="shop-item-button">Mua Ngay</button></div></div>
</div>
<div id="mine-list"></div>
<!-- Lời xác nhận nằm trong một THUỘC TÍNH, không phải trong mã script: body.textContent gộp cả
     mã nguồn của mọi <script> trong trang, nên một literal 'Đã đoạt thành công…' trong script sẽ
     làm phép đọc DOM xanh ở MỌI ca — fixture đời trước đã xanh nhầm đúng kiểu ấy, và ca「trang
     nói câu lạ」là chỗ nó lộ ra. data-* thì textContent không đọc tới. -->
<div id="km-won-text" data-text="Đã đoạt thành công quyền chủ mỏ." style="display:none"></div>
<div id="user-modal" style="display:none"><div class="modal-content">
  <div id="bonus-display">Ẩn Thân Phù: 0/5 · Thưởng thêm: - Tu Vi: ${km.hideBonus ? "<span>—</span>" : `<span id="tuvi-bonus-percentage">${km.bonus}%</span>`} - Tinh Thạch: <span id="tinhthach-bonus-percentage">20%</span> - Bát Quái Trận Đồ</div>
  <div id="user-list"></div>
  <button id="prev-btn">← Lùi</button> <span id="page-indicator"></span> <button id="next-btn">Tiến →</button>
  <button id="reload-btn"></button> <button id="close-btn">Đóng</button>
</div></div>
</div>
<script>
const KM = ${JSON.stringify({ type: km.type, inMine: km.inMine, minedMin: km.minedMin, maxed: km.maxed, claimed: km.claimedJustNow, owner: km.owner, attacksUsed: km.attacksUsed, bonus: km.bonus, says: km.seizeSays ?? "net" })};
const LISTS = ${JSON.stringify(lists)};
let page = 1;
const swal = (text, confirmLabel, onYes) => {
  const c = document.createElement('div');
  c.className = 'swal2-container swal2-center';
  c.innerHTML = '<div class="swal2-popup swal2-modal"><h2 class="swal2-title">Xác nhận</h2>'
    + '<div class="swal2-html-container">' + text + '</div>'
    + '<div class="swal2-actions"><button type="button" class="swal2-confirm swal2-styled">' + confirmLabel + '</button>'
    + '<button type="button" class="swal2-cancel swal2-styled">Không</button></div></div>';
  document.body.append(c);
  c.querySelector('.swal2-cancel').onclick = () => { c.remove(); document.body.dataset.cancelled = '1'; };
  c.querySelector('.swal2-confirm').onclick = () => { c.remove(); onYes(); };
};
const toast = (text) => { const t = document.createElement('div'); t.className = 'km-toast'; t.textContent = text; document.body.append(t); setTimeout(() => t.remove(), 3000); };
const mineCard = (name, cls, mine) => {
  const btn = mine
    ? '<button class="leave-mine">Rời Khỏi</button>'
    : '<button class="enter-mine">Vào Ngay</button>';
  return '<div class="mine ' + cls + '"><div class="mine-image"><img alt="' + name + '"></div>'
    + '<div class="mine-name">' + name + '</div><div class="group-info"><p><span>Lạc Vân Tông</span></p></div>'
    + '<div class="mine-info"><span>21/50</span></div>' + btn + '</div>';
};
const renderList = () => {
  const l = LISTS[KM.type];
  document.getElementById('mine-list').innerHTML = l.names
    .map((n) => mineCard(n, l.cls, KM.inMine && n === 'Thông Thiên Kiếm Phái' && KM.type === 2))
    .join('');
  for (const b of document.querySelectorAll('#mine-list button.enter-mine')) b.onclick = enterMine;
  for (const img of document.querySelectorAll('#mine-list .mine-image img')) img.onclick = openModal;
};
const row = (name, timeText, buttonHtml, crown) =>
  '<div class="user-row user-row-' + name.replace(/\\W+/g, '').toLowerCase() + '">'
  + '<div class="avatar-km">' + (crown ? '👑' : '') + '</div>'
  + '<div class="user-info"><b>' + name + '</b> Lạc Vân Tông <div class="group-info-km"><p>Khai thác: '
  + timeText + '</p>' + buttonHtml + '</div></div></div>';
const ownRow = () => {
  if (KM.claimed) return row('BaoTest', '2 giây', '<button class="claim-reward" disabled>Đã nhận (2s)</button>', KM.owner);
  if (KM.maxed) return row('BaoTest', 'Đạt tối đa', '<button class="claim-reward">Nhận Thưởng</button>', KM.owner);
  return row('BaoTest', KM.minedMin + ' phút', '<button class="chua-dat" disabled>Chưa đạt</button>', KM.owner);
};
const renderModal = () => {
  const hostBtn = KM.owner ? '<button disabled>Đồng Môn</button>' : '<button class="doat-mo-btn">Đoạt Mỏ</button>';
  const pages = KM.owner
    ? [[ownRow(), row('babe just u', '4 phút', '<button disabled>Đồng Môn</button>', false)],
       [row('CHIM CHAU PHI', '9 phút', '<button disabled>Đồng Môn</button>', false)]]
    : [[row('babe just u', '4 phút', hostBtn, true), row('CHIM CHAU PHI', '9 phút', '<button disabled>Đồng Môn</button>', false)],
       [ownRow(), row('Lam Hy Nguyệt', '1 phút', '<button disabled>Đồng Môn</button>', false)]];
  if (page > pages.length) page = pages.length;
  document.getElementById('user-list').innerHTML = pages[page - 1].join('');
  document.getElementById('page-indicator').textContent = 'Trang ' + page + ' / ' + pages.length;
  document.getElementById('next-btn').disabled = page >= pages.length;
  document.getElementById('prev-btn').disabled = page <= 1;
  const claim = document.querySelector('#user-list button.claim-reward:not([disabled])');
  if (claim) claim.onclick = () => {
    if (!KM.maxed) { document.body.dataset.refused = 'claim'; return; }
    fetch('/km-claim');
    setTimeout(() => { KM.maxed = false; KM.claimed = true; document.body.dataset.claimed = String((Number(document.body.dataset.claimed) || 0) + 1); renderModal(); }, 40);
  };
  const doat = document.querySelector('#user-list button.doat-mo-btn');
  if (doat) doat.onclick = () => swal('Đạo hữu có chắc chắn muốn đoạt quyền chủ mỏ này không?', 'Xác nhận', () => {
    if (KM.owner || KM.attacksUsed >= 3) { document.body.dataset.refused = 'seize'; return; }
    fetch('/km-seize?says=' + KM.says);
    // Đoạt xong thì bonus tu vi của mỏ TĂNG — bản ghi 14/08: 100% → 120% sau khi mua Linh
    // Quang Phù + đoạt. Chi tiết này không trang trí: nó là thứ cho phép một lượt đoạt tự mở
    // luôn cửa ngưỡng-đào mà chính lượt ấy vừa đóng.
    // (Không dùng dấu backtick trong khối này: cả fixture là một template literal.)
    setTimeout(() => { KM.owner = true; KM.attacksUsed += 1; KM.bonus += 20; page = 1;
      const bEl = document.getElementById('tuvi-bonus-percentage'); if (bEl) bEl.textContent = KM.bonus + '%';
      document.body.dataset.seized = '1';
      /* Chỉ đường 'dom' mới vẽ lời xác nhận ra trang. Đường 'net' (production) im lặng —
         và chính sự im lặng ấy là thứ bài kiểm này phải giữ. Chữ lấy từ data-* chứ không
         viết thẳng vào đây: xem chú thích ở #km-won-text. */
      if (KM.says === 'dom') toast(document.getElementById('km-won-text').dataset.text);
      renderModal(); }, 40);
  });
};
function enterMine() {
  const btn = this;
  if (KM.inMine) { document.body.dataset.refused = 'enter'; return; }
  btn.classList.add('loading'); btn.disabled = true;
  swal('Nếu có phần thưởng từ khoáng mạch khác, sẽ tự động nhận trước khi di chuyển.', 'Có, vào ngay', () => {
    fetch('/km-enter');
    setTimeout(() => { KM.inMine = true; document.body.dataset.entered = '1'; renderList(); }, 40);
  });
}
function openModal() {
  /* Mở lại sổ là về TRANG 1 — bản ghi 14/08: click#239 mở lại, #page-indicator đọc「Trang 1 / 3」(click#242). */
  page = 1;
  document.getElementById('user-modal').style.display = 'block';
  renderModal();
}
for (const [i, b] of [...document.querySelectorAll('.mine-type-button')].entries()) b.onclick = () => {
  for (const x of document.querySelectorAll('.mine-type-button')) x.classList.remove('active');
  b.classList.add('active'); KM.type = i + 1;
  setTimeout(renderList, 30);
};
document.getElementById('shopButton').onclick = () => { document.getElementById('shop-container').style.display = 'block'; };
for (const b of document.querySelectorAll('.shop-item-button')) b.onclick = () => {
  const name = b.closest('.shop-item').textContent;
  swal('Đạo hữu có muốn mua ' + name.replace('Mua Ngay', '').trim() + '?', 'Mua Ngay', () => {
    fetch('/km-buy?item=' + encodeURIComponent(name.includes('Linh Quang') ? 'linh-quang-phu' : 'khac'));
    setTimeout(() => { document.body.dataset.bought = String((Number(document.body.dataset.bought) || 0) + 1); toast('Đạo hữu đã mua thành công Linh Quang Phù! Thời gian hết hạn còn lại: 01 giờ 00 phút.'); }, 40);
  });
};
document.getElementById('next-btn').onclick = () => { page += 1; renderModal(); };
document.getElementById('prev-btn').onclick = () => { page -= 1; renderModal(); };
document.getElementById('reload-btn').onclick = renderModal;
document.getElementById('close-btn').onclick = () => { document.getElementById('user-modal').style.display = 'none'; };
renderList();
</script>`;
};

const FREE_WHEEL_PAGE = `<!doctype html><html lang="vi"><meta charset="utf-8">
<div id="userTurns">2</div><button id="spinButton">Quay Ngay</button>
<div id="prizeSubtitle" style="display:none">Chúc mừng đạo hữu</div>
<script>let spins=0;prizeSubtitle.onclick=()=>prizeSubtitle.style.display='none';spinButton.onclick=()=>{
  spinButton.disabled=true;setTimeout(()=>{spins++;userTurns.textContent=String(2-spins);
  prizeSubtitle.style.display='block';spinButton.dataset.spins=String(spins);spinButton.disabled=false;
  if(spins===2)spinButton.textContent='Hết lượt'},40)
}</script>`;

/** Khối điều khiển boss — thứ mà đợt vẽ thứ hai mang tới trên trang thật. */
/**
 * Khối điều khiển boss, ĐÚNG như server giao trong bản ghi 06/08 21:00: nút KHIÊU CHIẾN vẽ
 * sẵn và mở, bộ đếm lượt mang giá trị THẬT ngay từ HTML đầu tiên.
 */
const bossControls = (turnsLeft) =>
  '<button class="battle-button" id="battle-button">KHIÊU CHIẾN</button>' +
  '<div class="increase-damage">Đạo hữu được tăng 15% sát thương</div>' +
  `<div class="remaining-attacks">Lượt đánh còn lại: <span id="luot">${turnsLeft}</span></div>`;

/**
 * Khối boss ở trạng thái「boss đã bị hạ, thưởng còn treo」— chép từ `dom/01-load.html` của bản
 * ghi hoang-vuc-20260818-013720.
 *
 * Điều PHẢI giữ nguyên, vì nó chính là cái bẫy: chỗ nút KHIÊU CHIẾN là `#reward-button`, và
 * KHÔNG có `#battle-button`, KHÔNG có `#change-element-button`, KHÔNG có `.remaining-attacks`.
 * probes.json của bản ghi đo đủ cả bốn ("no match") — nên một fixture tử tế phải cắt sạch chúng
 * đi, bằng không ca thử sẽ đi qua nhánh cũ mà vẫn xanh.
 */
const bossRewardControls = () =>
  '<img id="boss-image" class="boss-image grayscale" alt="Boss">' +
  '<div class="boss-hp"><div class="hp-bar"><div class="hp-bar-inner dead" style="width: 0%;"></div></div>' +
  '<div class="hp-text" id="hp-text">0.00%</div></div>' +
  '<button class="reward-button" id="reward-button"><i class="fas fa-gift"></i> Nhận thưởng</button>';

/**
 * Trang boss, dựng theo đúng những gì đo được trên trang thật ngày 06/08:
 * `#countdown-timer` ẩn bằng display:none khi chưa đánh, `#battle-button` cũng ẩn bằng
 * display:none ngay khi đòn được ghi nhận (nên phép kiểm `hidden` không bị lớp phủ đánh lừa).
 *
 * `broken` tái hiện CHÍNH sự cố: nút Tấn Công nhận cú bấm rồi không làm gì cả. Trước bản vá,
 * ca đó cho ra「xong」y hệt một trận đánh thật.
 *
 * @param broken  nút Tấn Công nhận cú bấm rồi không làm gì (sự cố 06/08)
 * @param waveMs  khối điều khiển boss tới ở ĐỢT VẼ THỨ HAI, muộn ngần này — mô phỏng trang
 *   vẽ hai đợt dưới sức ép ba tab cùng dựng. 0 = trang đủ ngay từ HTML server.
 * @param state   "ready" (còn lượt) · "cooldown" (nút còn trong DOM nhưng display:none) ·
 *   "spent" (hết lượt hôm nay — site XOÁ HẲN nút khỏi DOM)
 */
const bossPage = (broken, { stateMs = 0, cooling = false, turnsLeft = 5, reward = false } = {}) => `<!doctype html><html lang="vi"><meta charset="utf-8">
<div id="boss-info">
  <div>${reward ? "Hỗn Thiên Ma Vương" : "Huyết Trư Địa Quỷ 61.55%"}</div>
  <div id="boss-slot">${reward ? bossRewardControls() : bossControls(turnsLeft)}</div>
</div>
<div id="countdown-timer" style="display:none"></div>
<div id="boss-damage-screen" style="display:none">
  <button class="attack-button">⚔️Tấn Công</button><button class="back-button">Trở lại</button>
</div>
<div id="damage-summary-container" style="display:none"><button class="close-button">Đóng</button></div>
<script>
const $ = (s) => document.querySelector(s);
const startCooldown = () => {
  $('#countdown-timer').textContent = 'Chờ 7 phút 19 giây để tấn công lần tiếp theo.';
  $('#countdown-timer').style.display = 'block';
  $('#battle-button').style.display = 'none';
};
// XHR trạng thái tới MUỘN, và nó chỉ biết LẤY ĐI lời mời — đúng như trang thật: vỏ trang
// luôn chào "đánh được", sự thật đến sau mới rút lời chào ấy lại nếu đang cooldown.
${
  cooling
    ? `setTimeout(startCooldown, ${stateMs});`
    : `/* không cooldown: XHR về nhưng KHÔNG đổi gì — đó là lý do "chưa vẽ" và "đánh được" trông giống hệt nhau */`
}
document.addEventListener('click', (e) => {
  const t = e.target;
  if (t.id === 'reward-button') {
    fetch('/hv-claim');
    setTimeout(() => {
      const box = document.createElement('div');
      box.className = 'reward-notification success';
      box.innerHTML = '<div class="reward-content">'
        + '<button type="button" class="reward-close" aria-label="Đóng"><i class="fas fa-times"></i></button>'
        + '<div class="reward-message"><h3 class="title-reward">Thành công!</h3>'
        + '<div class="reward-list">'
        + '<div class="reward-item"><i></i> <span class="amount">1800</span> Tu Vi </div>'
        + '<div class="reward-item"><img alt="Tinh Thạch"> <span class="amount">390</span> Tinh Thạch </div>'
        + '<div class="reward-item"><img alt="Tinh Huyết"> <span class="amount">120</span> Tinh Huyết </div>'
        + '<div class="reward-item"><img alt="Tiên Ngọc"> <span class="amount">300</span> Tiên Ngọc </div>'
        + '</div></div></div>';
      document.body.append(box);
      document.body.dataset.claimed = '1';
    }, 120);
  } else if (t.closest && t.closest('.reward-close')) {
    /* Trang thật TỰ TẢI LẠI khi hộp đóng — giữ đúng nhịp ấy, vì nó là thứ trả lại
       #battle-button cho cụm khiêu chiến bên dưới. */
    document.querySelector('.reward-notification').remove();
    setTimeout(() => location.reload(), 60);
  } else   if (t.id === 'battle-button') {
    setTimeout(() => { $('#boss-damage-screen').style.display = 'block'; }, 300);
  } else if (t.classList.contains('attack-button')) {${
    broken
      ? "\n    /* đúng ca hỏng: site nuốt cú bấm, không gì đổi */"
      : `
    // Server TỪ CHỐI theo sự thật của CHÍNH NÓ, không theo thứ trang đã kịp vẽ. Phân biệt này
    // là cả giá trị của fixture: gác theo DOM thì một flow bấm bừa vào vỏ trang lại được cho
    // qua đúng vào khoảnh khắc nó sai nhất — fixture hoá ra lại tha bổng chính cái bug.
    if (${cooling ? "true" : "false"}) { document.body.dataset.refused = '1'; return; }
    setTimeout(() => {
      $('#luot').textContent = String(Math.max(0, +$('#luot').textContent - 1));
      $('#damage-summary-container').style.display = 'block';
      document.body.dataset.attacked = String(+(document.body.dataset.attacked || 0) + 1);
      startCooldown();
    }, 200);`
  }
  } else if (t.classList.contains('close-button')) {
    $('#damage-summary-container').style.display = 'none';
  } else if (t.classList.contains('back-button')) {
    $('#boss-damage-screen').style.display = 'none';
  }
});
</script>`;

/**
 * Trang Luyện Đan Đường, dựng theo bản ghi 29/07 + video của nó.
 *
 * Hai điều làm trang này khác mọi trang khác, và cả hai đều nằm trong bản vá:
 *  • Vẽ HAI ĐỢT: `#ld-app` là vỏ server (chứa sẵn ba nút XƯƠNG opacity-0), panel thật do XHR
 *    trạng thái vẽ `waveMs` sau.
 *  • Lửa TỤT liên tục. Nút Điều Hòa bị site KHOÁ cho tới khi % ≤ 68, và chuỗi「68%」chỉ hiện
 *    trên màn đúng khoảng một giây lúc kim quét qua con số ấy — `startFire` cho phép dựng lại
 *    ca script tới SAU khoảnh khắc đó, tức đúng ca đã làm nổ lò.
 */
const furnacePage = ({ waveMs = 1200 } = {}) => `<!doctype html><html lang="vi"><meta charset="utf-8">
<div id="ld-app">
  <button id="ldBtnCraft" style="opacity:0;width:120px;height:36px" disabled>Luyện Đan</button>
  <button id="ldBtnTune" style="opacity:0;width:120px;height:36px" disabled>Điều Hòa</button>
  <button id="ldBtnCollect" style="opacity:0;width:120px;height:36px" disabled>Thu Đan</button>
  <div id="ldStabilityWrap" style="width:220px;height:12px"></div>
  <div id="ldPanel"></div><div id="ldInventory"></div>
</div>
<div id="ldModal" style="display:none"><button id="ldModalCloseBtn">Đóng</button><button id="ldModalDecompose">Phân Giải</button></div>
<div id="ldConfirm" style="display:none"><button id="ldConfirmOk">Xác Nhận</button></div>
<div id="ldDecomposeReward" style="display:none"><button id="ldDecomposeRewardOk">ĐÓNG</button></div>
<script>
const $ = (s) => document.querySelector(s);
let S = null;
const show = (b, on) => { b.style.opacity = '1'; b.disabled = !on; };
const hide = (b) => { b.style.opacity = '0'; b.disabled = true; };
function render() {
  if (!S) return;
  const p = $('#ldPanel');
  if (S.phase === 'cooking') {
    hide($('#ldBtnCraft')); hide($('#ldBtnCollect'));
    // Đúng luật đo trong luyen-dan.min.js (06/08): nút chỉ khoá khi lửa ≥ 99.99% hoặc đang
    // cooldown — nó MỞ từ rất lâu trước ngưỡng 68. Còn "bấm bây giờ thì ĐƯỢC ĐẾM" là một
    // trạng thái riêng, trang phát nó qua class is-tune-weak trên #ldStabilityWrap.
    show($('#ldBtnTune'), S.tunes < 3 && !S.locked && S.fire < 99.99);
    $('#ldStabilityWrap').classList.toggle('is-tune-weak', S.tunes < 3 && S.fire <= 68);
    const pct = Math.max(0, Math.round(S.fire)) + '%';
    // Đồng hồ mẻ đan có mặt trong MỌI trạng thái đang luyện — đó là thứ bước "đệm chờ XHR"
    // của flow dò bằng chuỗi "00:" để biết panel thật đã về.
    const clock = '<p>Thời gian còn lại 00:41:00</p>';
    p.innerHTML = (S.tunes === 0
      ? '<p>Lửa: <b>' + pct + '</b> — Còn 04:53 — cần 3 lần Điều Hòa khi % ≤ 68</p>'
      : S.tunes >= 3
        ? '<p>Đã giữ lửa đủ 3 lần — Đan Lô an toàn</p>'
        : '<p>Lửa: <b>' + pct + '</b> — Giữ lửa: ' + S.tunes + '/3</p>') + clock;
  } else {
    hide($('#ldBtnTune')); hide($('#ldBtnCollect')); show($('#ldBtnCraft'), true);
    $('#ldStabilityWrap').classList.remove('is-tune-weak');
    p.innerHTML = '<button class="ld-recipe-tier">Hạ Phẩm</button><p>Đan Lô đã phát nổ.</p>';
  }
}
setTimeout(async () => {
  S = await (await fetch('/ld-state')).json(); render();
  setInterval(async () => { S = await (await fetch('/ld-state')).json(); render(); }, 300);
}, ${waveMs});
document.addEventListener('click', async (e) => {
  if (e.target.id === 'ldBtnTune' && !e.target.disabled) {
    S = await (await fetch('/ld-tune')).json();
    render();
  }
});
</script>`;

// Trang Tiên Duyên + modal Hỷ Sự Đường theo recording 05/08: nút .hy-su-btn mở modal, danh
// sách tiệc nạp ASYNC (~80ms — đủ chậm để bắt lỗi phán "hết phòng chưa chúc" trên một danh
// sách chưa kịp về), mỗi hàng mang trạng thái chúc riêng và link "Vào Chúc Ngay" target=_blank
// — đúng cái link mà flow KHÔNG được click.
// Hàng của modal chép NGUYÊN VĂN từ bản ghi 15/08/2026 (hy-su-duong-20260815-205221,
// dom/02-click.html) — kể cả cái mà bản dựng tay trước đây bỏ mất: <p.wedding-now-li-xi-status>
// đứng TRƯỚC <p.wedding-now-blessing-status>. Đúng cặp span ấy (`li-xi-sent`/`li-xi-not-sent`)
// là thứ ghi chú của người ghi hình chỉ vào — "phòng nào Chưa chúc thì vào chúc ngay bất kể có
// Đã phát lì xì hay chưa" — nên fixture thiếu nó thì không phép thử nào chứng minh được điều đó.
// Badge loại phòng cũng là thật: tên cặp đôi trong lời kể mang cả "💕 Đạo Lữ" ở đầu.
const hySuHallPage = (rooms, blessed, gifts) => {
  const rows = rooms
    .map((room) => {
      const done = blessed.has(room.id) || room.preBlessed === true;
      // Hồng bao đọc từ SỔ SỐNG chứ không phải từ hằng số của phòng: khai xong thì máy chủ thật
      // lật has_li_xi về false ngay lượt mở modal sau (thân trả lời show_all_wedding của bản ghi).
      // Fixture treo mãi dòng ấy sẽ dạy lượt chạy quay lại một phòng không còn gì để khai.
      const gift = gifts.has(room.id);
      const hongNhan = room.type === "hong-nhan";
      const href = hongNhan ? `/hong-nhan/?id=${room.id}` : `/phong-cuoi?id=${room.id}`;
      const badge = hongNhan
        ? '<span class="wedding-now-type-badge">💕 Hồng Nhan</span>'
        : '<span class="wedding-now-type-badge dao-lu">💕 Đạo Lữ</span>';
      return `<div class="wedding-now-item${hongNhan ? " type-hong-nhan" : ""}">
        <div class="wedding-now-info">
          <p class="wedding-now-couple">${badge} <strong>${room.couple}</strong></p>
          <p class="wedding-now-li-xi-status">Trạng thái lì xì: <span class="${room.lixiSent ? "li-xi-sent" : "li-xi-not-sent"}">${room.lixiSent ? "Đã phát lì xì" : "Chưa phát lì xì"}</span></p>
          ${gift ? '<p class="wedding-now-li-xi-available">🧧 Có lì xì chưa mở!</p>' : ""}
          <p class="wedding-now-blessing-status">Trạng thái: <span class="${done ? "blessed" : "not-blessed"}">${done ? "Đã chúc" : "Chưa chúc"}</span></p>
        </div>
        <div class="wedding-now-action"><a href="${href}" class="wedding-now-btn${gift ? " has-gift-btn" : ""}" target="_blank">${gift ? "🧧 " : ""}Vào Chúc Ngay</a></div>
      </div>`;
    })
    .join("");
  return `<!doctype html><html lang="vi"><meta charset="utf-8">
<button class="tien-duyen-btn hy-su-btn">Hỷ Sự Đường <span class="notification-badge">${rooms.length}</span></button>
<div id="wedding-now-modal" style="display:none"><div id="wedding-now-body">Đang tải danh sách tiệc cưới...</div></div>
<script>
document.querySelector('.hy-su-btn').addEventListener('click', () => {
  document.getElementById('wedding-now-modal').style.display = 'block';
  setTimeout(() => { document.getElementById('wedding-now-body').innerHTML = ${JSON.stringify(rows)}; }, 80);
});
</script>`;
};

// Phòng cưới theo recording: form chúc phúc render sẵn, select mặc định tự điền textarea qua
// onchange, "Gửi Chúc Phúc" mở hộp xác nhận, và server NHẬN là nút gửi bị gỡ khỏi DOM (~40ms
// sau confirm ngoài đời là toast + gỡ nút). Confirm với lời chúc RỖNG bị từ chối — đó chính
// là lưới bắt kịch bản script chọn-ngẫu-nhiên không điền được gì.
// (Bao `.lixi-envelope` từng dựng ở đây đã GỠ 18/08/2026: markup ấy không tồn tại ngoài đời —
// bên Đạo Lữ nó chỉ là CSS trong thẻ style, bên Hồng Nhan grep ra 0. Khay hồng bao THẬT nằm
// ở hySuHongNhanPage bên trên.)
// Phòng ĐÃ CHÚC không phải "phòng chưa chúc thiếu mất cái nút": đo trên bản ghi 11/08/2026
// (custom-20260811-233113, dom/04-load.html) thì site bỏ HẲN form — không #blessing-default-options,
// không .blessing-form — và thay bằng .blessing-message ("Đạo hữu đã gửi lời chúc phúc cho cặp
// đôi này!"). Fixture cũ vẫn dựng cả form, nên nó không bao giờ bắt được chuyện một lượt chạy
// nhắm vào phòng đã chúc sẽ chết ở bước chờ form.
// Trang phòng "lạ": tải được, render xong, nhưng KHÔNG có form chúc lẫn dấu đã chúc. Đây là
// hình dạng mà một trang đổi markup — hoặc một loại phòng chưa từng được ghi hình — sẽ hiện ra,
// và tới 15/08/2026 nó là thứ giết cả lượt chạy ở đúng phòng gặp nó, bỏ mặc các phòng phía sau
// (sự cố có thật: "Hỷ Sự Đường: repeat vòng 3: Trang chưa dựng xong sau 25s").
const hySuBrokenRoomPage = (id) => `<!doctype html><html lang="vi"><meta charset="utf-8">
<div class="blessing-section"><h2>Gửi Lời Chúc Phúc</h2>
<p>Phòng cưới #${id} đang bảo trì.</p></div>`;

// Trang phòng HỒNG NHAN mang KHAY HỒNG BAO — chép từ bản ghi hy-su-duong-20260818-094945
// (dom/08-load.html cho khay và dấu đã chúc, dom/10-click.html cho hình dạng sau khi khai).
// Bốn thứ PHẢI giữ nguyên, vì chính chúng là cái bẫy:
//
//   1. Khay là `position:fixed; inset:0; z-index:10002` và khi `.active` thì
//      `pointer-events:all` — nó CHE KÍN trang, kể cả form chúc. Đây là lý do cụm hồng bao
//      phải chạy TRƯỚC cụm chúc chứ không phải nối vào đuôi.
//   2. Khay KHÔNG có `.active` lúc trang vẽ xong; site gắn sau (đo được ~1,2 giây). Fixture
//      giữ đúng nhịp ấy để bước chờ `Visible #hnLiXiModal` có việc thật để làm.
//   3. `#hnOpenBtn`/`#hnCloseBtn` NẰM SẴN trong DOM kể cả khi khay chưa mở, và chúng có kích
//      thước thật — nên `conditionProbe` (chỉ đọc chính phần tử) sẽ bảo là 'visible'. Phòng
//      KHÔNG có hồng bao ở đây cũng dựng đủ khay-chưa-mở, cố ý dựng ca KHÓ HƠN đời thật (bản
//      ghi chỉ có phòng CÓ hồng bao), vì một fixture dễ hơn đời thật thì xanh mà vô nghĩa.
//   4. Sau khi khai: nút khai `display:none`, `#hnRewardWrap` thêm `.show`, `#hnRewardName`
//      và `#hnRewardAmount` đổi từ hai gạch '—' thành 'Tiên Ngọc' / '49'.
const hySuHongNhanPage = (id, hasGift) => `<!doctype html><html lang="vi"><meta charset="utf-8">
<style>
.hndx-overlay { position: fixed; inset: 0; z-index: 10002; display: flex; align-items: center; justify-content: center; background: rgba(10,4,10,0.88); opacity: 0; pointer-events: none; transition: opacity 0.5s ease; }
.hndx-overlay.active { opacity: 1; pointer-events: all; }
.hndx-overlay.closing { opacity: 0; pointer-events: none; }
.hndx-box { position: relative; width: 380px; padding: 36px 28px 28px; text-align: center; }
.hndx-close { position: absolute; top: 12px; right: 14px; width: 28px; height: 28px; }
.hndx-open-btn { display: inline-flex; padding: 11px 28px; }
.hndx-reward-wrap { display: none; margin-top: 16px; }
.hndx-reward-wrap.show { display: block; }
</style>
<a href="/tien-duyen/" class="back-btn">← Quay Lại</a>
<div class="hndx-overlay" id="hnLiXiModal"><div class="hndx-box">
  <button class="hndx-close" id="hnCloseBtn" aria-label="Đóng">×</button>
  <div class="hndx-title">Phong Tặng Đại Điển</div>
  <button class="hndx-open-btn" id="hnOpenBtn"><span>🧧</span> Khai Phong Lì Xì</button>
  <div class="hndx-reward-wrap" id="hnRewardWrap"><div class="hndx-reward-card" id="hnRewardCard">
    <div class="hndx-reward-name" id="hnRewardName">—</div>
    <div class="hndx-reward-amount" id="hnRewardAmount">—</div>
  </div></div>
</div></div>
<div class="hn-container">
  <div class="hn-progress-wrap"><span class="hn-progress-count" id="hn-count">5535/999 Lời Chúc</span></div>
  <div class="hn-bless-section"><h2 class="hn-bless-title">✦ Gửi Lời Chúc Phúc ✦</h2>
    <div class="hn-already-blessed">🌸 Đạo hữu đã gửi lời chúc phúc cho Đại Điển này rồi!</div>
  </div>
</div>
<script>
const tray = document.getElementById('hnLiXiModal');
${hasGift ? `setTimeout(() => tray.classList.add('active'), 1200);` : ""}
document.getElementById('hnOpenBtn').onclick = () => {
  const btn = document.getElementById('hnOpenBtn');
  btn.disabled = true;
  fetch('/hy-su-lixi?id=${id}').then((r) => r.json()).then((d) => {
    setTimeout(() => {
      btn.style.display = 'none';
      document.getElementById('hnRewardName').textContent = d.name;
      document.getElementById('hnRewardAmount').textContent = String(d.amount);
      document.getElementById('hnRewardWrap').classList.add('show');
    }, 150);
  });
};
document.getElementById('hnCloseBtn').onclick = () => {
  tray.classList.add('closing');
  fetch('/hy-su-tray-closed?id=${id}');
  setTimeout(() => tray.remove(), 60);
};
</script>`;
// Khay lì xì bản ĐẠO LỮ — chép từ `dom/10-load.html` của bản ghi hy-su-duong-20260819-110345
// (và `dom/12-click.html` cho hình dạng sau khi khai). Ba chỗ PHẢI khác bản Hồng Nhan, vì
// chính chúng là thứ bản vá phải nuốt được:
//
//   1. Bộ id TRẦN: #liXiModal · #openButton · #closeButton, thiệp là #rewardReveal >
//      #rewardItem với .lixi-reward-name / .lixi-reward-amount. Không có tiền tố `hn`.
//   2. Khay `.active` NGAY từ lúc trang vẽ xong — khác Hồng Nhan (site gắn sau ~1,2 giây).
//      Giữ đúng nhịp ấy: một fixture cho cả hai họ cùng nhịp sẽ giấu mất chuyện đó.
//   3. `.lixi-envelope` CÓ thật ở đây (81×81, probes đo được), khác bên Hồng Nhan. Nó chỉ là
//      hình cái phong bao, không phải nút — để trong fixture đúng như đời thật, để bất kỳ ai
//      định neo vào nó lần nữa sẽ thấy ngay là neo vào một thứ không bấm được.
const hySuRoomPage = (id, alreadyBlessed, hasGift) => `<!doctype html><html lang="vi"><meta charset="utf-8">
${hasGift ? `
<style>
.lixi-modal { position: fixed; inset: 0; z-index: 10002; display: none; align-items: center; justify-content: center; background: rgba(20,0,8,0.9); }
.lixi-modal.active { display: flex; }
.lixi-modal-content { position: relative; width: 320px; padding: 30px; text-align: center; }
.lixi-close-button { position: absolute; top: 10px; right: 12px; width: 26px; height: 26px; }
.lixi-envelope { width: 81px; height: 81px; margin: 0 auto; }
.lixi-open-button { display: inline-flex; padding: 10px 26px; }
.lixi-reward-reveal { display: none; margin-top: 14px; }
.lixi-reward-reveal.show { display: block; }
</style>
<div class="lixi-modal active" id="liXiModal">
  <div class="lixi-sparkles" id="sparkles"></div>
  <button class="lixi-close-button" id="closeButton">×</button>
  <div class="lixi-modal-content">
    <div class="lixi-envelope"></div>
    <h2>Chúc Mừng!</h2>
    <p>Đạo hữu là vị khách may mắn nhận được lì xì từ chủ tiệc cưới. Hãy mở để xem điều bất ngờ!</p>
    <button class="lixi-open-button" id="openButton">Mở Lì Xì</button>
    <div class="lixi-reward-reveal" id="rewardReveal">
      <div class="lixi-reward-chest" id="rewardChest"><div class="lixi-chest-lid" id="chestLid"></div></div>
      <div class="lixi-reward-item" id="rewardItem"></div>
    </div>
  </div>
</div>
<script>
const dlTray = document.getElementById('liXiModal');
document.getElementById('openButton').onclick = () => {
  const btn = document.getElementById('openButton');
  btn.disabled = true;
  fetch('/hy-su-lixi?id=${id}').then((r) => r.json()).then((d) => {
    setTimeout(() => {
      btn.style.display = 'none';
      document.getElementById('rewardItem').innerHTML =
        '<div class="lixi-reward-name">' + d.name + '</div>' +
        '<div class="lixi-reward-amount">' + d.amount + '</div>' +
        '<div class="lixi-reward-text">Chúc mừng đạo hữu đã nhận được phần thưởng!</div>';
      document.getElementById('rewardItem').classList.add('show');
      document.getElementById('rewardReveal').classList.add('show');
    }, 150);
  });
};
document.getElementById('closeButton').onclick = () => {
  fetch('/hy-su-tray-closed?id=${id}');
  setTimeout(() => dlTray.remove(), 60);
};
</script>
` : ""}
<div class="blessing-section"><h2>Gửi Lời Chúc Phúc</h2>
${alreadyBlessed ? '<div class="blessing-message"><p>Đạo hữu đã gửi lời chúc phúc cho cặp đôi này! 🌸</p></div>' : `<div class="blessing-form">
<select id="blessing-default-options" onchange="fillBlessingMessage()">
  <option value="">🌿 Chọn lời chúc mặc định...</option>
  <option value="Thiên duyên vạn kiếp, hội ngộ giữa hồng trần!">🔮 Lời chúc 1</option>
  <option value="Duyên khởi từ tâm, đạo hợp bởi ý!">💫 Lời chúc 2</option>
  <option value="Một bước nhập đạo, vạn kiếp thành tiên!">🔥 Lời chúc 3</option>
</select>
<textarea id="blessing-message"></textarea>
<button class="blessing-button" onclick="showConfirmModal()">Gửi Chúc Phúc</button>
</div>`}</div>
<div id="confirm-modal" style="display:none">
  <button class="custom-modal-button cancel">Hủy Bỏ</button>
  <button class="custom-modal-button confirm">Xác Nhận</button>
</div>
<script>
function fillBlessingMessage(){document.getElementById('blessing-message').value=document.getElementById('blessing-default-options').value}
function showConfirmModal(){document.getElementById('confirm-modal').style.display='block'}
document.querySelector('.custom-modal-button.cancel').onclick=()=>{document.getElementById('confirm-modal').style.display='none'};
document.querySelector('.custom-modal-button.confirm').onclick=()=>{
  const msg=document.getElementById('blessing-message').value;
  if(!msg)return;
  document.getElementById('confirm-modal').style.display='none';
  fetch('/hy-su-blessed?id=${id}&msg='+encodeURIComponent(msg)).then(()=>{
    setTimeout(()=>{const b=document.querySelector('.blessing-button');if(b)b.remove()},40);
  });
};

</script>`;

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

  // Tên tài khoản đọc từ cookie đăng nhập — dùng để tự đặt nhãn khi đạo hữu bỏ trống ô tên,
  // đúng như bản PC. Nhãn sai thì không ai chết, nhưng nhãn NÉM thì hỏng cả lượt lưu tài
  // khoản, nên các ca xấu ở đây quan trọng hơn ca đẹp.
  const user = (jar) => detectWordPressUser(jar);
  const loginCookie = (value) => [{ name: "wordpress_logged_in_9c1", value }];

  check("tên đọc được từ cookie đăng nhập", user(loginCookie("daohuu|1786|tok|hmac")) === "daohuu");
  check(
    "giá trị URL-encode được giải mã trước khi cắt",
    user(loginCookie("nam%20cung%20binh%7C1786%7Ctok")) === "nam cung binh",
    `nhận ${user(loginCookie("nam%20cung%20binh%7C1786%7Ctok"))}`,
  );
  check("không có dấu | thì cả chuỗi là tên", user(loginCookie("chidanhthoi")) === "chidanhthoi");
  check(
    "lấy đúng cookie đăng nhập giữa đám cookie khác",
    user([
      { name: "fakesessid", value: "s1" },
      { name: "WordPress_Logged_In_AB", value: "hoala|1|t" },
    ]) === "hoala",
  );

  check("không có cookie đăng nhập → null", user([{ name: "fakesessid", value: "a|b" }]) === null);
  check("jar rỗng → null", user([]) === null);
  check("giá trị rỗng → null", user(loginCookie("")) === null);
  check("đoạn tên rỗng (bắt đầu bằng |) → null, KHÔNG lấy cả chuỗi", user(loginCookie("|1786|tok")) === null);
  check("đoạn tên toàn khoảng trắng → null", user(loginCookie("   |1786|tok")) === null);
  check(
    "phần trăm hỏng không được NÉM — rơi về giá trị thô",
    user(loginCookie("%zz|1786")) === "%zz",
    `nhận ${user(loginCookie("%zz|1786"))}`,
  );
  check("cookie thiếu trường value không làm sập", user([{ name: "wordpress_logged_in_x" }]) === null);

  // Worker tông môn chạy tuần tự cho nhiều người. Một profile chung từng khiến cookie VIP
  // còn sống của lượt trước thắng cookie thường vừa lưu của lượt sau.
  const profileRoot = fileURLToPath(new URL("../.smoke-browser-profiles/", import.meta.url));
  const profileVip = profileDirForJob(profileRoot, {
    userId: "user-a",
    gameCookie: "wordpress_logged_in_ab=vip|session",
  });
  const profileVipAgain = profileDirForJob(profileRoot, {
    userId: "user-a",
    gameCookie: "wordpress_logged_in_ab=vip|session",
  });
  const profileThuong = profileDirForJob(profileRoot, {
    userId: "user-a",
    gameCookie: "wordpress_logged_in_ab=thuong|session",
  });
  const profileOtherUser = profileDirForJob(profileRoot, {
    userId: "user-b",
    gameCookie: "wordpress_logged_in_ab=vip|session",
  });
  check("cùng user + cookie tái dùng đúng profile bền", profileVip === profileVipAgain);
  check("đổi cookie tạo profile sạch — VIP cũ không thắng account thường", profileVip !== profileThuong);
  check("hai user không bao giờ dùng chung browser profile", profileVip !== profileOtherUser);
  check(
    "tên profile không làm lộ cookie",
    !profileThuong.includes("wordpress_logged_in") && !profileThuong.includes("thuong"),
  );

  // AES-GCM + Base64 nở dài hơn plaintext. Trước v0.20.1, cookie JSON dài lưu thành công
  // nhưng lần đọc kế tiếp bị schema 8.000 ký tự loại cả document về mặc định rỗng.
  const { configSchema, storedConfigSchema } = await import("../src/lib/services/configs.ts");
  const longEnvelope = `v1.${"a".repeat(10_700)}`;
  check("schema plaintext vẫn chặn cookie quá 8.000 ký tự", !configSchema.safeParse({ gameCookie: longEnvelope }).success);
  check("schema at-rest nhận phong bì Base64 dài hơn plaintext", storedConfigSchema.safeParse({ gameCookie: longEnvelope }).success);

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
  // ĐÚNG MỘT LẦN: từ schema 45 mỗi tên nhiệm vụ là một cặp flow VIP/thường, nên vòng dịch
  // chạy hai lượt và trước 19/08/2026 kể lại y hệt hai lần — 414 dòng thừa trong ba ngày
  // nhật ký thật, từng đôi cách nhau 156ms. Tên nhiệm vụ nằm sẵn trong câu nên trùng chữ là
  // trùng sự thật; `profileForConfig` lọc ở cửa ra.
  check(
    "…đúng MỘT lần, dù nhiệm vụ có cặp flow VIP/thường",
    notes.filter((n) => n.includes("250000")).length === 1,
    String(notes.filter((n) => n.includes("250000")).length),
  );
  check(
    "không câu dịch nào bị kể hai lần",
    new Set(notes).size === notes.length,
    notes.filter((n, i) => notes.indexOf(n) !== i).join(" / ") || "(sạch)",
  );
  check("capCheck=false → nhánh «không kiểm tra»", opt(meCung, "capCheck").selectedValue.includes("«"));
  check("tier → Cực Phẩm", opt(luyenDan, "tier").selectedValue === "Cực Phẩm");

  // Lời nhắn Trò Chuyện Đội (recording 08/08): chuỗi phải qua sanitizeChatMessage rồi tới
  // ĐỦ CẢ HAI twin — đích đến của nó là một literal trong nguồn evaluateJavaScript, nên
  // nháy/backslash sống sót ở đây là script chết ở ngoài kia.
  {
    const { configSchema } = await import("../src/lib/services/configs.ts");
    const parsed = configSchema.parse({
      quests: {
        meCung: {
          enabled: true,
          chatLobby: '  xin "chào"   \'đội\' `nhé`\\',
          chatFight: "x".repeat(500),
        },
      },
    });
    check(
      "lời nhắn được LÀM SẠCH ngay ở schema: nháy đơn/kép/backtick/backslash biến mất",
      parsed.quests.meCung.chatLobby === "xin chào đội nhé",
      JSON.stringify(parsed.quests.meCung.chatLobby),
    );
    check(
      "và bị cắt ở trần 200 ký tự của chính ô nhập trên site",
      parsed.quests.meCung.chatFight.length === 200,
      String(parsed.quests.meCung.chatFight.length),
    );

    const chatProfile = profileForConfig(parsed);
    const twins = chatProfile.quests.filter((q) => q.name === "Mê Cung");
    check(
      "cả HAI twin Mê Cung cùng nhận lời nhắn — công tắc và option áp cho cả cặp",
      twins.length === 2 &&
        twins.every(
          (q) =>
            opt(q, "chatLobby").selectedValue === "xin chào đội nhé" &&
            opt(q, "chatFight").selectedValue.length === 200,
        ),
      twins.map((q) => opt(q, "chatLobby").selectedValue).join(" / "),
    );
  }
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

  console.log("\nLuyện Đan Đường tách theo hạng");

  // Vụ 05/08: hai tab từng nhìn chung một bộ config, nên khắc ngọc giản từ tab VIP là đè
  // loại đan/mức phân giải của tab Thường và ngược lại. Giờ `luyenDan` chỉ áp cho twin
  // VIP, `luyenDanThuong` cho twin thường — bốn ca dưới ghim đúng ranh giới đó.
  const splitCfg = {
    ...cfg,
    quests: {
      ...cfg.quests,
      luyenDan: { enabled: true, tier: "Cực Phẩm", keepStarsFrom: 4 },
      luyenDanThuong: { enabled: true, tier: "Hạ Phẩm", keepStarsFrom: 1 },
    },
  };
  const splitProfile = profileForConfig(splitCfg, () => {});
  const ldVip = splitProfile.quests.find((q) => q.id === "luyen-dan-duong");
  const ldFree = splitProfile.quests.find((q) => q.id === "luyen-dan-duong-thuong");
  check(
    "twin VIP nhận đúng bộ VIP (Cực Phẩm, giữ từ 4 sao)",
    ldVip.enabled === true &&
      opt(ldVip, "tier").selectedValue === "Cực Phẩm" &&
      opt(ldVip, "decompose").selectedValue === "dược khí 4 sao",
    `${opt(ldVip, "tier").selectedValue} / ${opt(ldVip, "decompose").selectedValue}`,
  );
  check(
    "twin thường nhận bộ RIÊNG của nó (Hạ Phẩm, giữ tất cả) — không bị bản VIP đè",
    ldFree.enabled === true &&
      opt(ldFree, "tier").selectedValue === "Hạ Phẩm" &&
      opt(ldFree, "decompose").selectedValue === "dược khí",
    `${opt(ldFree, "tier").selectedValue} / ${opt(ldFree, "decompose").selectedValue}`,
  );

  // Công tắc cũng tách: bật một hạng không được kéo hạng kia sáng theo.
  const vipOnly = profileForConfig(
    { ...cfg, quests: { ...cfg.quests, luyenDanThuong: { enabled: false } } },
    () => {},
  );
  check(
    "tắt bản thường → twin thường tắt, twin VIP vẫn sáng",
    vipOnly.quests.find((q) => q.id === "luyen-dan-duong").enabled === true &&
      vipOnly.quests.find((q) => q.id === "luyen-dan-duong-thuong").enabled === false,
  );
  const freeOnly = profileForConfig(
    {
      ...cfg,
      quests: {
        ...cfg.quests,
        luyenDan: { enabled: false },
        luyenDanThuong: { enabled: true, tier: "Trung Phẩm", keepStarsFrom: 0 },
      },
    },
    () => {},
  );
  const freeOnlyTwin = freeOnly.quests.find((q) => q.id === "luyen-dan-duong-thuong");
  check(
    "bật mỗi bản thường → chỉ twin thường sáng, đúng option của nó",
    freeOnly.quests.find((q) => q.id === "luyen-dan-duong").enabled === false &&
      freeOnlyTwin.enabled === true &&
      opt(freeOnlyTwin, "tier").selectedValue === "Trung Phẩm",
  );

  // Snapshot đóng băng TRƯỚC deploy tách đôi không mang `luyenDanThuong` — twin thường
  // phải rơi về bộ chung cũ (đúng hành vi lúc snapshot được khắc) chứ không tắt ngầm.
  // `cfg` phía trên chính là một snapshot như vậy.
  const ldFreeLegacy = profile.quests.find((q) => q.id === "luyen-dan-duong-thuong");
  check(
    "snapshot cũ thiếu luyenDanThuong → twin thường rơi về bộ chung (Cực Phẩm)",
    ldFreeLegacy.enabled === true && opt(ldFreeLegacy, "tier").selectedValue === "Cực Phẩm",
    opt(ldFreeLegacy, "tier").selectedValue,
  );

  // Di trú document JSONB cũ: đường đọc phải GIEO bản thường từ bản chung trước khi Zod
  // điền default — nếu không, mọi tài khoản thường đang luyện đan bị tắt ngầm sau deploy.
  const { seedLuyenDanThuong } = await import("../src/lib/services/configs.ts");
  const seeded = storedConfigSchema.parse(
    seedLuyenDanThuong({
      quests: { luyenDan: { enabled: true, tier: "Thượng Phẩm", keepStarsFrom: 2 } },
    }),
  );
  check(
    "document cũ: luyenDanThuong được gieo nguyên bản từ luyenDan",
    seeded.quests.luyenDanThuong.enabled === true &&
      seeded.quests.luyenDanThuong.tier === "Thượng Phẩm" &&
      seeded.quests.luyenDanThuong.keepStarsFrom === 2,
  );
  const untouched = storedConfigSchema.parse(
    seedLuyenDanThuong({
      quests: {
        luyenDan: { enabled: true, tier: "Cực Phẩm" },
        luyenDanThuong: { enabled: false },
      },
    }),
  );
  check(
    "document đã tách: giữ nguyên hai bản, không gieo đè",
    untouched.quests.luyenDanThuong.enabled === false &&
      untouched.quests.luyenDan.enabled === true &&
      untouched.quests.luyenDan.tier === "Cực Phẩm",
  );

  // Chốt giữ cho cửa thứ hai: op claim của /api/worker parse snapshot mà claimNextJob /
  // completeWorkerCycle vừa chép THÔ từ user_configs bằng SQL — không qua readStored. Quên
  // gieo ở đó là document cũ bị Zod điền default enabled=false cho bản thường, đúng kịch
  // bản tắt ngầm mà luật di trú sinh ra để chặn.
  const workerRouteSrc = readFileSync(
    new URL("../src/app/api/worker/route.ts", import.meta.url),
    "utf8",
  );
  check(
    "op claim gieo luyenDanThuong trước khi parse snapshot",
    workerRouteSrc.includes("storedConfigSchema.safeParse(seedLuyenDanThuong("),
  );

  // TÊN MIỀN GAME phải đi qua cửa phát việc. Trước 20/08/2026 nó không có đường nào tới khôi
  // lỗi: user_configs giữ `gameBaseUrl` riêng của từng người (rỗng), claimNextJob chép thô
  // document ấy, workflow khôi lỗi không đặt GAME_BASE_URL — nên runCycle rơi xuống hằng số,
  // và hằng số ấy còn là một tên miền ĐÃ DỜI. Cả năm lượt vá sau đó đi chữa nhầm trình duyệt.
  check(
    "op claim ghép tên miền game của tông môn vào snapshot khi người dùng để trống",
    workerRouteSrc.includes("gameBaseUrl: settings.game.baseUrl"),
  );
  check(
    "…và CHỈ khi để trống — người tự gõ tên miền riêng vẫn được tôn trọng",
    workerRouteSrc.includes("parsedConfig.gameBaseUrl.trim().length > 0"),
  );
  // Hằng số cuối nguồn phải theo kịp site. Không ghim đúng một chuỗi (site đổi TLD định kỳ),
  // chỉ ghim điều bất biến: nó KHÔNG được là tên miền đã chết mà ta biết chắc.
  check(
    "hằng số tên miền không còn trỏ vào .one đã dời",
    !DEFAULT_GAME_BASE_URL.includes("hoathinh3d.one"),
    DEFAULT_GAME_BASE_URL,
  );

  console.log("\nKhoá「Dừng khi đủ huyền tinh」của Mê Cung trên tài nguyên chung");

  // Mê Cung là nhiệm vụ duy nhất giữ một phiên trình duyệt hàng chục phút, và khôi lỗi tông
  // môn chỉ có vài ghế. Bỏ tick「dừng khi đủ huyền tinh」= đánh hết lượt = một đàn ngồi gần
  // trọn ngày trong đó. Nên với đạo hữu thường, luật bật lại nó; tông chủ được miễn.
  const { enforceMazeCapPolicy } = await import("../src/lib/services/configs.ts");
  const uncapped = configSchema.parse({
    quests: {
      meCung: { enabled: true, mode: "is-nightmare", kickHp: 250_000, capCheck: false },
      diemDanh: { enabled: true },
    },
  });

  const forced = enforceMazeCapPolicy(uncapped, { isAdmin: false });
  check("đạo hữu thường: tick bị bật lại", forced.quests.meCung.capCheck === true);
  check(
    "và luật KHÔNG đụng vào bất kỳ lựa chọn nào khác",
    forced.quests.meCung.mode === "is-nightmare" &&
      forced.quests.meCung.kickHp === 250_000 &&
      forced.quests.meCung.enabled === true &&
      forced.quests.diemDanh.enabled === true,
    JSON.stringify(forced.quests.meCung),
  );
  // Bản gốc phải còn nguyên: nơi gọi so tham chiếu để biết luật có ra tay không, mà một hàm
  // sửa tại chỗ thì hai vế của phép so luôn là một.
  check("luật không sửa vật gốc", uncapped.quests.meCung.capCheck === false);
  check(
    "tông chủ được miễn — bỏ tick là thật",
    enforceMazeCapPolicy(uncapped, { isAdmin: true }).quests.meCung.capCheck === false,
  );

  // saveConfigAction phân biệt "đã ghi đè" với "không phải làm gì" bằng phép so THAM CHIẾU,
  // và chỉ nói với người dùng khi thật sự có ghi đè. Hàm trả về vật mới ở ca không cần sửa
  // là biến mọi lần lưu thành một lời cảnh báo sai.
  const alreadyCapped = configSchema.parse({ quests: { meCung: { enabled: true, capCheck: true } } });
  check(
    "đã bật sẵn → trả về CHÍNH vật cũ (nơi gọi so tham chiếu để biết có ghi đè không)",
    enforceMazeCapPolicy(alreadyCapped, { isAdmin: false }) === alreadyCapped,
  );
  check(
    "tông chủ → cũng trả về chính vật cũ, không có gì để nói",
    enforceMazeCapPolicy(uncapped, { isAdmin: true }) === uncapped,
  );
  check(
    "và ca có ghi đè thì KHÁC tham chiếu",
    enforceMazeCapPolicy(uncapped, { isAdmin: false }) !== uncapped,
  );

  // Hai cửa ghi/chạy phải cùng áp luật. Soát trên nguồn vì cả hai đều là route/action cần
  // session hoặc token thật để gọi — cùng lý do và cùng cách với chốt seedLuyenDanThuong ở trên.
  const automationSrc = readFileSync(
    new URL("../src/app/actions/automation.ts", import.meta.url),
    "utf8",
  );
  // Dò `isAdminUser(...)` chứ không dò `user.role === "admin"`: vai đã thành một TẬP HỢP và
  // cột `role` sắp bị drop. Hai phép dò cũ đỏ âm thầm suốt từ lúc ấy — chúng vẫn kêu "thiếu
  // hàng rào" trong khi hàng rào có thật, chỉ là được viết bằng tên khác. Một phép thử dò
  // nguyên văn nguồn phải được sửa cùng nhịp với nguồn, nếu không nó chỉ còn là tiếng ồn.
  check(
    "đường LƯU ngọc giản áp luật theo vai của người gọi",
    /enforceMazeCapPolicy\(\s*parsed\.data,\s*\{\s*isAdmin: isAdminUser\(user\)/.test(automationSrc),
  );
  check(
    "cửa PHÁT VIỆC của khôi lỗi tông môn cũng áp luật (phủ cả document cũ)",
    /enforceMazeCapPolicy\(config, \{ isAdmin: owner !== null && isAdminUser\(owner\) \}\)/.test(workerRouteSrc) &&
      workerRouteSrc.includes('scope.kind === "operator"'),
  );
  check(
    "và khôi lỗi RIÊNG không bị luật của ghế chung",
    /if \(scope\.kind === "operator"\) \{[\s\S]{0,200}?enforceMazeCapPolicy/.test(workerRouteSrc),
  );

console.log("\nThứ tự hành sự trong MỘT vòng");

  // Chế độ song song bị gỡ ngày 12/08/2026, và lý do là thứ tự: song song biến thứ tự hành
  // sự thành thứ tự GIÀNH ĐƯỢC CỔNG, còn tông môn cần Mê Cung chạy CUỐI (tới 35 phút, giữ
  // một phòng 5 người) và Luyện Đan Đường áp chót. Chạy tuần tự thì thứ tự ấy là hệ quả
  // trực tiếp của `order` trong hồ sơ — nên chốt ngay trên hồ sơ, chứ không chốt trên một
  // lượt chạy may rủi.
  {
    const { loadProfile } = await import("../src/lib/quest-engine/profile.mjs");
    const { questsForAccount } = await import("../src/lib/quest-engine/engine.mjs");
    const base = loadProfile();

    // Bật HẾT rồi lọc theo hạng: chốt này nói về THỨ TỰ, không phải về quest nào đang bật.
    // Phải lọc theo hạng vì mỗi nhiệm vụ có CẶP SINH ĐÔI VIP/thường — bật cả hai rồi xếp
    // chung sẽ ra một danh sách nhân đôi mà không đàn nào thật sự chạy.
    const allOn = { ...base, quests: base.quests.map((q) => ({ ...q, enabled: true })) };

    for (const isVip of [true, false]) {
      const tier = isVip ? "VIP" : "thường";
      const names = questsForAccount(allOn, { isVip }).map((q) => q.name);

      check(
        `đàn ${tier}: Mê Cung là nhiệm vụ CUỐI CÙNG của một vòng`,
        names[names.length - 1] === "Mê Cung",
        names.slice(-3).join(" → "),
      );
      check(
        `đàn ${tier}: Luyện Đan Đường là áp chót`,
        names[names.length - 2] === "Luyện Đan Đường",
        names.slice(-3).join(" → "),
      );
      check(
        `đàn ${tier}: mỗi nhiệm vụ chỉ xuất hiện MỘT lần (không lẫn cặp sinh đôi)`,
        names.length === new Set(names).size,
        names.join(" · "),
      );
    }
  }

  console.log("\nChe tên trên Hàng Đợi Công Việc");

  // Trang hàng đợi cố ý cho thấy job của người khác, nên phép che này là lằn ranh riêng tư
  // duy nhất giữa hai đạo hữu — nó phải che ÍT NHẤT hai phần ba, với mọi độ dài tên, và
  // không bao giờ trả về nguyên văn.
  {
    const { maskUsername, readProgress } = await import("../src/lib/services/queue.ts");

    // Ranh giới ĐỔI PHÍA ngày 08/08/2026: tên nhiệm vụ đang chạy giờ hiện trên MỌI dòng, kể
    // cả của người khác. Trước đó chỉ con số được qua. Ghim lại chiều mới để không ai vô tình
    // dựng lại phép cắt cũ, và ghim luôn thứ KHÔNG đổi phía — tên chủ nhân vẫn phải che.
    const full = { running: ["Mê Cung", "Vấn Đáp"], done: 3, total: 8 };
    check(
      "tên nhiệm vụ hiện nguyên vẹn, không còn phụ thuộc dòng của ai",
      JSON.stringify(readProgress(full)) ===
        JSON.stringify({ running: ["Mê Cung", "Vấn Đáp"], done: 3, total: 8 }),
      JSON.stringify(readProgress(full)),
    );
    check(
      "readProgress không còn nhận tham số riêng tư nào",
      readProgress.length === 1,
      `số tham số = ${readProgress.length}`,
    );
    // Từ hôm nay chuỗi này đi lên màn hình của cả tông môn, nên một dòng jsonb méo mó làm
    // hỏng trang của tất cả chứ không của riêng ai. Trần đọc phải có răng.
    check(
      "mảng tên dài bất thường bị chặn ở trần hiển thị",
      readProgress({ running: Array.from({ length: 40 }, (_, i) => `NV${i}`), done: 0, total: 40 })
        .running.length === 12,
      String(
        readProgress({ running: Array.from({ length: 40 }, (_, i) => `NV${i}`), done: 0, total: 40 })
          .running.length,
      ),
    );
    check(
      "tên dài bất thường bị loại, tên thật đứng cạnh vẫn qua",
      JSON.stringify(
        readProgress({ running: ["x".repeat(200), "Mê Cung"], done: 0, total: 2 }).running,
      ) === JSON.stringify(["Mê Cung"]),
      JSON.stringify(readProgress({ running: ["x".repeat(200), "Mê Cung"], done: 0, total: 2 }).running),
    );

    // Cột jsonb sống lâu hơn mọi phiên bản code từng ghi vào nó. Một dòng méo mó phải thành
    // "không biết" — tức hàng đợi trông y như trước khi có tính năng này — chứ không được
    // ném ra giữa lúc dựng trang và làm trắng cả bảng.
    check("null → không biết", readProgress(null) === null);
    check("không phải object → không biết", readProgress("3/8") === null && readProgress(7) === null);
    check("mảng trần → không biết", readProgress(["Mê Cung"]) === null);
    check("thiếu số đếm → không biết", readProgress({ running: ["Mê Cung"] }) === null);
    check(
      "thiếu mảng tên → vẫn đọc được con số, tên coi như rỗng",
      JSON.stringify(readProgress({ done: 1, total: 4 })) ===
        JSON.stringify({ running: [], done: 1, total: 4 }),
      JSON.stringify(readProgress({ done: 1, total: 4 })),
    );
    check(
      "phần tử rác trong mảng tên bị loại, phần còn lại vẫn dùng được",
      JSON.stringify(readProgress({ running: ["Mê Cung", "", null, 5], done: 0, total: 2 })) ===
        JSON.stringify({ running: ["Mê Cung"], done: 0, total: 2 }),
      JSON.stringify(readProgress({ running: ["Mê Cung", "", null, 5], done: 0, total: 2 })),
    );
    const maskedShare = (name) => {
      const masked = maskUsername(name);
      const dots = [...masked].filter((c) => c === "•").length;
      return dots / [...name].length;
    };

    check("tên thường: lộ đầu, che phần còn lại", maskUsername("thiennguyen") === "thi••••••••", maskUsername("thiennguyen"));
    check(
      "mọi độ dài đều bị che ít nhất 2/3",
      ["ab", "tich", "admin", "tester", "hatruong", "trinhcongtin", "nhattieunaiha"].every(
        (name) => maskedShare(name) >= 2 / 3 - 1e-9,
      ),
      ["ab", "tich", "admin"].map((n) => `${n}→${maskUsername(n)}`).join(" "),
    );
    check("tên một ký tự không lộ gì", maskUsername("x") === "•");
    check("tên rỗng không nổ", maskUsername("") === "?" && maskUsername("   ") === "?");
    check(
      "không bao giờ trả về nguyên văn",
      ["a", "ab", "abc", "người dùng", "hacxa777._-"].every((name) => maskUsername(name) !== name),
    );
    // Đếm theo code point: cắt theo đơn vị UTF-16 sẽ chặt đôi một ký tự và ra ký tự lỗi.
    check(
      "tên có dấu/emoji không bị chặt đôi ký tự",
      !maskUsername("nguyễn🐉văn").includes("�") &&
        [...maskUsername("nguyễn🐉văn")].length === [..."nguyễn🐉văn"].length,
      maskUsername("nguyễn🐉văn"),
    );
  }

  console.log("\nHạng tài khoản");

  const { questsForAccount } = await import("../src/lib/quest-engine/engine.mjs");
  const { loadProfile } = await import("../src/lib/quest-engine/profile.mjs");

  check(
    "mọi quest trong hồ sơ đều khai hạng VIP/Thường rõ ràng",
    loadProfile().quests.every((q) => typeof q.requiresVip === "boolean"),
  );

  const shipped = loadProfile();
  /**
   * Hai twin phải giống nhau ở phần TRI THỨC VỀ SITE — từng bước, từng selector, từng ngưỡng
   * thời gian. Ba thứ được phép khác, và chỉ ba: id, hạng, và nhịp ghé lại dự phòng.
   *
   * Cái thứ ba mới thêm và nó có lý do đo được: luật trên trang boss là「mỗi 15 phút 1 lần」
   * cho tài khoản thường, còn bản ghi 06/08 trên tài khoản VIP đo được đúng một nửa (451s).
   * Cùng một kịch bản, hai nhịp — nên phép so này nới đúng một trường, không nới cả nắm.
   */
  const comparableFlow = (quest) => {
    const copy = structuredClone(quest);
    delete copy.id;
    delete copy.requiresVip;
    delete copy.fallbackCooldownSeconds;
    return JSON.stringify(copy);
  };
  const copiedPairs = [
    ["hoang-vuc", "hoang-vuc-thuong"],
    ["van-dap", "van-dap-thuong"],
    ["me-cung", "me-cung-thuong"],
    ["luyen-dan-duong", "luyen-dan-duong-thuong"],
    // Từ schema 71. Cặp này còn chặt hơn bốn cặp trên — nó không dùng tới cái nới
    // `fallbackCooldownSeconds`, và có một phép kiểm riêng dưới mục Hỷ Sự Đường canh đúng điều ấy.
    ["hy-su-duong", "hy-su-duong-thuong"],
  ];
  check(
    "năm cặp twin thường là bản sao nguyên flow VIP, chỉ đổi id/hạng/nhịp ghé lại",
    copiedPairs.every(([vipId, freeId]) => {
      const vip = shipped.quests.find((q) => q.id === vipId);
      const free = shipped.quests.find((q) => q.id === freeId);
      return vip && free && vip.requiresVip === true && free.requiresVip === false &&
        comparableFlow(vip) === comparableFlow(free);
    }),
  );
  check("tài khoản VIP chạy đủ những gì đã bật", questsForAccount(profile, { isVip: true }).length === 2);
  check(
    "tài khoản thường chạy TWIN của đúng hai quest đã bật, không đụng bản VIP",
    questsForAccount(profile, { isVip: false }).length === 2 &&
      questsForAccount(profile, { isVip: false }).every((q) => q.id.endsWith("-thuong")),
    questsForAccount(profile, { isVip: false }).map((q) => q.id).join(", "),
  );

  // Twin phải nhận CÙNG option với bản VIP — lớp dịch từng chỉ áp cho bản đầu tiên tìm
  // thấy, nghĩa là tài khoản thường chạy Mê Cung với ngưỡng trục xuất mặc định trong khi
  // người dùng đã gõ 250.000.
  const meCungFreeTwin = profile.quests.find((q) => q.id === "me-cung-thuong");
  check(
    "me-cung-thuong nhận cùng option với me-cung (kickHp tự nhập 250000)",
    meCungFreeTwin?.enabled === true &&
      meCungFreeTwin.options.find((o) => o.key === "kickHp")?.selectedValue === "250000",
    meCungFreeTwin?.options.find((o) => o.key === "kickHp")?.selectedValue,
  );

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
  // gọi hàm này; hai bên mà tự băm riêng thì lệch nhau là khoá mọi khôi lỗi ngoài cửa.
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
    // 4 = hai quest bật × cặp twin VIP/thường của mỗi quest (schema 45). Twin thường của
    // Luyện Đan sáng nhờ luật rơi-về của snapshot cũ — cfg này không mang luyenDanThuong.
    profile.quests.filter((q) => q.enabled).length === 4,
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
      withDaily.quests.filter((q) => q.name === "Tế Lễ Tông Môn").length === 2 &&
      withDaily.quests.filter((q) => q.name === "Tế Lễ Tông Môn").every((q) => q.enabled) &&
      // 8 = bốn quest bật (meCung, luyenDan, diemDanh, teLe) × cặp flow VIP/thường mỗi quest.
      withDaily.quests.filter((q) => q.enabled).length === 8 &&
      questsForAccount(withDaily, { isVip: true }).some((q) => q.id === "diem-danh") &&
      !questsForAccount(withDaily, { isVip: true }).some((q) => q.id === "diem-danh-thuong") &&
      questsForAccount(withDaily, { isVip: false }).some((q) => q.id === "diem-danh-thuong") &&
      !questsForAccount(withDaily, { isVip: false }).some((q) => q.id === "diem-danh") &&
      questsForAccount(withDaily, { isVip: false }).some((q) => q.id === "te-le-tong-mon-thuong"),
    withDaily.quests.filter((q) => q.enabled).map((q) => q.name).join(" · "),
  );
  const { loadProfile: loadProfileForSchema } = await import("../src/lib/quest-engine/profile.mjs");
  check(
    // 56 = Tế Lễ (thường) bỏ `.swal2-confirm` sang hộp xác nhận của chính site
    // `#hh3d-confirm-layer` — trang đã gỡ hẳn SweetAlert2 (bản ghi 13/08, 0 lần xuất hiện).
    // Bump ở ĐÂY là bắt buộc chứ không phải lịch sự: web đọc lại profile.json mỗi lượt nên nó
    // được vá ngay, còn bản desktop chỉ thay hồ sơ đã lưu khi schema tăng — không bump thì máy
    // nào đang ở 55 giữ nguyên selector ma và tính năng chết tiếp. Bump schema là thay hồ sơ đã
    // lưu bên desktop ngay lần mở đầu tiên — chốt này bắt mỗi cú bump phải là quyết định có chủ ý.
    // 57 = nhánh GIỮ ĐAN của Luyện Đan Đường có tiếng nói. Bước mới không đổi HÀNH VI một chút
    // nào — cùng cửa `textMatches` với lượt đóng hộp ngay dưới nó — nhưng nó vẫn phải bump:
    // desktop chỉ thay hồ sơ đã lưu khi schema tăng, và một máy đứng ở 56 sẽ tiếp tục giữ đan
    // trong im lặng. Mà im lặng chính là khiếm khuyết đang vá: ngày 14/08/2026 một báo cáo
    // 「phân giải n sao trở xuống không hoạt động」phải ghép snapshot của hai database mới trả
    // lời được, chỉ vì nhánh giữ không để lại dấu vết nào trong nhật ký.
    // 58 = Khoáng Mạch rời kiếp stub: labelMatch phỏng đoán → 45 bước thật dựng từ bản ghi
    // khoang-mach-20260814-133812, thêm twin thường + 4 option (loại khoáng, tên mỏ, đoạt
    // mỏ, ngưỡng %). Hai danh sách chặn UnavailableQuests (C#) và UNAVAILABLE_QUEST_KEYS
    // (web) cùng về rỗng trong cú bump này — quên một trong hai là quest hiện trên form mà
    // cửa phát việc vẫn ép tắt, hoặc ngược lại.
    // 59 = thêm option `minBonus` cho Khoáng Mạch: ngưỡng % bonus tu vi để CHỐT LỜI, tách hẳn
    // khỏi `hostMinBonus` (ngưỡng tiêu tiền để đoạt). Mặc định 0 = luôn nhận, nên hồ sơ đã lưu
    // không đổi hành vi — nhưng vẫn phải bump: desktop chỉ thay hồ sơ khi schema tăng, và một
    // máy đứng ở 58 sẽ không có ô nhập ngưỡng nào để mà đặt.
    // 60 = Khoáng Mạch theo bản ghi 15/08 (khoang-mach-20260815-153847, tên miền mới .so):
    // (a) option `buyPhu` — mua Linh Quang Phù thành lựa chọn riêng, TỐI ĐA 1 lá/ngày, suất
    // ngày ghi ở cổng quyết định; (b) mua/đoạt CHỈ chạy khi khai thác đã Đạt tối đa (cờ
    // jvz-km-ripe, quét dòng mình TRƯỚC mọi hành động); (c) trần ngày đọc từ .stats-container
    // (.stat-tuvi/.stat-tinhthach — selector đích danh thay cho quét chữ toàn body), và mọi
    // dấu vết「tối đa 2 lần/ngày」bị gỡ: trần 15/08 là 600/200, tức BA lần nhận.
    // 61 = Hỷ Sự Đường thôi bỏ sót phòng (bản ghi hy-su-duong-20260815-205221): mỗi phòng tự
    // chịu kết cục của mình — mọi bước TRONG phòng thành tuỳ chọn, thêm bước phán xử ghi
    // ok/skip/fail vào sổ, nên một phòng lạ không còn giết những phòng chưa ai ghé (sự cố có
    // thật: "repeat vòng 3: Trang chưa dựng xong sau 25s"). Kèm theo: duyệt ĐÚNG thứ tự danh
    // sách thay vì đẩy /hong-nhan xuống cuối, trần vòng 15 → 40 (bản ghi đếm 8 tiệc mở cùng
    // lúc, chạm trần là bỏ sót trong im lặng), và cờ jvz-hy-su-all-failed để "trượt sạch" vẫn
    // là một lượt hỏng thật chứ không phải một lượt báo xong.
    // 64 = Mê Cung thôi nghỉ một giờ giữa hai đợt đánh (đàn 9f646e8a, 16/08/2026): (a) bước
    // cuối là `readCooldownSeconds` script `() => 60`, vì mê cung KHÔNG có đồng hồ của máy chủ
    // — hết vòng nghĩa là còn việc ngay bây giờ, mà thiếu bước ấy thì `completed` rơi về
    // FallbackCooldownSeconds = 3600 và runner ngủ trọn tiếng; ngả「đã đủ huyền tinh」dừng ở
    // StopIf phía trên nên không chạm bước này và vẫn giữ một giờ. (b) trần vòng ngoài 6 → 18:
    // một lượt 5 ải dài từ ~2 tới ~11 phút, nên trần 6 luôn nổ TRƯỚC trần 35 phút và vứt đi một
    // phòng 5 người còn sống — mà dựng lại phòng ấy mới là phần đắt.
    // 65 = Khoáng Mạch nghe lời xác nhận đoạt mỏ Ở NGẢ MẠNG (đàn thật 17/08/2026): cú đoạt
    // THÀNH trong game — bonus mỏ đổi 100% → 55%, chu kỳ đào reset — mà tám giây chờ chữ
    //「đoạt thành công」trên `body` trắng trơn, nên lượt ấy tự khai「KHÔNG thành」và bỏ luôn lá
    // phù. Câu ấy vốn là THÂN TRẢ LỜI AJAX (đúng như network.json của bản ghi 14/08 ghi), thứ
    // không có nghĩa vụ nào phải vào DOM. Nay một bước gài tai nghe (fetch + XHR + node mới
    // chèn) đứng TRƯỚC cú bấm Xác nhận và cắm cờ `jvz-km-won`; cờ ấy ngang hàng với phép đọc
    // DOM cũ. Kèm hai chỗ nhỏ mà thiếu là hỏng cả bản vá: bước chờ đổi `When` sang
    // `body.jvz-km-host-go` (cú AJAX vẽ lại sổ và cuốn mất `.jvz-km-doat` — cái chờ sẽ bị bỏ
    // qua đúng ở ca thành công), và câu「không thành」nay kéo theo 120 ký tự đầu của thứ trang
    // vừa trả lời, để lần sau site đổi lời văn thì nhật ký tự khai thay vì than câm.
    // 66 = thêm nhiệm vụ Phần Thưởng Hoạt Động, hai twin VIP/thường dùng chung một script
    // (bản ghi phan-thuong-hoat-dong-20260817-022120). Hai rương mốc 75%/100% nằm ở THÂN
    // trang nhiệm vụ ngày, không phải nút quick-click, nên không có selector nào phụ thuộc
    // hạng. Order 99: sau BỐN nhiệm vụ đếm tiến độ (Vấn Đáp là cái cuối, order 90) nhưng
    // trước Khoáng Mạch/Luyện Đan/Mê Cung — mọi thứ trong「Hoạt Động Khác」không cộng vào %,
    // nên xếp nó sau Mê Cung chỉ tổ bắt hai cú bấm xếp hàng sau 35 phút. Ngả duy nhất
    // vào sổ ngày là「cả hai thẻ đều .claimed」; còn khoá thì 30 phút, không thấy mục thì 60
    // phút — hai cảnh ấy mà nhớ thành「hết ngày」là khoá mất đúng cái rương sắp mở.
    // 67 = Bí Cảnh Tông Môn có bản THƯỜNG (bản ghi bi-canh-tong-mon-20260818-013136, quay trên
    // tài khoản thường thật). Bản VIP bấm nút quick-click #nv-btm-attack-btn mà hub CHỈ vẽ cho
    // hạng VIP — sổ probe của bản ghi khai「no match」ở mọi lượt lấy mẫu trên một tài khoản đánh
    // được — nên bản thường là một quest riêng đi trang /bi-canh-tong-mon/?nv_embed=1 (URL trần
    // trả 503, đúng hình dạng Khoáng Mạch). Vỏ trang không có nút nào, boss-system.js vẽ tất cả,
    // và cả ba lời khai nằm trên CÙNG nút #challenge-boss-btn: "KHIÊU CHIẾN" / "Còn M:SS" /
    // "Hết lượt hôm nay". Nhân chứng sau cú Tấn Công hỏi CHỮ (":|hết lượt") chứ không hỏi
    // `disabled`: nút KHÔNG được vẽ cũng thoả disabled, đúng cái bẫy đã làm Hoang Vực báo xong
    // cho một trận chưa từng đánh.
    // 68 = Hoang Vực lĩnh phần thưởng treo TRƯỚC khi khiêu chiến (bản ghi
    // hoang-vuc-20260818-013720). Boss đời trước bị hạ mà thưởng mốc sát thương chưa lĩnh thì
    // trang thay #battle-button bằng #reward-button, và bỏ luôn #change-element-button,
    // .remaining-attacks, #countdown-timer — probes.json của bản ghi đo đủ cả bốn. Kịch bản cũ
    // rơi vào lưới cuối「nút KHIÊU CHIẾN không có trên trang」— một StopIf KHÔNG đồng hồ, tức
    // alreadyDone — mà hoang-vuc nằm trong DAILY_QUOTA_QUEST_IDS nên lượt ấy KHOÁ CẢ NGÀY:
    // thưởng không ai lĩnh, 5 lượt đánh của boss mới mất trắng. Nay lĩnh xong thì tự navigate
    // lại để đọc boss mới, rồi đi tiếp đúng cụm khiêu chiến cũ.
    // 70 = Hỷ Sự Đường khai được hồng bao ở CẢ phòng Đạo Lữ (bản ghi
    // hy-su-duong-20260819-110345). Cụm hồng bao của schema 69 chỉ biết bộ id #hn* của Hồng
    // Nhan; phòng Đạo Lữ dùng bộ id trần #liXiModal · #openButton · #closeButton và thiệp
    // #rewardReveal > #rewardItem, nên flow vào tới nơi rồi đứng nhìn cái khay. Cùng endpoint,
    // cùng hình dạng, chỉ khác tên — nên bản vá là một phép HỢP SELECTOR, không phải nhánh mới.
    // (Nhãn dòng dưới trước đây ghi 68 trong khi phép so hỏi 69 — sửa luôn cho khớp.)
    // 72 = Hỷ Sự Đường bấm thêm nút「Mở Lì Xì Nhanh」bên cạnh việc ghé từng phòng — ghi chú của
    // tông chủ trong bản ghi hy-su-duong-20260822-222109: "ngoài việc vào từng phòng nhận lì xì
    // thì chúng ta còn phải check thêm button mở lì xì nhanh nữa nhé, kết hợp cả 2 luôn mới ko
    // sót phòng nào". Bằng chứng ở ngay thân trả lời show_all_wedding của bản ghi ấy:
    // unopened_li_xi_count = 1 trong khi CẢ HAI phòng đang hiện đều khai has_li_xi = false — tức
    // có lì xì không còn phòng nào trong danh sách nhận, ghé hết vẫn sót đúng nó. Cụm đứng TRƯỚC
    // hai cổng StopIf, vì ngày「đã chúc hết」chính là ngày StopIf kết thúc nhiệm vụ sớm. Vào CẢ
    // HAI twin dù nút mang huy hiệu VIP: nó gác bằng cờ DOM (jvz-hy-su-quick) chứ không bằng
    // requiresVip — hạng là phỏng đoán của ta, còn cái nút là quyết định của site. Lưới riêng:
    // npm run verify:hy-su-quick.
    // 73 = Mê Cung thôi đuổi sạch cả đội ngay sau hiệp đầu (đàn c242fcb5, 22/08/2026). Đồng hồ
    // "không sẵn sàng" vốn đếm từ lúc THẤY NGƯỜI LẦN ĐẦU và không bao giờ đặt lại, nên hết trận
    // cả đội về sảnh là đã 155s > ngưỡng 20s và bị đuổi hết — nhật ký đàn ấy ghi đúng bốn dòng
    // Trục xuất cùng một giây với dòng "Xong lượt đánh". Nay đồng hồ về 0 ở đầu MỖI VÒNG và mỗi
    // khi người ấy đang sẵn sàng, nên nó đo đúng cái tên nó mang. Kèm hai chỗ nữa cùng gốc: sổ
    // rương + cờ trận đánh nay cũng về trắng mỗi vòng (không thì vòng hụt đội vẫn báo lại con số
    // của vòng trước — đàn ấy in "142/860 (+142)" hai lần trong khi tổng không nhúc nhích), và
    // hai vòng liền không lập được đội thì cắm cờ jvz-mc-noteam cho vòng ngoài thoát sớm thay vì
    // giữ trọn 35 phút ngân sách — chính cái tông chủ thấy thành "đàn treo". Lưới riêng:
    // npm run verify:maze-kick.
    "hồ sơ đang ở schema 73",
    loadProfileForSchema().schemaVersion === 73,
    String(loadProfileForSchema().schemaVersion),
  );

  console.log("\nMê Cung phải RA KHỎI PHÒNG trước khi mở phòng mới");

  // Bản ghi 11/08/2026 (me-cung-bonus-20260811-153934) chụp DOM ở hai thời điểm và cả hai đều
  // có đủ #lobby-overview, #btn-disband-room, #btn-start, #btn-leave-room — trang chỉ bật/tắt
  // class `hidden`. Nên bước cũ `waitForSelector #lobby-overview` QUA NGAY LẬP TỨC kể cả khi
  // còn kẹt trong phòng, và lượt chạy đi thẳng xuống bấm "Lập Đội" trên một cái nút bị che.
  // Ba chốt dưới đây giữ đúng chỗ ấy: cổng phải HỎI HIỂN THỊ, phải chặn thật, và phải đứng
  // trước cú bấm tạo phòng.
  for (const mazeId of ["me-cung", "me-cung-thuong"]) {
    const maze = loadProfileForSchema().quests.find((q) => q.id === mazeId);
    const gateAt = maze.steps.findIndex(
      (s) => s.condition?.selector === "#lobby-overview" && s.condition?.kind === "visible",
    );
    const createAt = maze.steps.findIndex(
      (s) => s.action === "click" && s.selector === "#lobby-overview .btn-create-room",
    );

    check(
      `${mazeId}: cổng vào sảnh hỏi HIỂN THỊ, không phải chỉ có mặt trong DOM`,
      gateAt >= 0 && maze.steps[gateAt].action === "waitForCondition",
      maze.steps[gateAt]?.action ?? "(không có cổng nào)",
    );
    check(
      `${mazeId}: cổng ấy KHÔNG optional — không ra nổi khỏi phòng thì phải hỏng ồn ào`,
      gateAt >= 0 && maze.steps[gateAt].optional !== true,
      String(maze.steps[gateAt]?.optional),
    );
    check(
      `${mazeId}: cổng đứng TRƯỚC cú bấm "Lập Đội"`,
      gateAt >= 0 && createAt > gateAt,
      `cổng@${gateAt} < tạo phòng@${createAt}`,
    );
    check(
      `${mazeId}: KHÔNG còn bước waitForSelector nào trên #lobby-overview`,
      !maze.steps.some((s) => s.action === "waitForSelector" && s.selector === "#lobby-overview"),
    );

    // Site phát hai nút ra khỏi phòng: "Giải Tán" cho chủ phòng, "Rời Phòng" cho thành viên.
    // Chỉ soi nút giải tán thì một tài khoản lỡ vào phòng người khác kẹt lại vĩnh viễn.
    const detect = maze.steps.find(
      (s) => s.action === "waitForCondition" && s.condition?.selector?.includes("#btn-disband-room"),
    );
    check(
      `${mazeId}: lượt dò kẹt-trong-phòng soi cả hai lối ra`,
      detect?.condition?.selector?.includes("#btn-leave-room") === true,
      detect?.condition?.selector,
    );
    const leave = maze.steps.find((s) => s.action === "click" && s.selector === "#btn-leave-room");
    check(
      `${mazeId}: có bước rời phòng của thành viên, và nó gác theo hiển thị`,
      leave?.when?.kind === "visible" && leave?.when?.selector === "#btn-leave-room",
      JSON.stringify(leave?.when),
    );
    const disband = maze.steps.find(
      (s) => s.action === "click" && s.selector === "#btn-disband-room",
    );
    check(
      `${mazeId}: bước giải tán cũng gác theo hiển thị — hai lối không dẫm nhau`,
      disband?.when?.kind === "visible" && disband?.when?.selector === "#btn-disband-room",
      JSON.stringify(disband?.when),
    );

    // ── Ghé lại sau một phút, không phải sau một giờ (schema 64) ───────────────────────
    //
    // Mê cung không có đồng hồ của máy chủ: hết vòng nghĩa là CÒN việc ngay bây giờ. Thiếu
    // bước cuối này thì `completed` rơi về fallbackCooldownSeconds = 3600 và đàn ngủ trọn
    // tiếng giữa hai đợt đánh — đúng chuyện tông chủ báo ngày 16/08/2026.
    const resume = maze.steps[maze.steps.length - 1];
    check(
      `${mazeId}: bước CUỐI script là bước tự khai đồng hồ ghé lại`,
      resume?.action === "readCooldownSeconds" && typeof resume?.script === "string",
      `${resume?.action} / script ${typeof resume?.script}`,
    );
    // Biên dịch và GỌI THẬT, cùng lối với các script khác của bộ này: một đoạn JS nằm trong
    // JSON thì không trình biên dịch nào soi hộ.
    let resumeSeconds = null;
    try {
      resumeSeconds = new Function(`return (${resume.script});`)()();
    } catch (err) {
      resumeSeconds = `KHÔNG BIÊN DỊCH ĐƯỢC: ${err.message}`;
    }
    check(
      `${mazeId}: nó trả một con số đủ nhanh để đánh tiếp, và trên sàn 30s của bộ lập lịch`,
      typeof resumeSeconds === "number" && resumeSeconds >= 30 && resumeSeconds <= 300,
      String(resumeSeconds),
    );
    // Thứ tự là cả tính đúng đắn: phải trả phòng TRƯỚC khi hứa quay lại, và cổng「đã đủ huyền
    // tinh」phải đứng trước để ngả ấy dừng ở stopIf mà không bao giờ chạm bước này — đó là
    // cách một giờ được giữ nguyên cho ngày đã xong.
    const disbandAt = maze.steps.findIndex(
      (s, i) => s.action === "click" && s.selector === "#btn-disband-room" && i > gateAt,
    );
    const capStopAt = maze.steps.findIndex(
      (s) => s.action === "stopIf" && s.condition?.selector?.includes("jvz-cap-full"),
    );
    check(
      `${mazeId}: bước ghé lại đứng SAU cú giải tán phòng cuối script`,
      disbandAt >= 0 && disbandAt < maze.steps.length - 1,
      `giải tán@${disbandAt} < ghé lại@${maze.steps.length - 1}`,
    );
    check(
      `${mazeId}: cổng「đã đủ huyền tinh」đứng TRƯỚC — ngả ấy dừng ở stopIf, giữ nguyên trần một giờ`,
      capStopAt >= 0 && capStopAt < maze.steps.length - 1,
      `cổng@${capStopAt}`,
    );

    // Trần vòng KHÔNG được là thứ chặn trước: một lượt 5 ải dài ~2–11 phút, nên trần 6 cũ luôn
    // nổ trước trần 35 phút và vứt đi một phòng 5 người còn sống (đàn 9f646e8a, 16/08/2026 —
    // sáu lượt xong lúc 14:31:39 · 14:34:02 · 14:40:47 · 14:42:58 · 14:56:22 · 15:07:38).
    const rounds = maze.steps.find(
      (s) => s.action === "repeat" && s.until?.selector?.includes("jvz-cap-full"),
    );
    check(
      `${mazeId}: trần vòng ngoài rộng hơn số lượt mà 35 phút chứa nổi — thời gian mới là hạn mức`,
      rounds?.maxIterations >= Math.ceil(rounds?.maxSeconds / 120),
      `${rounds?.maxIterations} vòng / ${rounds?.maxSeconds}s`,
    );
  }

  console.log("\nMê Cung đọc trần huyền tinh từ PHẢN HỒI RƯƠNG");

  // Ba đoạn script này là JavaScript nằm trong JSON: không trình biên dịch nào nhìn thấy chúng,
  // nên một dấu ngoặc lệch sẽ im lặng cho tới lúc đàn chạy thật trên VM. Ở đây chúng được biên
  // dịch bằng `new Function` rồi GỌI THẬT trên một DOM giả — cùng lối với các fixture khác của
  // bộ này: phép kiểm phải chạy đúng đoạn mã sẽ chạy, không phải một bản chép lại.
  {
    const mazeProfile = loadProfileForSchema();
    const maze = mazeProfile.quests.find((q) => q.id === "me-cung");
    const loopStep = maze.steps.find(
      (s) => s.action === "repeat" && s.until?.selector?.includes("jvz-cap-full"));
    const hookSrc = loopStep.steps.find((s) => (s.script || "").includes("__jvzChestHook"))?.script;
    const readSrc = loopStep.steps.find(
      (s) => (s.script || "").includes("__jvz_mc_chest") && !(s.script || "").includes("__jvzChestHook"))?.script;
    const lobbySrc = maze.steps.find(
      (s) => s.action === "evaluateJavaScript" && (s.script || "").includes("cap-scan"))?.script;

    for (const [label, src] of [["tai nghe rương", hookSrc], ["đọc rương", readSrc], ["quét ở sảnh", lobbySrc]]) {
      let err = null;
      try { new Function(`return (${src});`); } catch (e) { err = e.message; }
      check(`${label}: biên dịch được`, src !== undefined && err === null, err ?? "");
    }

    const fakeEnv = (dailyText) => {
      const classList = () => {
        const set = new Set();
        return { add: (c) => set.add(c), remove: (c) => set.delete(c), has: (c) => set.has(c) };
      };
      const body = { classList: classList() };
      const counter = dailyText === null ? null : { textContent: dailyText, classList: classList() };
      const store = new Map();
      return {
        body,
        storage: {
          getItem: (k) => (store.has(k) ? store.get(k) : null),
          setItem: (k, v) => store.set(k, String(v)),
          removeItem: (k) => store.delete(k),
        },
        doc: {
          body,
          querySelectorAll: (sel) => (sel === ".mc-ht-daily-text" && counter ? [counter] : []),
          querySelector: (sel) => (sel === ".mc-ht-daily-text" ? counter : null),
        },
      };
    };
    const runScript = (src, env, capCheck, win = {}) =>
      new Function("document", "sessionStorage", "window", `return (${src.split("{{capCheck}}").join(capCheck)});`)(
        env.doc, env.storage, win)();
    const capped = (env) => env.body.classList.has("jvz-cap-full");
    const CAP_ON = "đủ trần ngày";
    const CAP_OFF = "«không kiểm tra»";

    // Đúng con số máy chủ trả về trong bản ghi 11/08: rương RỖNG vì đã đầy trần từ trước —
    // 2 phút đánh cho ra số 0 ở cả sáu ô vật phẩm.
    {
      const env = fakeEnv("Hôm nay đã nhận 385/385 Huyền Tinh");
      env.storage.setItem("__jvz_mc_chest",
        JSON.stringify({ total: 385, cap: 385, gain: 0, already: true, at: Date.now() }));
      const said = runScript(readSrc, env, CAP_ON);
      check("rương báo 385/385 đã đầy → cắm cờ dừng", capped(env));
      check("…và nói ra là rương rỗng", said.includes("rương rỗng"), said);
    }
    {
      const env = fakeEnv("Hôm nay đã nhận 120/385 Huyền Tinh");
      env.storage.setItem("__jvz_mc_chest",
        JSON.stringify({ total: 120, cap: 385, gain: 35, already: false, at: Date.now() }));
      const said = runScript(readSrc, env, CAP_ON);
      check("chưa đầy → KHÔNG cắm cờ", !capped(env));
      check("…và kể đúng phần vừa được cộng", said.includes("(+35)"), said);
    }
    {
      const env = fakeEnv("Hôm nay đã nhận 385/385 Huyền Tinh");
      env.storage.setItem("__jvz_mc_chest",
        JSON.stringify({ total: 385, cap: 385, gain: 0, already: true, at: Date.now() }));
      check("tắt kiểm tra thì đầy trần cũng không dừng",
        (runScript(readSrc, env, CAP_OFF), !capped(env)));
    }
    // Đường lui: hiệp không lĩnh được rương (đội thua ải, tắt tự mở rương) thì mất bản tin,
    // nhưng KHÔNG được mất luôn cái cổng chặn.
    {
      const env = fakeEnv("Hôm nay đã nhận 1.200/1.200 Huyền Tinh");
      const said = runScript(readSrc, env, CAP_ON);
      check("không có số rương → lui về đọc trang, vẫn chặn được", capped(env), said);
      check("…và dấu chấm hàng nghìn không hoá 1.200/1.200 thành 200/1",
        said.includes("1200/1200"), said);
    }
    {
      const env = fakeEnv(null);
      runScript(readSrc, env, CAP_ON);
      check("không rương, không ô chữ → KHÔNG cắm cờ bừa", !capped(env));
    }
    {
      const env = fakeEnv("Hôm nay đã nhận 385/385 Huyền Tinh");
      env.storage.setItem("__jvz_mc_chest", "{ hỏng");
      check("sessionStorage hỏng → không ném, vẫn lui về đọc trang",
        (runScript(readSrc, env, CAP_ON), capped(env)));
    }

    // Tai nghe: chạy thật với một fetch giả, xem nó có cất đúng số của máy chủ không.
    {
      const env = fakeEnv("Hôm nay đã nhận 0/385 Huyền Tinh");
      const reward = {
        huyen_tinh: 0, huyen_tinh_daily_total: 385, huyen_tinh_daily_cap: 385, already_got_items: true,
      };
      const response = { clone: () => ({ json: async () => ({ success: true, reward }) }) };
      let passedThrough = 0;
      const win = { fetch: async (u) => { passedThrough++; return response; } };
      const said = runScript(hookSrc, env, CAP_ON, win);
      check("tai nghe gắn được", said.includes("đã gắn"), said);

      await win.fetch("https://hoathinh3d.one/wp-json/me-cung/v1/claim-boss5-chest");
      await new Promise((r) => setTimeout(r, 10));
      const stored = JSON.parse(env.storage.getItem("__jvz_mc_chest") || "null");
      check("bắt được phản hồi rương và cất đúng số",
        stored?.total === 385 && stored?.cap === 385 && stored?.already === true,
        JSON.stringify(stored));

      await win.fetch("https://hoathinh3d.one/wp-json/me-cung/v1/attack");
      check("lời gọi KHÁC vẫn đi qua nguyên vẹn, không bị nuốt", passedThrough === 2, String(passedThrough));

      check("gắn hai lần là no-op", runScript(hookSrc, env, CAP_ON, win) === "");
    }

    // Sảnh: xoá số của lượt ghé trước, rồi vẫn phải tự quyết được có mở phòng hay không.
    {
      const env = fakeEnv("Hôm nay đã nhận 10/385 Huyền Tinh");
      env.storage.setItem("__jvz_mc_chest",
        JSON.stringify({ total: 385, cap: 385, gain: 0, already: true, at: 1 }));
      runScript(lobbySrc, env, CAP_ON);
      check("sảnh xoá số rương của lượt ghé trước",
        env.storage.getItem("__jvz_mc_chest") === null);
      check("sảnh: chưa đầy → cho mở phòng", !capped(env));
    }
    {
      const env = fakeEnv("Hôm nay đã nhận 385/385 Huyền Tinh");
      runScript(lobbySrc, env, CAP_ON);
      check("sảnh: đã đầy → cắm cờ để stopIf chặn ngay, khỏi mở phòng", capped(env));
    }
  }

  console.log("\nBản desktop phải mang ĐÚNG những đoạn script ấy, không phải bản chép tay");

  // Ba đoạn script Mê Cung sống ở HAI nơi: hồ sơ này, và DefaultQuestProfile.cs bên desktop.
  // Chúng là JavaScript trong chuỗi, nên không có trình biên dịch nào bắt được lúc chúng lệch
  // nhau — chỉ có đàn chạy sai vào một ngày nào đó. Chốt này so từng byte.
  //
  // Bỏ qua khi không thấy repo desktop nằm cạnh: bộ smoke này còn chạy ở nơi chỉ có repo web.
  {
    const pcProfile = path.resolve(
      process.cwd(), "..", "jarvis-hh3d-pc", "src", "JarvisHH3D.Infrastructure", "Quests",
      "DefaultQuestProfile.cs");

    if (!existsSync(pcProfile)) {
      console.log(`  … bỏ qua: không thấy ${pcProfile}`);
    } else {
      const cs = readFileSync(pcProfile, "utf8");
      const maze = loadProfileForSchema().quests.find((q) => q.id === "me-cung");
      const loopStep = maze.steps.find(
        (s) => s.action === "repeat" && s.until?.selector?.includes("jvz-cap-full"));

      // Hỷ Sự Đường: bốn đoạn nằm rải cả ở cấp cao lẫn trong thân vòng lặp, nên gom bằng một
      // lượt duyệt đệ quy thay vì đoán chỉ số.
      const wedding = loadProfileForSchema().quests.find((q) => q.id.startsWith("hy-su-duong"));
      const allSteps = (steps) =>
        steps.flatMap((s) => [s, ...(Array.isArray(s.steps) ? allSteps(s.steps) : [])]);
      const weddingScript = (needle, not) =>
        allSteps(wedding.steps).find(
          (s) => (s.script || "").includes(needle) && (!not || !(s.script || "").includes(not)))?.script;

      const pairs = [
        ["MazeChestHookScript", loopStep.steps.find((s) => (s.script || "").includes("__jvzChestHook"))?.script],
        ["MazeChestReadScript", loopStep.steps.find(
          (s) => (s.script || "").includes("__jvz_mc_chest") && !(s.script || "").includes("__jvzChestHook"))?.script],
        ["MazeCapScanScript", maze.steps.find(
          (s) => s.action === "evaluateJavaScript" && (s.script || "").includes("cap-scan"))?.script],
        ["WeddingResetSeenScript", weddingScript("sổ kết cục được xoá")],
        ["WeddingTallyScript", weddingScript("jvz-hy-su-done")],
        ["WeddingPickRoomScript", weddingScript("location.assign")],
        ["WeddingRoomStateScript", weddingScript("jvz-can-bless")],
        ["WeddingVerdictScript", weddingScript("GỬI TRƯỢT")],
      ];

      // Sáu đoạn script Khoáng Mạch (schema 58) — cùng số phận hai-nơi-một-luật với Mê Cung.
      // Twin thường dùng CHUNG steps nên chỉ cần so bản VIP.
      const km = loadProfileForSchema().quests.find((q) => q.id === "khoang-mach");
      const kmSteps = allSteps(km.steps);
      const kmScript = (needle, not) =>
        kmSteps.find(
          (s) => (s.script || "").includes(needle) && (!not || !(s.script || "").includes(not)))?.script;
      pairs.push(
        ["KmCapScanScript", kmScript("jvz-km-done")],
        ["KmPickMineScript", kmScript("jvz-km-usable")],
        ["KmSelfScanScript", kmScript("jvz-km-self-seen", "rescan:")],
        ["KmHostGateScript", kmScript("jvz-km-buy-go")],
        ["KmHostScanScript", kmScript("jvz-km-host-go", "jvz-km-buy-go")],
        // Tìm theo phép CẮM cờ chứ không theo tên cờ: cổng cũng nhắc `jvz-km-buy-now` (nó gỡ cờ
        // ở dòng đầu), nên một `needle` trần sẽ bắt nhầm cổng — cổng đứng trước trong danh sách bước.
        ["KmHostWonScript", kmScript("classList.add('jvz-km-buy-now')")],
        ["KmShopMarkScript", kmScript("jvz-km-buy", "jvz-km-buy-go")],
        ["KmRescanResetScript", kmScript("rescan:")],
        ["KmTailScript", kmScript("jvz-km-eta", "jvz-km-self-seen")],
      );

      for (const [name, webScript] of pairs) {
        // Hằng số một dòng: `private const string <Tên> =` rồi """…""" ở dòng kế.
        const m = cs.match(new RegExp(`private const string ${name} =\\s*\\r?\\n\\s*"""([\\s\\S]*?)""";`));
        check(`${name}: có trong DefaultQuestProfile.cs`, m !== null);
        if (!m || webScript === undefined) continue;
        check(
          `${name}: khớp TỪNG BYTE với hồ sơ web`,
          m[1] === webScript,
          m[1] === webScript ? "" : `desktop ${m[1].length} ký tự vs web ${webScript.length}`);
      }

      const schemaInCs = cs.match(/CurrentSchemaVersion = (\d+);/);
      check(
        "schema của desktop bằng schema của hồ sơ web",
        schemaInCs !== null && Number(schemaInCs[1]) === loadProfileForSchema().schemaVersion,
        `desktop ${schemaInCs?.[1]} vs web ${loadProfileForSchema().schemaVersion}`);

      // Cổng ở sảnh và until của vòng hiệp phải hỏi CÙNG MỘT câu VỀ CỜ ĐẦY TRẦN — hỏi lệch
      // nhau là một trong hai chỗ mù, và đó là lỗi phép kiểm này sinh ra để bắt.
      // Từ schema 73 vòng hiệp được phép mang THÊM lý do thoát (`body.jvz-mc-noteam` — hai vòng
      // liền không lập được đội thì trả đàn về cho nhiệm vụ khác thay vì giữ trọn 35 phút), nên
      // phép so hỏi TIỀN TỐ chứ không đòi hai chuỗi khớp byte. Vẫn đòi đủ HAI chỗ.
      const wanted = "body.jvz-cap-full, .mc-ht-daily-text.jvz-cap-full";
      const capGates = cs.split(`Selector = "${wanted}`).length - 1;
      check(
        "desktop dùng đúng selector cờ đầy trần ở cả hai chỗ",
        capGates === 2,
        String(capGates));
      check(
        "desktop KHÔNG còn so chuỗi 385/385 làm điều kiện",
        !cs.includes('Text = "{{capCheck}}"'));
    }
  }

  console.log("\nHoang Vực phải CHỨNG MINH đòn đánh đã được ghi nhận");

  // Sự cố 06/08: nhật ký báo「Hoang Vực: xong」suốt đêm, cứ 7 phút một lần — đúng bằng
  // fallbackCooldownSeconds, tức không lần nào đọc được đồng hồ — trong khi「Lượt đánh còn
  // lại」đứng nguyên ở 5. Nguyên nhân: sau cú bấm Tấn Công, MỌI bước đều `optional`, nên một
  // cú bấm rơi vào hư không cho ra y hệt một trận đánh thật.
  for (const bossId of ["hoang-vuc", "hoang-vuc-thuong"]) {
    const boss = loadProfileForSchema().quests.find((q) => q.id === bossId);
    const attackAt = boss.steps.findIndex(
      (s) => s.action === "click" && s.selector === "#boss-damage-screen .attack-button",
    );
    const confirm = boss.steps[attackAt + 1];
    check(
      `${bossId}: ngay sau cú bấm Tấn Công là một bước xác nhận`,
      attackAt >= 0 &&
        confirm?.action === "waitForCondition" &&
        confirm.condition?.kind === "hidden" &&
        confirm.condition?.selector === "#battle-button",
      JSON.stringify(confirm?.condition ?? confirm),
    );
    // Đây là cả sự khác biệt giữa bản đã sửa và bản gây ra sự cố. Một chữ `optional` ở đây là
    // quay lại đúng cái im lặng cũ.
    check(
      `${bossId}: và bước ấy KHÔNG optional — trượt thì phải hỏng to`,
      confirm?.optional !== true,
      `optional=${confirm?.optional}`,
    );
    // Nhật ký 07/08 01:03:55: 45s không sống nổi cạnh một trận Mê Cung đủ đội trên VM hai
    // nhân — hoạt ảnh của tab bị bỏ đói CPU chạy chưa xong thì bằng chứng chưa xuất hiện.
    // 120s = 10× mốc 12s đo trên tab rảnh; teo con số này lại là mở cửa cho đúng đêm lỗi ấy
    // quay về, nên sàn của nó bị đóng đinh ở đây.
    check(
      `${bossId}: ngân sách bằng chứng chịu được tab bị bỏ đói CPU (>= 120s)`,
      (confirm?.timeoutMs ?? 0) >= 120000,
      `timeoutMs=${confirm?.timeoutMs}`,
    );
  }

  console.log("\nNgọc giản đi trước engine thì phải kêu lên");

  // Nếu câu cảnh báo này có mặt từ đầu, cả cuộc truy vết Hỷ Sự Đường đêm 06/08 đã gói gọn
  // trong một dòng nhật ký thay vì phải lần ngược snapshot trong database.
  {
    const notes = [];
    profileForConfig(
      { ...cfg, quests: { ...cfg.quests, nhiemVuTuongLai: { enabled: true } } },
      (m) => notes.push(m),
    );
    check(
      "bật một nhiệm vụ engine không biết → nói thẳng là khôi lỗi đang chạy gói cũ",
      notes.some((n) => n.includes("nhiemVuTuongLai") && n.includes("gói cũ")),
      notes.join(" / ") || "(im lặng)",
    );

    const quiet = [];
    profileForConfig(
      { ...cfg, quests: { ...cfg.quests, hySuDuong: { enabled: true } } },
      (m) => quiet.push(m),
    );
    check(
      "còn nhiệm vụ engine BIẾT thì không cảnh báo gì",
      !quiet.some((n) => n.includes("gói cũ")),
      quiet.join(" / ") || "(sạch)",
    );
    // Tắt cũng không được kêu: chỉ nhiệm vụ đang BẬT mà chạy hụt mới là chuyện đáng nói.
    const offNotes = [];
    profileForConfig(
      { ...cfg, quests: { ...cfg.quests, nhiemVuTuongLai: { enabled: false } } },
      (m) => offNotes.push(m),
    );
    check(
      "khoá lạ nhưng đang TẮT thì im lặng",
      !offNotes.some((n) => n.includes("nhiemVuTuongLai")),
      offNotes.join(" / ") || "(sạch)",
    );
  }

  // --- kiểm trên trang thật ---------------------------------------------------------
  let teLeOffered = false;

  // Bí Cảnh Tông Môn (bản thường) — trạng thái của trang boss và của hàng trên hub, đặt riêng
  // từng ca. `btmHits` đếm số lượt trang boss được tải: nó là bằng chứng cho phép thử「dừng ở
  // hub thì KHÔNG mở trang boss」, thứ không đọc được từ kết cục của lượt chạy.
  let btmState = "ready";
  let btmBroken = false;
  let btmLastTurn = false;
  let btmHubSpent = false;
  let btmHits = 0;
  const btmAttacks = [];

  // Khoáng Mạch — trạng thái server giả, khớp nhịp thật của site: chu kỳ đào CHÍN GIỮA HAI
  // LƯỢT GHÉ (engine không ngồi chờ 30 phút), nên mỗi GET trang khi đang-ở-trong-mỏ là một
  // lần tua nhanh tới「Đạt tối đa」. Thưởng lượt 1 = 270 Tu Vi + 100 Tinh Thạch (con số thật
  // từ d2f1b1d5), lượt 2 chạm trần 300/100 — đúng ghi chú「tối đa 2 lần nhận/ngày」.
  // `seizeSays` — trang nói lời xác nhận đoạt mỏ Ở ĐÂU. Mặc định `net`, vì đó là thứ đàn thật
  // gặp ngày 17/08/2026: cú đoạt THÀNH trong game mà tám giây chờ chữ trên DOM trắng trơn —
  // câu「Đã đoạt thành công quyền chủ mỏ.」chỉ có trong THÂN TRẢ LỜI AJAX (đúng như network.json
  // của bản ghi 14/08 đã ghi, và fixture đời đầu đã đọc nhầm thành một toast).
  //   net  — chỉ AJAX, không vẽ gì ra DOM (production)
  //   dom  — vẽ toast, AJAX chỉ "ok" (đường cũ, phải còn sống)
  //   khac — AJAX trả một câu LẠ: đoạt vẫn thành nhưng engine không có quyền đoán
  const kmFresh = () => ({
    type: 2, inMine: false, minedMin: 12, maxed: false, claimedJustNow: false,
    owner: false, attacksUsed: 0, bonus: 100, claims: 0, seizeSays: "net",
    tuVi: 0, tuViCap: 600, tinhThach: 0, tinhThachCap: 200, bought: [], hideBonus: false, hideStats: false,
  });
  let kmState = kmFresh();

  // Phần Thưởng Hoạt Động — hai rương mốc 75%/100% trên hub. Món thưởng chép từ bản ghi
  // 17/08 (thẻ liệt kê 30 Cống Hiến, nhưng AJAX trả về +51 — fixture theo AJAX, vì đó là con
  // số người chơi thật sự nhận và cũng là thứ hộp thưởng in ra).
  const ptFresh = () => ({
    ring: "100%",
    section: true,
    refuse: false,
    claims: [],
    cards: [
      {
        pct: "Mốc 75%",
        state: "unlocked",
        title: "Nhận Thưởng Thành Công!",
        lines: [["✨", "+100", "Tu Vi"], ["💎", "+60", "Tiên Ngọc"], ["📜", "+2", "Lượt Khắc Trận Văn"], ["☯️", "+10", "Thiên Cơ Lệnh"]],
      },
      {
        pct: "Mốc 100%",
        state: "unlocked",
        title: "Hoàn Thành Xuất Sắc!",
        lines: [["🏅", "+51", "Cống Hiến Tông Môn"], ["🎡", "+1", "Lượt Vòng Quay Phúc Vận"], ["📜", "+1", "Lượt Khắc Trận Văn"], ["☯️", "+1", "Thiên Cơ Lệnh"]],
      },
    ],
  });
  let ptState = ptFresh();
  /** Trang Điểm Danh trả về trạng thái đã-điểm-danh — bật cho ca sổ đủ lượt ở cuối tệp. */
  let checkInDone = false;

  /**
   * Công tắc dựng lại ĐÊM 07/08: site trả về một trang CÂM — không dấu đã-đăng-nhập, không
   * form đăng nhập, không màn Cloudflare, và hub không có `.nv-quest`. Đúng thứ khiến
   * `readinessProbe` trả `loggedIn: null` và `vipProbe` trả null mãi mãi.
   *
   * Bật lên là MỌI đường dẫn trả trang câm ấy — vì đó chính là hình dạng của sự cố: không
   * riêng trang nào hỏng, cả site không còn là trang game của một thành viên đã đăng nhập.
   */
  let siteMute = false;
  const MUTE_PAGE =
    '<!doctype html><html lang="vi"><meta charset="utf-8"><title>hoathinh3d</title>' +
    "<body><div>Đang tải…</div></body>";

  /**
   * Trang giả widget Trò Chuyện Đội của Mê Cung — đúng hai mảnh mà bước chat đụng tới:
   * ô #mc-chat-input và hàm toàn cục sendChatMsg() (site gắn nó vào nút gửi qua onclick).
   * Fixture ghi lại mọi lần gửi vào window.__sent để phép thử đọc.
   */
  const MC_CHAT_PAGE =
    '<!doctype html><html lang="vi"><meta charset="utf-8"><body><div id="wpadminbar"></div>' +
    '<div id="mc-chat-widget"><input id="mc-chat-input" type="text" maxlength="200"></div>' +
    "<script>window.__sent = []; window.sendChatMsg = () => { const el = document.getElementById('mc-chat-input'); if (el.value) { window.__sent.push(el.value); el.value = ''; } };</script>" +
    "</body>";

  /** Cùng trang nhưng widget VẮNG MẶT — phòng chat có thể chưa dựng khi bước chat tới lượt. */
  const MC_CHAT_CUT_PAGE =
    '<!doctype html><html lang="vi"><meta charset="utf-8"><body><div id="wpadminbar"></div>' +
    "<div>không có widget</div></body>";

  /**
   * Trang "chậm dựng": `#late-mark` chỉ xuất hiện từ lượt ghé thứ `flakyAppearsOnVisit`.
   *
   * `flakyVisits` là nhân chứng quan trọng nhất của cả nhóm ca dưới: nó đếm số lần trang
   * THẬT SỰ được tải. Một phép thử chỉ nhìn outcome không phân biệt nổi "engine thử lại
   * đúng 3 lượt" với "engine chờ lâu gấp ba trên cùng một trang".
   */
  let flakyVisits = 0;
  let flakyAppearsOnVisit = Number.POSITIVE_INFINITY;
  const flakyPage = (withMark) =>
    '<!doctype html><html lang="vi"><meta charset="utf-8"><body><div id="wpadminbar"></div>' +
    (withMark ? '<div id="late-mark">có rồi</div>' : "<div>chưa dựng xong</div>") +
    "</body>";

  // Hỷ Sự Đường nhớ trạng thái PHÍA SERVER như site thật: chúc rồi thì lần mở modal sau
  // phải thấy "Đã chúc". Phòng hồng-nhan cố ý đứng ĐẦU danh sách: từ 15/08/2026 flow đi ĐÚNG
  // THỨ TỰ danh sách (tông chủ chốt), nên nó phải được ghé TRƯỚC hai phòng /phong-cuoi.
  // `lixiSent` của phòng 2533 là phòng "Đã phát lì xì" trong bản ghi 15/08 — phòng mà ghi chú
  // của người ghi hình dặn thẳng là VẪN phải vào chúc.
  const hySuRooms = [
    { id: "230", type: "hong-nhan", couple: "Trái Tim Mỹ Nhân 💕 Trái Tim Bao Dung" },
    { id: "2534", type: "dao-lu", couple: "ミ★Ôɴԍтʀùмнн3ᴅ★彡 & 𝙐𝙮ê𝙣𝙉𝙝𝙞" },
    { id: "2533", type: "dao-lu", couple: "1 Trái tim 1 Ngừi iu & Trái Tim Bất Chấp", lixiSent: true },
    // Phòng của bản ghi 18/08/2026: ĐÃ CHÚC từ trước và ĐANG GIỮ một hồng bao chưa khai. Bộ lọc
    // mặc định là ".not-blessed" nên bản quest cũ KHÔNG BAO GIỜ ghé nó — hồng bao hết hạn theo
    // tiệc (5 giờ) mà không ai biết. Đây là ca chính của lượt vá này.
    // Phòng của bản ghi 19/08/2026: ĐẠO LỮ, đã chúc, và đang giữ một hồng bao chưa khai.
    // Trước lượt vá này cụm hồng bao chỉ biết bộ id #hn* của Hồng Nhan, nên phòng như thế
    // này vào tới nơi rồi đứng nhìn cái khay mà không khai được gì.
    { id: "251", type: "hong-nhan", couple: "白鹿 ღ Lý Thanh Nguyệt 💕 小遥 | Tuyết Băng Vân", lixiSent: true, gift: true, preBlessed: true },
    { id: "2595", type: "dao-lu", couple: "亗ᴸᴴ | ᑎǤưᑌ ᛕᗩ & 亗ᴸᴴ | ᑎǤưᑌ ੮ỷ", lixiSent: true, gift: true, preBlessed: true },
  ];
  const hySuBlessed = new Map(); // id → lời chúc đã gửi, theo thứ tự vào phòng
  const hySuLixi = []; // id phòng đã KHAI được hồng bao, theo thứ tự
  const hySuTrayClosed = []; // id phòng đã ĐÓNG khay lại — khay còn mở là form chúc bị che
  const hySuGifts = new Set(hySuRooms.filter((r) => r.gift).map((r) => r.id));
  const hySuBrokenRooms = new Set(); // id → trang phòng trả về hình dạng lạ (không form, không dấu đã chúc)
  let bossBroken = false;
  let bossStateMs = 0;
  let bossCooling = false;
  let bossTurnsLeft = 5;
  let bossReward = false;
  const hvClaims = [];

  // Lò luyện đan phía "server", đúng luật đo trong luyen-dan.min.js (06/08): lửa tụt theo
  // thời gian thật, cú Điều Hòa nào cũng được NHẬN nhưng chỉ được ĐẾM khi (lần đầu ≤ 68%)
  // hoặc đã có lần đếm trước đó — bấm sớm là bấm vào hư không.
  //
  // Tốc độ tụt 0.55%/s là con số CÓ CHỦ ĐÍCH, không phải nén tuỳ tiện: nó giữ đúng bất đẳng
  // thức của sự cố 19:01 — sáu vòng bấm của flow cũ (~46s) phải KẾT THÚC TRƯỚC khi lửa chạm
  // 68 (ở đây: (98-68)/0.55 ≈ 55s). Nén nhanh hơn (bản cũ 3%/s → chạm 68 sau 10s) là vô tình
  // cho flow cũ ăn may chạm vùng đếm được ngay trong sáu vòng — fixture xanh mà production
  // nổ, đúng chuyện đã xảy ra.
  const furnace = { phase: "cooking", fire: 98, tunes: 0, wasted: 0, lockedUntil: 0, tick: Date.now(), log: [] };
  const FURNACE_DECAY_PER_SEC = 0.55;
  // Khai lô lại NGAY TRƯỚC mỗi ca: lửa tụt theo đồng hồ treo tường, mà ca này chạy ở cuối
  // suite — không đặt lại thì phép tính đầu tiên nuốt trọn số phút của mọi ca phía trước và
  // lò nổ trước khi engine kịp chạm vào nó.
  const relightFurnace = () =>
    Object.assign(furnace, {
      phase: "cooking", fire: 98, tunes: 0, wasted: 0, lockedUntil: 0, tick: Date.now(), log: [],
    });
  const tickFurnace = () => {
    const now = Date.now();
    const dt = (now - furnace.tick) / 1000;
    furnace.tick = now;
    if (furnace.phase !== "cooking" || furnace.tunes >= 3) return furnace;
    furnace.fire -= FURNACE_DECAY_PER_SEC * dt;
    if (furnace.fire <= 0) {
      furnace.phase = "exploded";
      furnace.log.push("NỔ");
    }
    return furnace;
  };
  const furnaceJson = () =>
    JSON.stringify({
      phase: furnace.phase,
      fire: furnace.fire,
      tunes: furnace.tunes,
      locked: Date.now() < furnace.lockedUntil,
    });

  const server = createServer((req, res) => {
    // "Tên miền CŨ" của fixture là `localhost`; mọi ca khác gõ cửa bằng 127.0.0.1 và được
    // phục vụ như thường. Hai tên cùng trỏ một máy chủ nhưng KHÁC ORIGIN dưới mắt trình
    // duyệt — đúng hình dạng cú dời TLD của site thật, mà không cần DNS hay tên miền thật.
    const host = req.headers.host ?? "";
    if (host.startsWith("localhost")) {
      const port = host.split(":")[1] ?? "";
      res.writeHead(301, { location: `http://127.0.0.1:${port}${req.url ?? "/"}` });
      return void res.end();
    }

    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    const url = new URL(req.url ?? "/", "http://fixture.test");
    const path = url.pathname.replace(/\/$/, "") || "/";
    if (siteMute) return void res.end(MUTE_PAGE);
    if (path === "/mc-chat") return void res.end(MC_CHAT_PAGE);
    if (path === "/mc-chat-cut") return void res.end(MC_CHAT_CUT_PAGE);
    if (path === "/flaky") {
      flakyVisits += 1;
      return void res.end(flakyPage(flakyVisits >= flakyAppearsOnVisit));
    }
    if (path === "/diem-danh") res.end(checkInDone ? FREE_CHECKIN_DONE_PAGE : FREE_CHECKIN_PAGE);
    else if (path === "/nhiem-vu-hang-ngay") res.end(hubPage({ ...ptState, biCanhSpent: btmHubSpent }));
    else if (path === "/bi-canh-tong-mon") {
      btmHits += 1;
      res.end(biCanhPage({ broken: btmBroken, state: btmState, lastTurn: btmLastTurn }));
    }
    else if (path === "/btm-cooldown") res.end("ok");
    else if (path === "/btm-attack") { btmAttacks.push(new Date().toISOString()); res.end("ok"); }
    else if (path === "/pt-claim") { ptState.claims.push(url.searchParams.get("stage") ?? "?"); res.end("ok"); }
    else if (path === "/phuc-loi-duong") res.end(FREE_WELFARE_PAGE);
    else if (path === "/vong-quay-phuc-van") res.end(FREE_WHEEL_PAGE);
    else if (path === "/thi-luyen-tong-mon-hh3d") res.end(FREE_TRIAL_PAGE);
    else if (path === "/danh-sach-thanh-vien-tong-mon") res.end(freeSacrificePage(teLeOffered));
    else if (path === "/te-le-offered") { teLeOffered = true; res.end("ok"); }
    // Lĩnh thưởng Hoang Vực: server ghi nhận VÀ đổi trạng thái — lượt tải lại kế tiếp phải là
    // trang boss bình thường, bằng không fixture nói dối ở đúng chỗ quan trọng nhất.
    else if (path === "/hv-claim") { hvClaims.push(new Date().toISOString()); bossReward = false; res.end("ok"); }
    else if (path === "/hoang-vuc")
      res.end(bossPage(bossBroken, { stateMs: bossStateMs, cooling: bossCooling, turnsLeft: bossTurnsLeft, reward: bossReward }));
    else if (path === "/luyen-dan-duong") res.end(furnacePage({ waveMs: 900 }));
    else if (path === "/ld-state") {
      tickFurnace();
      res.end(furnaceJson());
    }
    else if (path === "/ld-tune") {
      tickFurnace();
      if (
        furnace.phase === "cooking" && furnace.tunes < 3 &&
        Date.now() >= furnace.lockedUntil && (furnace.tunes > 0 || furnace.fire <= 68)
      ) {
        furnace.tunes += 1;
        furnace.fire = Math.min(98, furnace.fire + 25);
        furnace.lockedUntil = Date.now() + 2000;
        furnace.log.push(`Điều Hòa ${furnace.tunes}`);
      } else {
        // Cú bấm ngoài vùng đếm được — server thật nhận request rồi bỏ qua, và ĐẾM Ở ĐÂY là
        // cách phép thử phân biệt "chờ đúng cửa" với "bấm bừa cho tới khi trúng".
        furnace.wasted += 1;
        furnace.log.push(`bấm hụt @${Math.round(furnace.fire)}%`);
      }
      res.end(furnaceJson());
    }
    else if (path === "/tien-duyen") res.end(hySuHallPage(hySuRooms, hySuBlessed, hySuGifts));
    else if (path === "/phong-cuoi" || path === "/hong-nhan") {
      const id = url.searchParams.get("id") ?? "";
      const room = hySuRooms.find((r) => r.id === id);
      if (hySuBrokenRooms.has(id)) res.end(hySuBrokenRoomPage(id));
      // Trang Hồng Nhan là bản ĐÃ CHÚC + khay #hn*, nên chỉ phòng hong-nhan preBlessed mới
      // đi lối ấy; mọi phòng còn lại đi trang /phong-cuoi, và nay trang ấy tự dựng khay Đạo Lữ.
      else if (room?.type === "hong-nhan" && room?.preBlessed) res.end(hySuHongNhanPage(id, hySuGifts.has(id)));
      else res.end(hySuRoomPage(id, hySuBlessed.has(id) || !!room?.preBlessed, hySuGifts.has(id)));
    }
    else if (path === "/hy-su-lixi") {
      // Máy chủ chỉ trả thưởng MỘT lần cho mỗi phòng, đúng như hh3d_receive_li_xi ngoài đời;
      // lượt hai vào lại cũng không đẻ thêm hồng bao nào.
      const id = url.searchParams.get("id") ?? "";
      if (hySuGifts.delete(id)) hySuLixi.push(id);
      res.end(JSON.stringify({ type: "tien_ngoc", name: "Tiên Ngọc", amount: 49 }));
    }
    else if (path === "/hy-su-tray-closed") { hySuTrayClosed.push(url.searchParams.get("id") ?? ""); res.end("ok"); }
    else if (path === "/hy-su-blessed") {
      hySuBlessed.set(url.searchParams.get("id") ?? "", url.searchParams.get("msg") ?? "");
      res.end("ok");
    }
    else if (path === "/khoang-mach") {
      // Chín giữa hai lượt ghé: load nào thấy mình ĐÃ ở trong mỏ (tức không phải load của
      // chính lượt vào) là chu kỳ trước đó đã đủ 30 phút.
      if (kmState.inMine && !kmState.maxed) kmState.maxed = true;
      kmState.claimedJustNow = false;
      res.end(khoangMachPage(kmState));
    }
    else if (path === "/km-enter") { kmState.inMine = true; kmState.minedMin = 0; res.end("ok"); }
    else if (path === "/km-claim") {
      kmState.maxed = false;
      kmState.claims += 1;
      kmState.tuVi = Math.min(kmState.tuVi + 270, kmState.tuViCap);
      kmState.tinhThach = Math.min(kmState.tinhThach + 100, kmState.tinhThachCap);
      res.end("ok");
    }
    else if (path === "/km-buy") { kmState.bought.push(url.searchParams.get("item") ?? "?"); res.end("ok"); }
    // Bonus tăng Ở CẢ HAI PHÍA: trang tự cập nhật ô để lượt quét ngay sau đọc được, còn state
    // máy chủ phải theo cùng — lệch nhau là fixture nói dối ở lần render kế.
    else if (path === "/km-seize") {
      kmState.owner = true; kmState.attacksUsed += 1; kmState.bonus += 20;
      // Lời xác nhận đi bằng THÂN TRẢ LỜI, và đi dưới dạng PHP `json_encode` mặc định xuất ra:
      // tiếng Việt bị bẻ thành \uXXXX. Đây không phải chi tiết trang trí — tai nghe phải mở
      // được lớp mã hoá ấy mới đọc ra câu xác nhận, và fixture là chỗ duy nhất chứng minh nó mở được.
      const nhuPhp = (o) =>
        JSON.stringify(o).replace(/[^\x00-\x7F]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));
      const says = url.searchParams.get("says") ?? "net";
      if (says === "dom") res.end("ok");
      else if (says === "khac") res.end(nhuPhp({ success: true, message: "Ngươi nay là chủ nhân của khoáng mạch." }));
      else res.end(nhuPhp({ success: true, message: "Đã đoạt thành công quyền chủ mỏ." }));
    }
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

    console.log("\nHai flow tài khoản thường từ recording 05/08");

    const trialFree = exportedProfile.quests.find((q) => q.id === "thi-luyen-tong-mon-thuong");
    const trialResult = await run(trialFree);
    check("Thí Luyện qua cổng hub rồi mở rương lúc 00:00", trialResult.outcome === "completed", trialResult.outcome);
    check(
      "Thí Luyện đọc lại cooldown ~30 phút từ đồng hồ vừa khởi động",
      trialResult.cooldownSeconds === 29 * 60 + 59 &&
        (await page.locator("#countdown-timer").getAttribute("data-claimed")) === "1",
      String(trialResult.cooldownSeconds),
    );

    const sacrificeFree = exportedProfile.quests.find((q) => q.id === "te-le-tong-mon-thuong");
    const sacrificeResult = await run(sacrificeFree);
    check("Tế Lễ bấm nút, xác nhận ở hộp của site, chờ nút đổi chữ", sacrificeResult.outcome === "completed", sacrificeResult.outcome);
    check(
      "Tế Lễ đi qua confirm (không đụng Hủy) và site ghi nhận lễ",
      (await page.locator("#te-le-button").getAttribute("data-offered")) === "1" &&
        (await page.locator("#te-le-button").getAttribute("data-cancelled")) == null &&
        (await page.locator("#te-le-button").textContent()).trim() === "Đã Tế Lễ",
    );
    check(
      "…và hộp xác nhận đã rời khỏi DOM, đúng như trang thật",
      (await page.locator("#hh3d-confirm-layer").count()) === 0,
    );

    const sacrificeAgain = await run(sacrificeFree);
    check(
      "Tế Lễ lần hai dừng ở \"đã tế lễ hôm nay\", không bấm gì thêm",
      sacrificeAgain.outcome === "alreadyDone" || sacrificeAgain.outcome === "onCooldown",
      sacrificeAgain.outcome,
    );

    console.log("\nBí Cảnh Tông Môn — bản thường (bản ghi 18/08)");

    const biCanhFree = exportedProfile.quests.find((q) => q.id === "bi-canh-tong-mon-thuong");
    const resetBiCanh = async (over = {}) => {
      btmState = over.state ?? "ready";
      btmBroken = over.broken === true;
      btmLastTurn = over.lastTurn === true;
      btmHubSpent = over.hubSpent === true;
      btmAttacks.length = 0;
      btmHits = 0;
      await page.goto(`${baseUrl}/nhiem-vu-hang-ngay`, { waitUntil: "domcontentloaded" });
    };

    // ---- Cổng hub: hết lượt thì thậm chí KHÔNG mở trang boss -------------------------------
    // Không chỉ là chuyện tiết kiệm một lượt tải. Trang boss chỉ nói được "hết lượt" SAU khi
    // /check-attack-cooldown trả lời, tức sau cả cửa sổ đệm; hàng trên hub thì server render
    // sẵn. Đọc hub trước là đổi một cửa sổ chờ lấy một câu trả lời có ngay từ byte đầu.
    await resetBiCanh({ hubSpent: true });
    const btmDone = await run(biCanhFree);
    check(
      "hàng hub đã \"Xong\" → dừng ở hub, KHÔNG mở trang boss lần nào",
      btmDone.outcome === "alreadyDone" && btmHits === 0,
      `${btmDone.outcome} · trang boss được tải ${btmHits} lần`,
    );

    // ---- Ca thường: đánh một đòn, đọc lại đồng hồ ------------------------------------------
    await resetBiCanh();
    const btmOk = await run(biCanhFree);
    check(
      "còn lượt → khiêu chiến, tấn công, rồi đọc đồng hồ 6:57 trên chính nút ấy",
      btmOk.outcome === "completed" && btmOk.cooldownSeconds === 6 * 60 + 57,
      `${btmOk.outcome}: ${btmOk.cooldownSeconds}`,
    );
    check(
      "…và đòn ấy có thật: site nhận đúng MỘT lượt tấn công, không cú bấm nào bị từ chối",
      btmAttacks.length === 1 &&
        (await page.getAttribute("body", "data-attacked")) === "1" &&
        (await page.getAttribute("body", "data-refused")) == null,
      `POST=${btmAttacks.length} · refused=${await page.getAttribute("body", "data-refused")}`,
    );

    // ---- Đang cooldown: chờ sự thật rồi dừng, không lao vào bấm ----------------------------
    await resetBiCanh({ state: "cooldown" });
    const btmCooling = await run(biCanhFree);
    check(
      "đang cooldown → dừng kèm đúng 6:52 đọc từ nút",
      btmCooling.outcome === "onCooldown" && btmCooling.cooldownSeconds === 6 * 60 + 52,
      `${btmCooling.outcome}: ${btmCooling.cooldownSeconds}`,
    );
    check(
      "…và tuyệt đối không bấm vào cái nút đang khoá",
      btmAttacks.length === 0 && (await page.getAttribute("body", "data-refused")) == null,
      `POST=${btmAttacks.length} · refused=${await page.getAttribute("body", "data-refused")}`,
    );

    // ---- Hết lượt hôm nay (hub chưa kịp biết) ----------------------------------------------
    // Ca này có thật: hàng hub chỉ đổi sang "Xong" khi trang hub được dựng lại, nên một lượt ghé
    // giữa chừng vẫn thấy nút "Đến Đánh". Lời khai đúng phải là "hết ngày", không phải "chờ".
    await resetBiCanh({ state: "spent" });
    const btmSpent = await run(biCanhFree);
    check(
      "nút nói \"Hết lượt hôm nay\" → alreadyDone, không phải onCooldown",
      btmSpent.outcome === "alreadyDone" && btmAttacks.length === 0,
      `${btmSpent.outcome} · POST=${btmAttacks.length}`,
    );

    // ---- Đòn CUỐI của ngày: nhân chứng đi ngả chữ "hết lượt", không có đồng hồ nào ----------
    // Nửa `|hết lượt` của điều kiện nhân chứng chỉ được thử ở đây. Thiếu ca này thì một điều
    // kiện chỉ có ":" vẫn xanh mướt suốt và chỉ hỏng đúng vào lượt thứ năm mỗi ngày.
    await resetBiCanh({ lastTurn: true });
    const btmLast = await run(biCanhFree);
    check(
      "lượt thứ năm: nút nhảy thẳng sang \"Hết lượt hôm nay\" mà lượt vẫn tính là XONG",
      btmLast.outcome === "completed" && btmAttacks.length === 1,
      `${btmLast.outcome} · POST=${btmAttacks.length}`,
    );

    // ---- Cú bấm rơi vào hư không: phải HỎNG, và đối chứng phải chứng minh lưới có răng ------
    await resetBiCanh({ broken: true });
    const btmBrokenRun = await run(biCanhFree);
    check(
      "site nuốt cú bấm Tấn Công → lượt chạy HỎNG, không nhận vơ là xong",
      btmBrokenRun.outcome === "failed" && btmAttacks.length === 0,
      `${btmBrokenRun.outcome} · POST=${btmAttacks.length}`,
    );

    // ĐỐI CHỨNG, giữ vĩnh viễn: gỡ đúng bước nhân chứng ra khỏi flow thì CHÍNH ca trên phải
    // báo "xong". Fixture nào để bản không-nhân-chứng vẫn hỏng là fixture đang nói dối, và
    // phép thử ngay trên hoá ra chẳng chứng minh gì (bài học Hoang Vực 06/08).
    const btmNoWitness = structuredClone(biCanhFree);
    const witnessAt = btmNoWitness.steps.findIndex(
      (s, i) =>
        s.action === "waitForCondition" &&
        s.optional !== true &&
        s.condition?.selector === "#challenge-boss-btn" &&
        i > btmNoWitness.steps.findIndex((x) => x.action === "click" && x.selector === "#attack-boss-btn"),
    );
    check("flow có ĐÚNG một bước nhân chứng bắt buộc sau cú Tấn Công", witnessAt > 0, String(witnessAt));
    btmNoWitness.steps.splice(witnessAt, 1);
    await resetBiCanh({ broken: true });
    const btmBlind = await run(btmNoWitness);
    check(
      "flow KHÔNG nhân chứng trên cùng ca hỏng: báo \"xong\" cho một trận chưa từng đánh",
      btmBlind.outcome === "completed" && btmAttacks.length === 0,
      `${btmBlind.outcome} · POST=${btmAttacks.length}`,
    );

    // ---- Hình dạng của flow, những chỗ một lần sửa ẩu là mất im lặng ------------------------
    check(
      "trang boss đi đường EMBED — /bi-canh-tong-mon/ trần trả 503 trong bản ghi",
      biCanhFree.pagePath === "/bi-canh-tong-mon/?nv_embed=1",
      biCanhFree.pagePath,
    );
    check(
      "nhịp ghé lại dự phòng = 420s, đúng cooldown_interval site trả về",
      biCanhFree.fallbackCooldownSeconds === 420,
      String(biCanhFree.fallbackCooldownSeconds),
    );
    check(
      "cổng hub đứng TRƯỚC cú điều hướng sang trang boss",
      biCanhFree.steps.findIndex((s) => s.action === "stopIf") <
        biCanhFree.steps.findIndex((s) => s.action === "navigate" && s.text?.includes("bi-canh")),
    );
    check(
      "nhân chứng hỏi CHỮ trên nút, không hỏi `disabled` (nút không được vẽ cũng là disabled)",
      biCanhFree.steps[witnessAt].condition?.kind === "textMatches" &&
        biCanhFree.steps[witnessAt].condition?.text === ":|hết lượt",
      JSON.stringify(biCanhFree.steps[witnessAt].condition),
    );
    check(
      "bi-canh-tong-mon-thuong nằm trong sổ trần-ngày (5 lượt là trần NGÀY)",
      DAILY_QUOTA_QUEST_IDS.has("bi-canh-tong-mon-thuong"),
    );

    // Nhật ký người dùng nói tiếng người (ảnh 05/08): lý do dừng hiện TRẦN, còn "stopIf",
    // "repeat", "until" — ngôn ngữ của script — không được rơi vào kênh info/warning.
    //
    // Lý do dừng đi ra bằng `result.message`, KHÔNG bằng một dòng log của engine: người kể
    // là `OUTCOME_TEXT` bên runCycle. Trước 19/08/2026 engine kể thêm một lần nữa ở chỗ
    // `stopIf` khớp, nên nhật ký thật hiện hai dòng y hệt cách nhau vài mili giây (323 đôi
    // trong ba ngày) — chốt ngay dưới canh đúng chuyện ấy.
    check(
      "lý do dừng ra bằng lời trần, không lộ từ ngữ của script",
      sacrificeAgain.message?.includes("đã tế lễ hôm nay") &&
        !infos.some((m) => /stopIf|repeat|until/.test(m)),
      `${sacrificeAgain.message} · ${infos.filter((m) => /stopIf|repeat|until/.test(m)).join(" / ") || "(sạch)"}`,
    );
    check(
      "engine KHÔNG tự kể lý do dừng — kể cả hai nơi là nhật ký hiện đôi",
      !infos.some((m) => m.includes("đã tế lễ hôm nay")),
      infos.filter((m) => m.includes("đã tế lễ hôm nay")).join(" / ") || "(sạch)",
    );

    console.log("\nKhoáng Mạch — vào mỏ, chờ chín, đào tới khi ĐẦY TRẦN NGÀY (không phải N lần)");

    const kmQuest = exportedProfile.quests.find((q) => q.id === "khoang-mach");
    const kmBody = (name) => page.getAttribute("body", name);
    /** Trả lại suất-mua-phù của「ngày」— localStorage sống theo origin fixture, chung cả bộ smoke. */
    const kmClearDay = () => page.evaluate(() => { try { localStorage.removeItem("__jvz_km_phu"); } catch (e) {} });
    /** Bản sao quest với option đặt sẵn — đúng thứ lớp dịch làm lúc chạy thật. */
    const kmWith = (patch) => {
      const q = structuredClone(kmQuest);
      for (const o of q.options) if (patch[o.key] !== undefined) o.selectedValue = patch[o.key];
      return q;
    };
    const kmOn = (key) => kmQuest.options.find((o) => o.key === key).choices.find((c) => !c.value.includes("«")).value;
    const kmOff = (key) => kmQuest.options.find((o) => o.key === key).choices.find((c) => c.value.includes("«")).value;

    kmState = kmFresh();
    await kmClearDay();
    const km1 = await run(kmQuest);
    check(
      "lượt 1: vào mỏ qua swal2 rồi thoát onCooldown với đồng hồ THẬT (30′ − 12′ đã đào = 18′)",
      km1.outcome === "onCooldown" && km1.cooldownSeconds === 18 * 60,
      `${km1.outcome}: ${km1.cooldownSeconds}s`,
    );
    check(
      "…CHƯA CHÍN thì đứng yên tuyệt đối — buyPhu mặc định bật mà vẫn không mua (check tối đa trước, quyết định sau)",
      (await kmBody("data-entered")) === "1" && kmState.bought.length === 0 &&
        (await kmBody("data-seized")) == null && (await kmBody("data-refused")) == null,
      `entered=${await kmBody("data-entered")} bought=${kmState.bought.length}`,
    );

    const km2 = await run(kmQuest);
    check(
      // Luật đổi 15/08/2026: phù chỉ mua SAU một cú đoạt THÀNH. Cấu hình mặc định tắt đoạt, nên
      // lượt này chín và nhận thưởng bình thường mà không tiêu một đồng nào — chính là cảnh đạo
      // hữu báo (17:10 mua một lá trong đúng một lượt「không đoạt: bonus dưới ngưỡng」).
      "lượt 2: chín → Nhận Thưởng, và KHÔNG mua phù vì lượt này không đoạt mỏ",
      km2.outcome === "completed" && km2.cooldownSeconds === 30 * 60 &&
        kmState.claims === 1 && kmState.bought.length === 0,
      `${km2.outcome}: claims=${kmState.claims}, bought=${kmState.bought.join()}`,
    );

    const km3 = await run(kmQuest);
    check(
      "lượt 3: nhận lần HAI (tinh thạch đầy 200/200, tu vi mới 540/600) — vẫn không mua phù",
      km3.outcome === "completed" && kmState.claims === 2 && kmState.bought.length === 0 &&
        kmState.tinhThach === kmState.tinhThachCap && kmState.tuVi < kmState.tuViCap,
      `claims=${kmState.claims}, tuVi=${kmState.tuVi}/${kmState.tuViCap}, bought=${kmState.bought.length}`,
    );

    const km3b = await run(kmQuest);
    check(
      "lượt 4: nhận lần BA — MỘT trần đầy chưa phải hết ngày, đào tới khi CẢ HAI đầy (600 tu vi = ba lần nhận)",
      km3b.outcome === "completed" && kmState.claims === 3 &&
        kmState.tuVi === kmState.tuViCap && kmState.tinhThach === kmState.tinhThachCap,
      `claims=${kmState.claims}, tuVi=${kmState.tuVi}/${kmState.tuViCap}`,
    );

    const km4 = await run(kmQuest);
    check(
      "lượt 5: hai trần cùng đầy → alreadyDone + dấu đủ-lượt-ngày",
      km4.outcome === "alreadyDone" && km4.dailyCapReached === true && kmState.claims === 3,
      `${km4.outcome}, dailyCapReached=${km4.dailyCapReached}`,
    );
    check(
      "…trần đọc từ Ô CHỈ SỐ (.stat-tuvi/.stat-tinhthach của bản ghi 15/08), kể bằng tiếng người",
      infos.some((m) => m.includes("Trần hôm nay") && m.includes("ô chỉ số") && m.includes("ĐÃ ĐẦY")),
    );

    // Markup trôi (site đổi tên miền hai lần trong hai ngày): mất .stats-container thì đường
    // lui quét chữ toàn trang vẫn phải đọc ra trần — mù trần là đào vô tận không ai hay.
    kmState = kmFresh();
    kmState.hideStats = true;
    kmState.tuVi = kmState.tuViCap;
    kmState.tinhThach = kmState.tinhThachCap;
    const kmDrift = await run(kmQuest);
    check(
      "mất .stats-container → đường lui quét chữ vẫn đọc được trần và khoá ngày",
      kmDrift.outcome === "alreadyDone" && kmDrift.dailyCapReached === true &&
        infos.some((m) => m.includes("quét chữ toàn trang")),
      kmDrift.outcome,
    );

    console.log("\nKhoáng Mạch — mua phù & đoạt mỏ: CHỈ khi đã chín, hai công tắc rời, suất 1 lá/ngày");

    // hostMode + buyPhu cùng bật mà CHƯA CHÍN → không đóng/mở sổ, không mua, không đoạt.
    kmState = kmFresh();
    await kmClearDay();
    const kmNotRipe = await run(kmWith({ hostMode: kmOn("hostMode"), hostMinBonus: "100" }));
    check(
      "chưa chín + hostMode & buyPhu cùng bật → vẫn đứng yên: không mua, không đoạt, chỉ đọc đồng hồ",
      kmNotRipe.outcome === "onCooldown" && kmState.bought.length === 0 &&
        (await kmBody("data-seized")) == null && (await kmBody("data-refused")) == null,
      `${kmNotRipe.outcome}; bought=${kmState.bought.length}`,
    );

    // Chín + đủ ngưỡng: mua 1 phù → đoạt → nhận, đúng thứ tự công thức 14/08.
    kmState = kmFresh();
    kmState.inMine = true;
    await kmClearDay();
    const kmH1 = await run(kmWith({ hostMode: kmOn("hostMode"), hostMinBonus: "100" }));
    check(
      "chín + đủ ngưỡng: mua đúng Linh Quang Phù giữa 6 món trên kệ → đoạt mỏ → nhận thưởng",
      kmH1.outcome === "completed" && kmState.bought.join() === "linh-quang-phu" &&
        kmState.owner === true && kmState.attacksUsed === 1 && kmState.claims === 1,
      `${kmH1.outcome}; bought=${kmState.bought.join()}; owner=${kmState.owner}; claims=${kmState.claims}`,
    );
    check(
      "…swal đoạt đi qua nút Xác nhận, không đụng Không",
      (await kmBody("data-seized")) === "1" && (await kmBody("data-cancelled")) == null,
    );

    // CÙNG «ngày» smoke, chín lần nữa (KHÔNG xoá sổ suất): phải nhớ đã mua.
    kmState = kmFresh();
    kmState.inMine = true;
    const kmSecond = await run(kmWith({ hostMode: kmOn("hostMode"), hostMinBonus: "100" }));
    check(
      "chín lần nữa trong cùng ngày: suất phù ĐÃ TIÊU → đoạt tiếp nhưng tuyệt không mua thêm",
      kmSecond.outcome === "completed" && kmState.bought.length === 0 && kmState.owner === true,
      `bought=${kmState.bought.length}; owner=${kmState.owner}`,
    );
    check("…và nhật ký nói rõ vì sao không mua", infos.some((m) => m.includes("đã dùng suất")));

    // buyPhu «không mua»: đoạt vẫn chạy, ví tiền đứng yên — hai công tắc thật sự rời nhau.
    kmState = kmFresh();
    kmState.inMine = true;
    await kmClearDay();
    const kmNoBuy = await run(kmWith({ hostMode: kmOn("hostMode"), hostMinBonus: "100", buyPhu: kmOff("buyPhu") }));
    check(
      "buyPhu «không mua»: đoạt mỏ vẫn trọn vẹn, không một cú mua nào",
      kmNoBuy.outcome === "completed" && kmState.bought.length === 0 &&
        kmState.owner === true && kmState.claims === 1,
      `bought=${kmState.bought.length}; owner=${kmState.owner}`,
    );

    console.log("\nKhoáng Mạch — ngưỡng % để CHỐT LỜI (minBonus), tách khỏi ngưỡng đoạt");

    // Các bài ngưỡng giữ THUẦN về ngưỡng: tắt mua phù để ví tiền không lẫn vào phép đo.
    kmState = kmFresh();
    kmState.inMine = true;
    await kmClearDay();
    const kmHold = await run(kmWith({ minBonus: "120", buyPhu: kmOff("buyPhu") }));
    check(
      "bonus 100% < ngưỡng 120% → chưa nhận, thoát onCooldown hẹn 10′, thưởng vẫn treo",
      kmHold.outcome === "onCooldown" && kmHold.cooldownSeconds === 10 * 60 &&
        kmState.claims === 0 && kmState.maxed === true && kmState.bought.length === 0,
      `${kmHold.outcome}: ${kmHold.cooldownSeconds}s, claims=${kmState.claims}`,
    );
    check(
      "…và nói rõ vì sao chưa nhận, bằng tiếng người",
      infos.some((m) => m.includes("dưới ngưỡng 120%") && m.includes("chưa nhận")),
    );
    check(
      "…KHÔNG có cú bấm nhận nào bị server từ chối",
      (await kmBody("data-refused")) == null && (await kmBody("data-claimed")) == null,
    );

    kmState = kmFresh();
    kmState.inMine = true;
    const kmEdge = await run(kmWith({ minBonus: "100", buyPhu: kmOff("buyPhu") }));
    check(
      "bonus 100% = ngưỡng 100% → NHẬN (biên là ≥, không phải >)",
      kmEdge.outcome === "completed" && kmState.claims === 1,
      `${kmEdge.outcome}, claims=${kmState.claims}`,
    );

    kmState = kmFresh();
    kmState.inMine = true;
    kmState.bonus = 5;
    const kmZero = await run(kmWith({ minBonus: "0", buyPhu: kmOff("buyPhu") }));
    check(
      "ngưỡng 0 → nhận bất kể bonus thấp cỡ nào (mặc định, giữ hành vi hồ sơ cũ)",
      kmZero.outcome === "completed" && kmState.claims === 1,
      `${kmZero.outcome}, claims=${kmState.claims}`,
    );

    kmState = kmFresh();
    kmState.inMine = true;
    kmState.hideBonus = true;
    const kmBlind = await run(kmWith({ minBonus: "120", buyPhu: kmOff("buyPhu") }));
    check(
      "mất ô % bonus → vẫn nhận (fail-open), không âm thầm bỏ phần thưởng",
      kmBlind.outcome === "completed" && kmState.claims === 1,
      `${kmBlind.outcome}, claims=${kmState.claims}`,
    );
    check(
      "…và nhật ký CẢNH BÁO rằng ngưỡng vừa không áp được",
      infos.some((m) => m.includes("không đọc được % bonus")),
    );

    // Cờ RIPE tách khỏi cờ MAX là để cảnh này sống: minBonus đang treo cú chốt, nhưng ĐOẠT thì
    // được phép (đã chín!) — đoạt nâng bonus 100→120 và mở cửa chốt trong CÙNG lượt.
    kmState = kmFresh();
    kmState.inMine = true;
    const kmSeizeOpens = await run(
      kmWith({ minBonus: "120", hostMode: kmOn("hostMode"), hostMinBonus: "100", buyPhu: kmOff("buyPhu") }),
    );
    check(
      "minBonus treo cú chốt nhưng KHÔNG treo cú đoạt: đoạt nâng bonus 100→120% và mở cửa chốt cùng lượt",
      kmSeizeOpens.outcome === "completed" && kmState.owner === true &&
        kmState.bonus === 120 && kmState.claims === 1,
      `${kmSeizeOpens.outcome}, owner=${kmState.owner}, bonus=${kmState.bonus}, claims=${kmState.claims}`,
    );

    // ĐOẠT THÀNH thì bấy giờ mới mua — nhánh THUẬN của luật 15/08/2026. Cùng cảnh với ca ngay
    // trên, chỉ khác: phù bật. Không có ca này thì mọi khẳng định「không mua」bên dưới đều có thể
    // xanh vì một lý do tầm thường (cụm mua hỏng hẳn), chứ không phải vì luật chạy đúng.
    kmState = kmFresh();
    kmState.inMine = true;
    await kmClearDay();
    const kmSeizeBuys = await run(
      kmWith({ minBonus: "120", hostMode: kmOn("hostMode"), hostMinBonus: "100" }),
    );
    check(
      "đoạt THÀNH → bấy giờ mới mua đúng MỘT lá phù, rồi mới chốt lời",
      kmSeizeBuys.outcome === "completed" && kmState.owner === true &&
        kmState.bought.join() === "linh-quang-phu" && kmState.claims === 1,
      `${kmSeizeBuys.outcome}, owner=${kmState.owner}, bought=${kmState.bought.join()}, claims=${kmState.claims}`,
    );

    // Đường CŨ phải còn sống: có trang vẽ lời xác nhận ra DOM thật (và bản ghi 14/08 đọc câu ấy
    // ở tầng mạng, không loại trừ khả năng một ngày nào đó site vẽ nó ra). Ở ca này AJAX chỉ
    // trả "ok", nên nếu phép đọc DOM bị bản vá làm chết thì đúng ca này đỏ.
    kmState = kmFresh();
    kmState.inMine = true;
    kmState.seizeSays = "dom";
    await kmClearDay();
    const kmSeizeDom = await run(
      kmWith({ minBonus: "120", hostMode: kmOn("hostMode"), hostMinBonus: "100" }),
    );
    check(
      "trang VẼ lời xác nhận ra DOM (AJAX câm) → vẫn tính là đoạt THÀNH, vẫn mua đúng một lá",
      kmSeizeDom.outcome === "completed" && kmState.owner === true &&
        kmState.bought.join() === "linh-quang-phu" && kmState.claims === 1,
      `${kmSeizeDom.outcome}, owner=${kmState.owner}, bought=${kmState.bought.join()}, claims=${kmState.claims}`,
    );

    // Site đổi lời văn: đoạt VẪN thành (owner lật), nhưng không ngả nào nói câu ta biết. Phía an
    // toàn giữ nguyên — KHÔNG mua — còn cái mới là nhật ký phải KỂ RA trang vừa nói gì, để lượt
    // hỏng kế tiếp không phải đi mò như lượt 17/08/2026.
    kmState = kmFresh();
    kmState.inMine = true;
    kmState.seizeSays = "khac";
    await kmClearDay();
    const kmSeizeOdd = await run(
      kmWith({ minBonus: "120", hostMode: kmOn("hostMode"), hostMinBonus: "100" }),
    );
    check(
      "trang trả lời một câu LẠ → KHÔNG mua phù (giữ phía an toàn)",
      kmState.bought.length === 0 && kmSeizeOdd.outcome === "completed",
      `${kmSeizeOdd.outcome}, bought=${kmState.bought.join()}`,
    );
    check(
      "…và nhật ký chép lại NGUYÊN VĂN thứ trang vừa trả lời, thay vì than câm",
      infos.some((m) => m.includes("trang trả lời:") && m.includes("Ngươi nay là chủ nhân")),
      infos.filter((m) => m.includes("KHÔNG thành")).join(" / ") || "(không có dòng nào)",
    );

    // Đã là chủ mỏ → không có nút Đoạt Mỏ để bấm, nên KHÔNG có cú đoạt nào thành trong lượt này.
    // Cửa mua phải đóng: đây là ca「định đoạt mà không đoạt được」, khác hẳn ca「không định đoạt」.
    kmState = kmFresh();
    kmState.inMine = true;
    kmState.owner = true;
    await kmClearDay();
    const kmOwnerNoBuy = await run(kmWith({ hostMode: kmOn("hostMode"), hostMinBonus: "100" }));
    check(
      "đã là chủ mỏ (không còn gì để đoạt) → KHÔNG mua phù, nhưng vẫn chốt lời bình thường",
      kmState.bought.length === 0 && kmState.claims === 1 && kmOwnerNoBuy.outcome === "completed",
      `${kmOwnerNoBuy.outcome}; bought=${kmState.bought.length}; claims=${kmState.claims}`,
    );

    // minBonus treo cú chốt, và lượt này KHÔNG đoạt → không mua gì cả. Bản trước mua ở đây, và
    // đó chính là「mua quá sớm」: phù sống 1 giờ, tiêu vào một lượt còn chưa chốt lời nổi.
    kmState = kmFresh();
    kmState.inMine = true;
    await kmClearDay();
    const kmBuyHold = await run(kmWith({ minBonus: "120" }));
    check(
      "chín + minBonus treo + buyPhu bật nhưng KHÔNG đoạt: không mua gì, cú chốt tiếp tục treo",
      kmBuyHold.outcome === "onCooldown" && kmBuyHold.cooldownSeconds === 10 * 60 &&
        kmState.bought.length === 0 && kmState.claims === 0,
      `${kmBuyHold.outcome}; bought=${kmState.bought.length}; claims=${kmState.claims}`,
    );

    console.log("\nPhần Thưởng Hoạt Động — hai rương mốc 75%/100% trên hub (bản ghi 17/08)");

    const ptQuest = exportedProfile.quests.find((q) => q.id === "phan-thuong-hoat-dong");
    const ptFree = exportedProfile.quests.find((q) => q.id === "phan-thuong-hoat-dong-thuong");
    const ptBody = (attr) => page.locator("body").getAttribute(attr);

    // Cảnh của chính bản ghi: cả hai rương đang mở. Một lượt ghé phải ăn TRỌN cả hai — mỗi
    // rương một cú bấm, một hộp, một cú Đóng — rồi hẹn giờ dài, KHÔNG phải alreadyDone: lượt
    // này vừa làm việc, và cái sổ ngày chỉ được đóng bởi lượt ghé sau nó.
    ptState = ptFresh();
    const pt2 = await run(ptQuest);
    check(
      "hai rương đang mở → nhận CẢ HAI trong một lượt, đóng đủ hai hộp",
      pt2.outcome === "completed" && ptState.claims.join() === "1,2" && (await ptBody("data-closed")) === "2",
      `${pt2.outcome}; claims=${ptState.claims.join()}; closed=${await ptBody("data-closed")}`,
    );
    // `completed` chứ không `onCooldown`, và đó là ranh giới của đuôi script (giống Khoáng
    // Mạch): lượt NÀO có nhận rương thì cắm cờ jvz-pt-acted và đi thẳng qua stopIf cuối. Chỉ
    // lượt tay trắng mới thành onCooldown. Sổ ngày thì cả hai đều không đóng.
    check(
      "…hẹn 4 giờ (đã hết rương), chưa vào sổ ngày vì lượt này CÓ làm việc",
      pt2.cooldownSeconds === 4 * 3600 && pt2.outcome !== "alreadyDone" && pt2.dailyCapReached !== true,
      `${pt2.outcome}: ${pt2.cooldownSeconds}s`,
    );
    // Hai tiêu đề hộp KHÁC NHAU (video 00:56 / 01:04). Một phép kiểm đi so tiêu đề sẽ khai
    // rương thứ hai là hỏng — đây là ca giữ cho nó không bao giờ được viết như vậy.
    check(
      "…nhật ký kể đúng món của TỪNG rương, kể cả rương có tiêu đề khác hẳn",
      infos.some((m) => m.includes("Nhận Thưởng Thành Công!") && m.includes("+100 Tu Vi")) &&
        infos.some((m) => m.includes("Hoàn Thành Xuất Sắc!") && m.includes("+51 Cống Hiến Tông Môn")),
      infos.filter((m) => m.includes("Thiên Cơ Lệnh")).join(" / ") || "(không có dòng nào)",
    );

    // Ghé lại khi cả hai đã nhận: ĐÂY mới là ngả vào sổ ngày — alreadyDone + dailyCapReached,
    // và tuyệt đối không bấm gì.
    ptState = ptFresh();
    for (const c of ptState.cards) c.state = "claimed";
    const ptDone = await run(ptQuest);
    check(
      "cả hai rương đã nhận → alreadyDone, không bấm cú nào",
      ptDone.outcome === "alreadyDone" && ptDone.dailyCapReached === true && ptState.claims.length === 0,
      `${ptDone.outcome}; capReached=${ptDone.dailyCapReached}; claims=${ptState.claims.length}`,
    );

    // Rương 100% chưa tới mốc: nhận cái đang mở rồi hẹn 30 phút — KHÔNG được nhớ là "hết ngày",
    // vì mốc sau còn mở ra khi các nhiệm vụ khác chạy tiếp (lời dặn của tông chủ 17/08).
    ptState = ptFresh();
    ptState.cards[1].state = "locked";
    ptState.ring = "75%";
    const ptLocked = await run(ptQuest);
    check(
      "một rương còn khoá → nhận rương đang mở, hẹn 30 phút, KHÔNG vào sổ ngày",
      ptLocked.outcome === "completed" && ptLocked.cooldownSeconds === 30 * 60 &&
        ptState.claims.join() === "1" && ptLocked.dailyCapReached !== true,
      `${ptLocked.outcome}: ${ptLocked.cooldownSeconds}s; claims=${ptState.claims.join()}`,
    );
    check(
      "…và nói rõ đang ở mốc nào, còn thiếu rương nào",
      infos.some((m) => m.includes("Hoạt động mới 75%") && m.includes("Mốc 100%")),
      infos.filter((m) => m.includes("chưa mở")).join(" / ") || "(không có dòng nào)",
    );

    // Hub KHÔNG có mục này (nỗi lo của hạng thường: bản ghi là tài khoản VIP). Phải là một lượt
    // hẹn giờ có lời giải thích, không phải quest đỏ, và tuyệt đối không phải alreadyDone —
    // một mục vắng mặt có thể chỉ là trang dựng thiếu, mà alreadyDone là khoá cả ngày.
    ptState = ptFresh();
    ptState.section = false;
    const ptNone = await run(ptQuest);
    check(
      "hub không có mục Phần Thưởng Hoạt Động → hẹn 60 phút, không đỏ, không khoá cả ngày",
      ptNone.outcome === "onCooldown" && ptNone.cooldownSeconds === 60 * 60 && ptNone.dailyCapReached !== true,
      `${ptNone.outcome}: ${ptNone.cooldownSeconds}s`,
    );
    check(
      "…và nói thẳng là không thấy mục ấy trên trang",
      infos.some((m) => m.includes("Không thấy mục Phần Thưởng Hoạt Động")),
    );

    // Trang TỪ CHỐI (hộp .nv-err): đúng MỘT cú bấm cho mỗi rương, không bấm lại vào cánh cửa
    // vừa đóng sập. Không có dấu jvz-pt-refused thì vòng lặp bấm đủ bốn lần.
    ptState = ptFresh();
    ptState.refuse = true;
    const ptRefuse = await run(ptQuest);
    check(
      "trang trả hộp lỗi → mỗi rương thử ĐÚNG MỘT lần rồi thôi (không bấm lại), hẹn 30 phút",
      ptState.claims.join() === "1,2" && ptRefuse.outcome === "onCooldown" &&
        ptRefuse.cooldownSeconds === 30 * 60,
      `${ptRefuse.outcome}: ${ptRefuse.cooldownSeconds}s; claims=${ptState.claims.join()}`,
    );
    check(
      "…và nhật ký nói rõ trang đã từ chối, kèm câu của trang",
      infos.some((m) => m.includes("TỪ CHỐI") && m.includes("Chưa đủ điều kiện")),
      infos.filter((m) => m.includes("TỪ CHỐI")).join(" / ") || "(không có dòng nào)",
    );

    // Twin thường dùng CHUNG script — chạy trọn một lượt để nó không chỉ tồn tại trên giấy.
    ptState = ptFresh();
    const ptF = await run(ptFree);
    check(
      "twin thường: cùng flow, cùng nhận đủ hai rương",
      ptF.outcome === "completed" && ptState.claims.join() === "1,2",
      `${ptF.outcome}; claims=${ptState.claims.join()}`,
    );

    console.log("\nKhoáng Mạch — cấu hình sai tên mỏ phải LỘ, không âm thầm đào mỏ khác");

    const kmWrongName = structuredClone(kmQuest);
    for (const o of kmWrongName.options) if (o.key === "mineName") o.selectedValue = "Mỏ Không Có Thật";
    kmState = kmFresh();
    await kmClearDay();
    const kmMiss = await run(kmWrongName);
    check(
      "không thấy mỏ cấu hình và không ở trong mỏ nào → quest đỏ, không bấm gì",
      kmMiss.outcome === "failed" && (await kmBody("data-entered")) == null,
      kmMiss.outcome,
    );

    // Twin thường dùng CHUNG script — một lượt đầy đủ để chắc nó không chỉ tồn tại trên giấy.
    const kmFree = exportedProfile.quests.find((q) => q.id === "khoang-mach-thuong");
    kmState = kmFresh();
    const kmF1 = await run(kmFree);
    check(
      "twin thường: cùng flow, cùng đồng hồ",
      kmF1.outcome === "onCooldown" && kmF1.cooldownSeconds === 18 * 60 && (await kmBody("data-entered")) === "1",
      `${kmF1.outcome}: ${kmF1.cooldownSeconds}s`,
    );

    // Lớp dịch config → hồ sơ: mỗi twin nhận ĐÚNG bộ tuỳ chọn của tab mình, đủ sáu khoá.
    {
      const translated = profileForConfig({
        quests: {
          khoangMach: { enabled: true, mineType: "1", mineName: "Địa", minBonus: 80, buyPhu: true, hostMode: true, hostMinBonus: 120 },
          khoangMachThuong: { enabled: true, mineType: "3", mineName: "Thạch Thôn", minBonus: 0, buyPhu: false, hostMode: false, hostMinBonus: 100 },
        },
      });
      const opt = (quest, key) => quest.options.find((o) => o.key === key)?.selectedValue;
      const vipT = translated.quests.find((q) => q.id === "khoang-mach");
      const freeT = translated.quests.find((q) => q.id === "khoang-mach-thuong");
      check(
        "twin VIP nhận tab VIP: loại 1, mỏ Địa, ngưỡng đào 80, MUA phù, đoạt bật ngưỡng 120",
        vipT.enabled === true && opt(vipT, "mineType") === "1" && opt(vipT, "mineName") === "Địa" &&
          opt(vipT, "minBonus") === "80" && !opt(vipT, "buyPhu").includes("«") &&
          !opt(vipT, "hostMode").includes("«") && opt(vipT, "hostMinBonus") === "120",
        JSON.stringify([opt(vipT, "mineType"), opt(vipT, "mineName"), opt(vipT, "minBonus"), opt(vipT, "buyPhu"), opt(vipT, "hostMode"), opt(vipT, "hostMinBonus")]),
      );
      check(
        "twin thường nhận tab Thường: loại 3, mỏ Thạch Thôn, KHÔNG mua phù, không đoạt",
        freeT.enabled === true && opt(freeT, "mineType") === "3" &&
          opt(freeT, "mineName") === "Thạch Thôn" && opt(freeT, "minBonus") === "0" &&
          opt(freeT, "buyPhu").includes("«") && opt(freeT, "hostMode").includes("«"),
        JSON.stringify([opt(freeT, "mineType"), opt(freeT, "mineName"), opt(freeT, "buyPhu"), opt(freeT, "hostMode")]),
      );
      // HAI ngưỡng phải đặt được ĐỘC LẬP — gộp chúng là mất hẳn một quyết định của người dùng.
      check(
        "hai ngưỡng độc lập: đào 80 ≠ đoạt 120 trên cùng một quest",
        opt(vipT, "minBonus") === "80" && opt(vipT, "hostMinBonus") === "120",
      );
    }

    console.log("\nHoang Vực — cooldown theo hạng tài khoản");

    // Luật in trên chính trang boss:「Tấn công boss mỗi 15 phút 1 lần, tối đa 5 lần mỗi ngày」.
    // Đó là nhịp của tài khoản THƯỜNG. Bản ghi 06/08 21:00 quay trên tài khoản VIP đo được nửa
    // còn lại: hồi đáp của đòn đánh mang mốc đánh kế cách 451 giây, và trang đếm ngược từ
    //「7 phút 20 giây」— VIP đúng một nửa. Con số 420 dùng chung trước đây sai cho cả hai.
    for (const [bossId, want] of [["hoang-vuc", 450], ["hoang-vuc-thuong", 900]]) {
      const q = exportedProfile.quests.find((x) => x.id === bossId);
      check(
        `${bossId}: nhịp ghé lại dự phòng = ${want}s`,
        q.fallbackCooldownSeconds === want,
        String(q.fallbackCooldownSeconds),
      );
    }

    console.log("\nHoang Vực — vỏ trang mời gọi KHÔNG phải lời mời thật");

    const bossQuest = exportedProfile.quests.find((q) => q.id === "hoang-vuc");
    const resetBoss = async () => {
      bossBroken = false;
      bossStateMs = 0;
      bossCooling = false;
      bossTurnsLeft = 5;
      bossReward = false;
      hvClaims.length = 0;
      await page.goto(`${baseUrl}/hoang-vuc`, { waitUntil: "domcontentloaded" });
    };

    // BẪY THẬT, tái hiện từ DOM của bản ghi: server giao nút KHIÊU CHIẾN đang MỞ và một đồng
    // hồ RỖNG mang display:none. Sự thật (đang cooldown) chỉ tới sau, qua XHR, và nó chỉ biết
    // LẤY ĐI lời mời. Nên một trang chưa vẽ xong trông y hệt trang nói「đánh được」— đây là
    // toàn bộ nguyên nhân của những đêm Hoang Vực không đánh được lượt nào.
    // 6000ms: đủ muộn để flow CŨ (không có đệm) chạy trọn tới cú bấm và bị từ chối TRƯỚC khi
    // đồng hồ kịp hiện — nếu không, nó sẽ ăn may khi XHR tình cờ ẩn nút giúp, và phép đối
    // chứng mất răng. Vẫn thừa trong cửa sổ 12s của flow mới.
    bossCooling = true;
    bossStateMs = 6000;
    bossTurnsLeft = 3;
    const bossTrap = await run(bossQuest);
    check(
      "đang cooldown mà vỏ trang mời gọi → CHỜ sự thật rồi dừng, không lao vào bấm",
      bossTrap.outcome === "onCooldown" && bossTrap.cooldownSeconds === 439,
      `${bossTrap.outcome}: ${bossTrap.cooldownSeconds}`,
    );
    check(
      "và tuyệt đối không có cú bấm nào bị server từ chối",
      (await page.getAttribute("body", "data-refused")) == null &&
        (await page.getAttribute("body", "data-attacked")) == null,
      `refused=${await page.getAttribute("body", "data-refused")} attacked=${await page.getAttribute("body", "data-attacked")}`,
    );

    // ĐỐI CHỨNG, giữ vĩnh viễn: chính flow CŨ (không có đệm chờ XHR) trên cùng fixture phải
    // lao vào bấm và bị server từ chối. Fixture nào để flow cũ đi qua êm là fixture đang nói dối.
    const noBuffer = structuredClone(bossQuest);
    noBuffer.steps = noBuffer.steps.filter(
      (s) => !(s.action === "waitForCondition" && s.optional === true && s.condition?.selector === "#countdown-timer"),
    );
    const confirmOld = noBuffer.steps.find(
      (s) => s.action === "waitForCondition" && s.condition?.selector === "#battle-button" && !s.optional,
    );
    confirmOld.timeoutMs = 3000; // hỏng thì hỏng nhanh, đang thử HÀNH VI chứ không thử con số
    await page.goto(`${baseUrl}/hoang-vuc`, { waitUntil: "domcontentloaded" });
    const bossOld = await run(noBuffer);
    check(
      "flow CŨ trên cùng cái bẫy: bấm vào cooldown và bị từ chối",
      bossOld.outcome === "failed" && (await page.getAttribute("body", "data-refused")) === "1",
      `${bossOld.outcome} · refused=${await page.getAttribute("body", "data-refused")}`,
    );

    console.log("\nHoang Vực — ba kết cục còn lại");

    // Còn lượt, không cooldown: đánh thật, tiêu đúng một lượt.
    await resetBoss();
    const bossHit = await run(bossQuest);
    check("đánh được → hoàn tất", bossHit.outcome === "completed", `${bossHit.outcome}: ${bossHit.message}`);
    check(
      "đọc được đồng hồ tới lượt kế (7 phút 19 giây) và tiêu ĐÚNG một lượt (5 → 4)",
      bossHit.cooldownSeconds === 439 &&
        (await page.getAttribute("body", "data-attacked")) === "1" &&
        (await page.locator("#luot").innerText()) === "4",
      `${bossHit.cooldownSeconds} · ${await page.locator("#luot").innerText()}`,
    );

    // Hết lượt hôm nay: bộ đếm do server render sẵn nói ngay từ nét vẽ đầu, nên lượt dừng
    // KHÔNG phải trả cửa sổ chờ nào — và nó nói đúng lý do, không lẫn với cooldown.
    await resetBoss();
    bossTurnsLeft = 0;
    const spentAt = Date.now();
    const bossSpent = await run(bossQuest);
    const spentMs = Date.now() - spentAt;
    check(
      "hết 5 lượt hôm nay → dừng đúng lý do, không lẫn với cooldown",
      bossSpent.outcome === "alreadyDone" && bossSpent.message === "đã hết 5 lượt hôm nay",
      `${bossSpent.outcome}: ${bossSpent.message}`,
    );
    check(
      `và không tốn cửa sổ chờ nào (đo được ${(spentMs / 1000).toFixed(1)}s) — bộ đếm là của server`,
      spentMs < 12000 && (await page.getAttribute("body", "data-attacked")) == null,
      `${spentMs}ms`,
    );

    // Cú bấm rơi vào hư không vẫn phải kêu to — bản vá 0.29.0, giữ nguyên giá trị.
    await resetBoss();
    bossBroken = true;
    const shortConfirm = structuredClone(bossQuest);
    shortConfirm.steps.find(
      (s) => s.action === "waitForCondition" && s.condition?.selector === "#battle-button" && !s.optional,
    ).timeoutMs = 3000;
    const bossMiss = await run(shortConfirm);
    check(
      "cú bấm rơi vào hư không → HỎNG, không nhận vơ là xong",
      bossMiss.outcome === "failed" && String(bossMiss.message ?? "").includes("#battle-button"),
      `${bossMiss.outcome}: ${bossMiss.message}`,
    );
    await resetBoss();

    console.log("\nHoang Vực — phần thưởng treo phải LĨNH TRƯỚC, rồi mới khiêu chiến");

    // Bản ghi hoang-vuc-20260818-013720 + lời dặn của tông chủ trong chính bản ghi ấy:「nếu ko
    // thấy nút khiêu chiến thay vào đó là nút nhận thưởng thì sẽ nhận thưởng thay vì khiêu
    // chiến」rồi「sau đó tiến hành flow khiêu chiến như bình thường」.
    await resetBoss();
    bossReward = true;
    await page.goto(`${baseUrl}/hoang-vuc`, { waitUntil: "domcontentloaded" });
    const bossReward1 = await run(bossQuest);
    check(
      "boss đã bị hạ + thưởng còn treo → LĨNH thưởng, rồi đánh tiếp trong CÙNG lượt ghé",
      hvClaims.length === 1 && (await page.getAttribute("body", "data-attacked")) === "1" &&
        bossReward1.outcome === "completed",
      `${bossReward1.outcome}; claims=${hvClaims.length}; attacked=${await page.getAttribute("body", "data-attacked")}`,
    );
    // ĐÂY LÀ CÁI BẪY THẬT, và là lý do bản vá này tồn tại: kịch bản cũ rơi vào lưới cuối
    //「nút KHIÊU CHIẾN không có trên trang」— một StopIf KHÔNG đồng hồ, tức alreadyDone. Mà
    // hoang-vuc nằm trong DAILY_QUOTA_QUEST_IDS, nên lượt ấy KHOÁ CẢ NGÀY: thưởng nằm đó không
    // ai lĩnh, và 5 lượt đánh của boss mới mất trắng theo.
    check(
      "…và TUYỆT ĐỐI không được khai là「hết lượt hôm nay」— cảnh này không phải hết ngày",
      bossReward1.outcome !== "alreadyDone" && bossReward1.dailyCapReached !== true,
      `${bossReward1.outcome}; capReached=${bossReward1.dailyCapReached}`,
    );
    check(
      "…nhật ký kể đúng những món vừa lĩnh, đọc từ chính hộp của trang",
      infos.some((m) => m.includes("Đã lĩnh thưởng Hoang Vực") && m.includes("1800 Tu Vi") && m.includes("390 Tinh Thạch")),
      infos.filter((m) => m.includes("lĩnh thưởng")).join(" / ") || "(không có dòng nào)",
    );

    // ĐỐI CHỨNG, giữ vĩnh viễn: bỏ cụm lĩnh thưởng ra khỏi kịch bản thì trên CÙNG fixture ấy
    // phải rơi đúng vào cái bẫy cũ. Fixture nào để kịch bản cũ đi qua êm là fixture nói dối.
    await resetBoss();
    bossReward = true;
    await page.goto(`${baseUrl}/hoang-vuc`, { waitUntil: "domcontentloaded" });
    const noClaim = structuredClone(bossQuest);
    noClaim.steps = noClaim.steps.filter(
      (st) => !String(st.script ?? "").includes("jvz-hv-reward") &&
        !String(st.selector ?? "").includes("jvz-hv-reward") &&
        !String(st.selector ?? "").includes("reward-notification") &&
        !(st.when?.selector === "body.jvz-hv-reward-go"),
    );
    const hvNoClaim = await run(noClaim);
    check(
      "kịch bản CŨ trên cùng cảnh ấy: khoá cả ngày và không lĩnh gì — đúng cái bẫy vừa vá",
      hvNoClaim.outcome === "alreadyDone" && hvNoClaim.dailyCapReached === true && hvClaims.length === 0,
      `${hvNoClaim.outcome}; capReached=${hvNoClaim.dailyCapReached}; claims=${hvClaims.length}`,
    );

    // Không có thưởng treo thì cụm này phải LẶN hoàn toàn — không một cú bấm thừa, không một
    // lượt tải lại thừa. Ca giữ cho bản vá không đánh thuế lên 99% lượt ghé bình thường.
    await resetBoss();
    const bossPlain = await run(bossQuest);
    check(
      "không có thưởng treo → cụm lĩnh thưởng lặn sạch, flow khiêu chiến chạy y như cũ",
      hvClaims.length === 0 && bossPlain.outcome === "completed" &&
        (await page.getAttribute("body", "data-attacked")) === "1" &&
        (await page.getAttribute("body", "data-claimed")) == null,
      `${bossPlain.outcome}; claims=${hvClaims.length}`,
    );

    // Twin thường dùng CHUNG kịch bản — chạy trọn một lượt để nó không chỉ đúng trên giấy.
    await resetBoss();
    bossReward = true;
    await page.goto(`${baseUrl}/hoang-vuc`, { waitUntil: "domcontentloaded" });
    const bossFree = await run(exportedProfile.quests.find((q) => q.id === "hoang-vuc-thuong"));
    check(
      "twin thường: cùng nhánh lĩnh thưởng, cùng đánh tiếp",
      hvClaims.length === 1 && bossFree.outcome === "completed" &&
        (await page.getAttribute("body", "data-attacked")) === "1",
      `${bossFree.outcome}; claims=${hvClaims.length}`,
    );
    await resetBoss();

    console.log("\nLuyện Đan Đường: giữ lửa phải chờ đúng VÙNG ĐẾM ĐƯỢC, không bấm bừa");

    // Sự cố nổ lò lần HAI (19:01 06/08), sau khi lần một đã được sửa. Lần một chờ chuỗi
    // 「68%」— sống đúng một giây lúc kim quét ngang. Bản sửa đổi sang `enabled #ldBtnTune`
    // với giả định site khoá nút tới khi % ≤ 68 — nhưng đọc luyen-dan.min.js trên trang thật
    // thì nút mở từ 99.98%: sáu cú Điều Hòa bay đi ở ~99-85%, server nhận đủ sáu request và
    // không đếm cú nào, lò nổ với 0/3. Cửa đúng là class `is-tune-weak` trang tự bật đúng
    // lúc một cú bấm sẽ được tính. Fixture này giờ mô hình đúng cả hai: nút mở sớm VÀ vùng
    // đếm được đến muộn — flow nào bấm theo nút sẽ bị `wasted` tố cáo.
    relightFurnace();
    const ldQuest = exportedProfile.quests.find((q) => q.id === "luyen-dan-duong");
    for (const ldId of ["luyen-dan-duong", "luyen-dan-duong-thuong"]) {
      const ld = exportedProfile.quests.find((q) => q.id === ldId);
      const rep = ld.steps.find((s) => s.action === "repeat");
      const gate = rep.steps[0];
      check(
        `${ldId}: cổng lần-đầu chờ vùng đếm được (is-tune-weak), không chờ nút mở khoá`,
        gate.condition?.kind === "visible" &&
          gate.condition?.selector === "#ldStabilityWrap.is-tune-weak" &&
          rep.maxSeconds === 300,
        JSON.stringify({ cond: gate.condition, maxSeconds: rep.maxSeconds }),
      );
    }
    // Ca ĐỐI CHỨNG, giữ vĩnh viễn: chính flow 1.45.0 (cổng enabled) chạy trên fixture này
    // phải THUA — bấm hụt ở ~98-75%, không cú nào được đếm, lưới an toàn tố cáo. Fixture cũ
    // xanh với flow ấy rồi production nổ lò; ca này tồn tại để fixture không bao giờ được
    // phép dễ tính như thế nữa. (Giá ~55s mỗi lượt smoke — rẻ hơn một mẻ 20 Tiên Ngọc.)
    const ldOldFlow = structuredClone(ldQuest);
    ldOldFlow.steps.find((s) => s.action === "repeat").steps[0].condition = {
      kind: "enabled",
      selector: "#ldBtnTune",
    };
    const ldOldRun = await run(ldOldFlow);
    tickFurnace();
    check(
      "flow 1.45.0 (chờ nút mở khoá) trên fixture trung thực: bấm hụt và bị tố cáo",
      ldOldRun.outcome === "failed" && furnace.tunes === 0 && furnace.wasted >= 1,
      `${ldOldRun.outcome} · đếm ${furnace.tunes} · hụt ${furnace.wasted}`,
    );

    relightFurnace();
    const ldRun = await run(ldQuest);
    tickFurnace();
    check(
      "giữ lửa đủ 3 lần — Đan Lô an toàn",
      furnace.tunes === 3 && furnace.phase === "cooking",
      `${furnace.phase} · ${furnace.tunes}/3 · ${furnace.log.join(" → ") || "(không lần nào)"}`,
    );
    // Đây là ranh giới giữa "chờ đúng cửa" và "bấm bừa cho tới khi trúng": flow cũ trên
    // fixture này bấm hụt đủ sáu phát ở ~98-73% rồi bỏ đi; flow đúng không hụt phát nào.
    check(
      "không một cú Điều Hòa nào bị bấm ngoài vùng đếm được",
      furnace.wasted === 0,
      `bấm hụt ${furnace.wasted} lần: ${furnace.log.join(" → ")}`,
    );
    check(
      "và lượt chạy tự nó cũng báo thuận",
      ldRun.outcome === "completed" || ldRun.outcome === "onCooldown",
      `${ldRun.outcome}: ${ldRun.message}`,
    );

    console.log("\nHỷ Sự Đường từ recording 05/08");

    // Vòng chúc phúc trọn vẹn: 3 phòng chưa chúc (hồng-nhan đứng đầu danh sách), mỗi vòng
    // vào một phòng, chọn lời chúc ngẫu nhiên, gửi qua hộp xác nhận, quay về mở lại modal —
    // cho tới khi server nói cả ba đều "Đã chúc".
    // ---- Cặp sinh đôi VIP/thường (schema 71) ------------------------------------------
    // Hỷ Sự Đường là quest đầu tiên có twin VIP dựng bằng cách DÙNG LẠI trọn bộ bước của bản
    // thường — hợp lệ vì cả sảnh lẫn hai loại phòng cưới đều là trang chung, không selector nào
    // đổi theo hạng. Ba phép kiểm dưới đây canh đúng ba chỗ một lượt「chép sang VIP」dễ hỏng:
    // khối bị chép lệch, hai bản lệch TÊN (thành ra một công tắc chỉ bật được một bản), và cửa
    // chia việc theo hạng phát nhầm bản cho tài khoản.
    const hySuVip = exportedProfile.quests.find((q) => q.id === "hy-su-duong");
    const hySuFree = exportedProfile.quests.find((q) => q.id === "hy-su-duong-thuong");
    const sansTier = (q) => {
      const { id, requiresVip, ...rest } = structuredClone(q);
      return JSON.stringify(rest);
    };
    check(
      "hồ sơ có đủ cặp sinh đôi Hỷ Sự Đường, đúng hạng mỗi bản",
      hySuVip?.requiresVip === true && hySuFree?.requiresVip === false,
      `vip=${hySuVip?.requiresVip} · thường=${hySuFree?.requiresVip}`,
    );
    check(
      "hai bản khác nhau ĐÚNG hai trường id + requiresVip — chặt hơn lưới copiedPairs, vốn còn nới nhịp ghé lại",
      sansTier(hySuVip) === sansTier(hySuFree),
      sansTier(hySuVip) === sansTier(hySuFree) ? "" : "hai khối đã trôi khỏi nhau",
    );
    // Lớp dịch cấu hình tìm quest theo TÊN, nên một công tắc bật cả hai bản. Hai bản lệch tên là
    // cách im lặng nhất để tài khoản VIP bật mà không có gì chạy.
    check(
      "hai bản cùng TÊN → một công tắc cấu hình bật cả hai",
      hySuVip?.name === hySuFree?.name,
      `${hySuVip?.name} vs ${hySuFree?.name}`,
    );
    {
      const { configSchema } = await import("../src/lib/services/configs.ts");
      const lit = profileForConfig(configSchema.parse({ quests: { hySuDuong: { enabled: true } } }), () => {});
      const on = lit.quests.filter((q) => q.id.startsWith("hy-su-duong") && q.enabled).map((q) => q.id);
      check(
        "bật một khoá hySuDuong → CẢ HAI bản sáng",
        on.length === 2 && on.includes("hy-su-duong") && on.includes("hy-su-duong-thuong"),
        on.join(",") || "(không bản nào sáng)",
      );
      const forVip = questsForAccount(lit, { isVip: true }).map((q) => q.id);
      const forFree = questsForAccount(lit, { isVip: false }).map((q) => q.id);
      check(
        "…nhưng mỗi tài khoản chỉ nhận ĐÚNG bản của hạng mình, không chạy cả hai",
        forVip.includes("hy-su-duong") && !forVip.includes("hy-su-duong-thuong") &&
          forFree.includes("hy-su-duong-thuong") && !forFree.includes("hy-su-duong"),
        `vip=[${forVip.join(",")}] · thường=[${forFree.join(",")}]`,
      );
    }
    const hySu = exportedProfile.quests.find((q) => q.id === "hy-su-duong-thuong");
    const hySuFirst = await run(hySu);
    check("chúc hết các phòng rồi hoàn tất", hySuFirst.outcome === "completed", `${hySuFirst.outcome}: ${hySuFirst.message}`);
    check(
      "cả ba phòng đều được chúc, ĐÚNG THỨ TỰ danh sách (hồng-nhan đứng đầu thì đi đầu)",
      JSON.stringify([...hySuBlessed.keys()]) === JSON.stringify(["230", "2534", "2533"]),
      [...hySuBlessed.keys()].join(","),
    );
    // Ghi chú của người ghi hình 15/08: "phòng nào có Trạng thái: Chưa chúc thì vào chúc ngay
    // bất kể có Trạng thái lì xì: Đã phát lì xì hay chưa". Phòng 2533 mang đúng cái nhãn ấy.
    check(
      "phòng ĐÃ PHÁT LÌ XÌ vẫn được vào chúc, không bị bộ lọc gạt ra",
      hySuBlessed.has("2533"),
      [...hySuBlessed.keys()].join(","),
    );
    check(
      "…và lời kể nói ra số phòng đã phát lì xì, để lượt chạy tự chứng minh điều đó",
      infos.some((m) => m.startsWith("Hỷ Sự Đường:") && m.includes("3 đã phát lì xì")),
      infos.filter((m) => m.startsWith("Hỷ Sự Đường:")).slice(-1)[0] ?? "(không có dòng nào)",
    );
    check(
      "lời chúc gửi đi là một lựa chọn THẬT của select — chọn ngẫu nhiên không rơi vào ô trống",
      [...hySuBlessed.values()].every((msg) => msg.trim().length > 0),
      [...hySuBlessed.values()].join(" / "),
    );
    // ĐÂY LÀ CA CHÍNH của bản vá 18/08/2026. Phòng 251 mang trạng thái "Đã chúc" nên bộ lọc
    // mặc định `.not-blessed` gạt nó ra; nó chỉ vào được bộ ứng viên nhờ dòng
    // `.wedding-now-li-xi-available`. Bản quest trước lượt vá này để hồng bao ấy hết hạn theo
    // tiệc mà không ai biết — nên phép thử này ĐỎ trên hồ sơ cũ, và đó là điều làm nó đáng có.
    check(
      "phòng ĐÃ CHÚC mà còn hồng bao vẫn được ghé, và hồng bao được khai",
      JSON.stringify(hySuLixi) === JSON.stringify(["251", "2595"]),
      hySuLixi.join(",") || "(không khai được cái nào)",
    );
    check(
      "…và lời kể đếm ra số phòng còn hồng bao chưa khai, ngay từ lần mở modal đầu",
      infos.some((m) => m.startsWith("Hỷ Sự Đường:") && m.includes("2 còn hồng bao chưa khai")),
      infos.filter((m) => m.startsWith("Hỷ Sự Đường:"))[0] ?? "(không có dòng nào)",
    );
    check(
      "…và lời kể gọi đúng tên món nhận được",
      infos.some((m) => m === "Khai phong lì xì: 49 Tiên Ngọc"),
      infos.filter((m) => m.includes("lì xì")).slice(-2).join(" / ") || "(không có dòng nào)",
    );
    // Khay che kín trang (`position:fixed; inset:0; pointer-events:all`), nên bỏ quên bước đóng
    // là để lại một tấm chắn trước form chúc của chính phòng ấy.
    check(
      "khay hồng bao được ĐÓNG lại sau khi khai",
      JSON.stringify(hySuTrayClosed) === JSON.stringify(["251", "2595"]),
      hySuTrayClosed.join(",") || "(không đóng khay nào)",
    );
    // CA CHÍNH của lượt vá 19/08/2026: phòng 2595 là ĐẠO LỮ — khay của nó mang bộ id trần
    // (#liXiModal · #openButton · #closeButton) chứ không phải #hn*. Trước lượt vá, cụm hồng
    // bao chỉ biết bộ #hn*, nên flow vào tới phòng rồi đứng nhìn cái khay: hồng bao hết hạn theo
    // tiệc mà nhật ký vẫn xanh. Phép thử này ĐỎ trên hồ sơ cũ, và đó là điều làm nó đáng có.
    check(
      "phòng ĐẠO LỮ có hồng bao: khai được bằng bộ id trần, không phải bộ #hn*",
      hySuLixi.includes("2595") && hySuTrayClosed.includes("2595"),
      `lixi=${hySuLixi.join(",")}; tray=${hySuTrayClosed.join(",")}`,
    );
    check(
      "…và lời kể gọi đúng món của phòng ấy, đọc từ thiệp .lixi-reward-* chứ không phải #hnReward*",
      infos.filter((m) => m.startsWith("Khai phong lì xì:")).length === 2,
      infos.filter((m) => m.startsWith("Khai phong lì xì:")).join(" / ") || "(không có dòng nào)",
    );
    // Ba phòng kia không có hồng bao: khay dựng sẵn nhưng không bao giờ `.active`. Nếu phép quét
    // hỏi thẳng #hnOpenBtn (conditionProbe chỉ đọc chính phần tử, không leo cha) thì cả ba sẽ
    // báo "có hồng bao" rồi đẻ ra ba dòng TRƯỢT — con số dưới đây là thứ bắt được chuyện đó.
    check(
      "phòng không có hồng bao thì không đòi khai, và không kêu trượt oan",
      infos.filter((m) => m.startsWith("KHAI HỒNG BAO TRƯỢT")).length === 0,
      infos.filter((m) => m.startsWith("KHAI HỒNG BAO TRƯỢT")).join(" / "),
    );
    check(
      "tường thuật gọi tên từng cặp đôi được ghé (ba phòng để chúc + hai phòng để khai hồng bao)",
      infos.filter((m) => m.startsWith("Vào phòng:")).length === 5,
      infos.filter((m) => m.startsWith("Vào phòng:")).join(" / "),
    );
    // "Không có việc thì phải nói ra": mỗi lần mở modal đều kể con số, nên người đọc nhật ký
    // phân biệt được "danh sách rỗng" với "6 tiệc nhưng đều đã chúc" mà không phải đoán.
    check(
      "mỗi lần mở modal đều kể con số: tổng, đã chúc, khớp bộ lọc, còn chưa ghé",
      infos.filter((m) => m.startsWith("Hỷ Sự Đường:") && m.includes("còn chưa ghé:")).length >= 4,
      infos.filter((m) => m.startsWith("Hỷ Sự Đường:")).slice(0, 2).join(" / "),
    );

    // Ghé lại khi đã chúc hết: modal vẫn mở, danh sách vẫn về, nhưng không còn .not-blessed
    // nào — dừng bằng lời người, không bấm thêm gì.
    const hySuAgain = await run(hySu);
    check(
      "lần hai dừng ở \"không có phòng nào khớp bộ lọc để ghé\"",
      hySuAgain.outcome === "alreadyDone" && hySuAgain.message === "không có phòng nào khớp bộ lọc để ghé",
      `${hySuAgain.outcome}: ${hySuAgain.message}`,
    );
    check("và không gửi thêm lời chúc nào", hySuBlessed.size === 3, String(hySuBlessed.size));

    // Tuỳ chọn "đã chúc" (ghi chú 6 của bản ghi 11/08). Ba phòng giờ đều đã chúc, nên bộ lọc
    // này phải VÀO ĐƯỢC cả ba — và không gửi thêm lời chúc nào, vì site bỏ hẳn form ở phòng đã
    // chúc. Bản trước bước này chờ #blessing-default-options 25 giây rồi chết ở MỌI phòng.
    {
      const blessedOnly = JSON.parse(JSON.stringify(hySu));
      blessedOnly.options.find((o) => o.key === "blessFilter").selectedValue = ".blessed";
      const before = infos.length;
      const visitBlessed = await run(blessedOnly);
      const entered = infos.slice(before).filter((m) => m.startsWith("Vào phòng:"));
      check(
        "lọc \"đã chúc\" → vào được cả năm phòng đã chúc, không chết ở bước chờ form",
        visitBlessed.outcome === "completed" && entered.length === 5,
        `${visitBlessed.outcome}: ${visitBlessed.message} — vào ${entered.length} phòng`,
      );
      check(
        "…và KHÔNG gửi thêm lời chúc nào (phòng đã chúc không còn form)",
        hySuBlessed.size === 3,
        String(hySuBlessed.size),
      );
      check(
        "…và nói rõ từng phòng là đã chúc rồi",
        infos.slice(before).filter((m) => m.includes("đã chúc rồi")).length === 5,
        infos.slice(before).filter((m) => m.includes("đã chúc rồi")).length + " dòng",
      );
      // Sổ đã ghé là thứ làm vòng lặp TIẾN ở chế độ này: chúc xong không làm giảm số .blessed,
      // nên dừng theo trạng thái phòng sẽ quay vòng cho tới khi hết 15 vòng / 30 phút.
      check(
        "…và vòng lặp DỪNG, không quay lại phòng cũ",
        entered.length === new Set(entered).size,
        entered.join(" / "),
      );
    }

    // ——— Cái vá của 15/08/2026: một phòng hỏng KHÔNG được giết những phòng chưa ai ghé.
    //
    // Đây là hình dạng tông chủ báo ("quest chúc còn sót các phòng cưới") và là hình dạng bộ
    // chạy thử này đã ghi nguyên văn ở mục "Trang chưa dựng xong": engine kết liễu cả script
    // ngay khi một bước bắt buộc trong thân repeat hỏng, nên phòng thứ hai vấp là phòng thứ ba
    // không ai ghé. Phòng ở GIỮA danh sách được chọn làm phòng hỏng: nó chứng minh cả hai vế —
    // phòng trước nó vẫn xong, phòng SAU nó vẫn được ghé.
    {
      hySuBlessed.clear();
      hySuBrokenRooms.add("2534");
      const before = infos.length;
      const partial = await run(hySu);
      const said = infos.slice(before);
      check(
        "một phòng lạ giữa danh sách → lượt vẫn xong, KHÔNG chết ở đó",
        partial.outcome === "completed",
        `${partial.outcome}: ${partial.message}`,
      );
      check(
        "…và hai phòng còn lại (cả phòng ĐỨNG SAU phòng hỏng) vẫn được chúc",
        JSON.stringify([...hySuBlessed.keys()]) === JSON.stringify(["230", "2533"]),
        [...hySuBlessed.keys()].join(","),
      );
      check(
        "…và phòng hỏng được gọi ĐÍCH DANH trong lời kể cuối lượt, không lặng lẽ biến mất",
        said.some((m) => m.includes("TRƯỢT 1") && m.includes("𝙐𝙮ê𝙣𝙉𝙝𝙞")),
        said.filter((m) => m.startsWith("Hỷ Sự Đường:")).slice(-1)[0] ?? "(không có dòng nào)",
      );
      hySuBrokenRooms.clear();
    }

    // …nhưng "mỗi phòng tự chịu lỗi" KHÔNG được biến "cả trang đã đổi" thành một lượt báo xong.
    // Ghé phòng nào cũng trượt = hỏng thật, và phải hỏng to.
    {
      hySuBlessed.clear();
      for (const room of hySuRooms) hySuBrokenRooms.add(room.id);
      const allBad = await run(hySu);
      check(
        "ghé phòng nào cũng trượt → nhiệm vụ HỎNG, không nhận vơ là xong",
        allBad.outcome === "failed",
        `${allBad.outcome}: ${allBad.message}`,
      );
      check("…và không gửi được lời chúc nào", hySuBlessed.size === 0, String(hySuBlessed.size));
      hySuBrokenRooms.clear();
      hySuBlessed.clear();
    }

    // Hết mùa cưới: modal mở ra danh sách RỖNG — phải phân biệt được với "đã chúc hết".
    // (Ca này trả giá 15s chờ optional của danh sách — giữ nguyên timeout thật của hồ sơ.)
    hySuRooms.length = 0;
    const hySuEmpty = await run(hySu);
    check(
      "không có tiệc nào → dừng ở \"không có tiệc cưới nào đang diễn ra\"",
      hySuEmpty.outcome === "alreadyDone" && hySuEmpty.message === "không có tiệc cưới nào đang diễn ra",
      `${hySuEmpty.outcome}: ${hySuEmpty.message}`,
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

    console.log("\nTrang chưa dựng xong → tải lại và chạy lại cả nhiệm vụ, tối đa 3 lượt");

    // Sự cố 07/08 22:09: 「Hỷ Sự Đường: repeat vòng 3: Trang chưa dựng xong sau 25s」. Chạy
    // lại từ bước 0 chứ không chỉ bước hỏng — xem MAX_PAGE_RENDER_ATTEMPTS trong engine.mjs.
    {
      const flakyQuest = (extra = []) =>
        questOf([
          { action: "navigate", text: "/flaky", timeoutMs: 5000 },
          ...extra,
        ]);

      // --- Hỏng lượt đầu, dựng kịp ở lượt hai → phải THÀNH CÔNG, và trang được tải 2 lần.
      flakyVisits = 0;
      flakyAppearsOnVisit = 2;
      const recovered = await run(
        flakyQuest([{ action: "waitForSelector", selector: "#late-mark", timeoutMs: 700 }]),
      );
      check(
        "trang dựng kịp ở lượt hai → nhiệm vụ thành công nhờ chạy lại",
        recovered.outcome === "completed" && flakyVisits === 2,
        `${recovered.outcome}, số lượt tải trang = ${flakyVisits}`,
      );

      // --- Không bao giờ dựng → đúng BA lượt rồi bỏ cuộc. Con số này là cả yêu cầu.
      flakyVisits = 0;
      flakyAppearsOnVisit = Number.POSITIVE_INFINITY;
      const exhausted = await run(
        flakyQuest([{ action: "waitForSelector", selector: "#late-mark", timeoutMs: 700 }]),
      );
      check(
        "không dựng nổi → thử ĐÚNG 3 lượt rồi mới chịu hỏng",
        exhausted.outcome === "failed" && flakyVisits === 3,
        `${exhausted.outcome}, số lượt tải trang = ${flakyVisits}`,
      );

      // --- Bước waitForSelector TUỲ CHỌN trượt thì không được châm ngòi thử lại: script đi
      // tiếp bình thường, và cái hỏng sau đó là chuyện khác hẳn.
      flakyVisits = 0;
      flakyAppearsOnVisit = Number.POSITIVE_INFINITY;
      const optionalMiss = await run(
        flakyQuest([
          { action: "waitForSelector", selector: "#late-mark", timeoutMs: 400, optional: true },
          { action: "click", selector: "#khong-ton-tai", timeoutMs: 400 },
        ]),
      );
      check(
        "waitForSelector tuỳ chọn trượt → KHÔNG chạy lại, trang chỉ tải một lần",
        optionalMiss.outcome === "failed" && flakyVisits === 1,
        `${optionalMiss.outcome}, số lượt tải trang = ${flakyVisits}`,
      );

      // --- waitForCondition KHÔNG được chạy lại. Đây là hàng rào của Hoang Vực: bước bằng
      // chứng đòn đánh là waitForCondition, và chạy lại nó nghĩa là đánh boss thêm lần nữa.
      flakyVisits = 0;
      flakyAppearsOnVisit = Number.POSITIVE_INFINITY;
      const conditionMiss = await run(
        flakyQuest([
          {
            action: "waitForCondition",
            timeoutMs: 700,
            condition: { kind: "visible", selector: "#late-mark" },
          },
        ]),
      );
      check(
        "waitForCondition trượt → KHÔNG chạy lại (hàng rào cho bằng chứng đòn đánh Hoang Vực)",
        conditionMiss.outcome === "failed" && flakyVisits === 1,
        `${conditionMiss.outcome}, số lượt tải trang = ${flakyVisits}`,
      );
    }

    console.log("\nLời nhắn Trò Chuyện Đội của Mê Cung (recording 08/08)");

    // Chạy ĐÚNG các bước chat trong hồ sơ thật (không chép lại script vào test — chép là
    // hai bản sẽ lệch nhau ngày ai đó sửa một bên) trên fixture giả widget mc-chat.
    {
      const mc = loadProfileForSchema().quests.find((q) => q.id === "me-cung");
      const lobbyStep = mc.steps.find((s) => s.script?.includes("{{chatLobby}}"));
      const fightStep = mc.steps
        .find((s) => s.action === "repeat")
        .steps.find((s) => s.script?.includes("{{chatFight}}"));
      check(
        "hồ sơ có đủ hai bước chat, cả hai đều optional — lỡ hụt không được phép hỏng cả lượt Mê Cung",
        Boolean(lobbyStep) && Boolean(fightStep) && lobbyStep.optional === true && fightStep.optional === true,
        JSON.stringify({ lobby: Boolean(lobbyStep), fight: Boolean(fightStep) }),
      );

      const chatQuest = (steps, message) =>
        questOf(
          [{ action: "navigate", text: "/mc-chat", timeoutMs: 5000 }, ...steps],
          [
            { key: "chatLobby", label: "t", choices: [], allowCustom: true, selectedValue: message },
            { key: "chatFight", label: "t", choices: [], allowCustom: true, selectedValue: message },
          ],
        );
      const sentInPage = () => session.evaluate("() => window.__sent");

      // --- Có lời nhắn → sendChatMsg của site nhận đúng chuỗi ---
      const lobbySent = await run(chatQuest([lobbyStep], "đang tuyển người, auto đây"));
      check(
        "lời nhắn sảnh tới tay sendChatMsg nguyên vẹn",
        lobbySent.outcome === "completed" &&
          JSON.stringify(await sentInPage()) === JSON.stringify(["đang tuyển người, auto đây"]),
        `${lobbySent.outcome}, __sent=${JSON.stringify(await sentInPage())}`,
      );

      // --- Lời nhắn rỗng → im lặng đi tiếp, không gửi gì ---
      const lobbyEmpty = await run(chatQuest([lobbyStep], ""));
      check(
        "lời nhắn rỗng → không gửi gì, nhiệm vụ vẫn thuận",
        lobbyEmpty.outcome === "completed" && (await sentInPage()).length === 0,
        `${lobbyEmpty.outcome}, __sent=${JSON.stringify(await sentInPage())}`,
      );

      // --- Trận: gửi đúng MỘT lần cho cả lượt ghé, dù bước chạy lại mỗi trận ---
      const fightTwice = await run(chatQuest([fightStep, fightStep, fightStep], "đang đánh boss"));
      check(
        "bước chat trận chạy 3 lần trong một lượt ghé → chỉ gửi MỘT tin (đúng recording)",
        fightTwice.outcome === "completed" &&
          JSON.stringify(await sentInPage()) === JSON.stringify(["đang đánh boss"]),
        `${fightTwice.outcome}, __sent=${JSON.stringify(await sentInPage())}`,
      );

      // --- Widget vắng mặt (phòng chat chưa dựng) → bước optional, lượt vẫn thuận ---
      const noWidget = await run(
        questOf(
          [{ action: "navigate", text: "/mc-chat-cut", timeoutMs: 5000 }, lobbyStep, fightStep],
          [
            { key: "chatLobby", label: "t", choices: [], allowCustom: true, selectedValue: "xin chào" },
            { key: "chatFight", label: "t", choices: [], allowCustom: true, selectedValue: "xin chào" },
          ],
        ),
      );
      check(
        "widget vắng mặt → cả hai bước chat lặng lẽ bỏ qua, không hỏng nhiệm vụ",
        noWidget.outcome === "completed",
        noWidget.outcome,
      );
    }

    console.log("\nCổng điều phối toàn cục — hai làn riêng: trang riêng ≤ 2, hub ≤ 5");

    // Hai làn riêng: trang riêng ≤ 2, hub ≤ 5, không tranh ngân sách của nhau. Khối này dựng
    // lại đúng hình dạng sự cố 07/08 (Mê Cung + Hoang Vực) — nay chúng ĐƯỢC cặp, vì tông chủ
    // đã nới trần; cái phải canh giờ là con thứ BA và trần của từng làn.
    {
      const tick = () => new Promise((r) => setTimeout(r, 20));
      const grab = (dedicated, name, shouldStop) => {
        const holder = { admitted: false, aborted: false, slot: null };
        holder.promise = acquireQuestSlot({ dedicated, name, shouldStop }).then((result) => {
          if (result.aborted) holder.aborted = true;
          else {
            holder.admitted = true;
            holder.slot = result;
          }
        });
        return holder;
      };

      const meCung = grab(true, "Mê Cung");
      const hoangVuc = grab(true, "Hoang Vực");
      await tick();
      check(
        "hai trang riêng ĐƯỢC chạy cùng nhau — đúng điều luật cũ cấm tuyệt đối",
        meCung.admitted && hoangVuc.admitted,
        `meCung=${meCung.admitted} hoangVuc=${hoangVuc.admitted}`,
      );

      const boss3 = grab(true, "Trang riêng thứ ba");
      await tick();
      check("trang riêng thứ BA phải xếp hàng — trần làn là 2", !boss3.admitted, "con thứ ba chen được vào");

      const hubs = [1, 2, 3, 4, 5].map((n) => grab(false, `Hub ${n}`));
      await tick();
      check(
        "năm hub vào đủ dù hai trang riêng đang chạy — hai làn KHÔNG tranh ngân sách",
        hubs.every((h) => h.admitted),
        hubs.map((h) => h.admitted).join("/"),
      );

      const hub4 = grab(false, "Hub 6");
      await tick();
      check("hub thứ SÁU hết chỗ — trần làn hub là 5", !hub4.admitted, "hub6 chen được vào");
      check(
        "hub mới KHÔNG phải nhường trang riêng đang đợi — luật nhường đã gỡ cùng lúc tách làn",
        !boss3.admitted,
        "con thứ ba lại vào được",
      );

      hubs[0].slot.release();
      await tick();
      check(
        "hub buông thì hub sau vào, KHÔNG mở chỗ cho trang riêng — hai làn độc lập",
        hub4.admitted && !boss3.admitted,
        `hub4=${hub4.admitted} boss3=${boss3.admitted}`,
      );

      meCung.slot.release();
      await tick();
      check("chỗ trang riêng trống ra là con thứ ba vào ngay", boss3.admitted, "con thứ ba vẫn chờ");

      hoangVuc.slot.release();
      boss3.slot.release();
      hubs[1].slot.release();
      hubs[2].slot.release();
      hub4.slot.release();
      await tick();

      // FIFO TRONG LÀN: trang riêng xếp trước không bị con sau vượt mặt.
      const full = [grab(true, "Giữ A"), grab(true, "Giữ B")];
      await tick();
      const som = grab(true, "Đợi sớm");
      await tick();
      const muon = grab(true, "Đợi muộn");
      await tick();
      check("cả hai chỗ trang riêng đã đầy", full.every((h) => h.admitted) && !som.admitted && !muon.admitted);
      full[0].slot.release();
      await tick();
      check(
        "chỗ trống về tay kẻ đợi SỚM, không phải kẻ tới sau",
        som.admitted && !muon.admitted,
        `som=${som.admitted} muon=${muon.admitted}`,
      );
      full[1].slot.release();
      som.slot.release();
      await tick();
      muon.slot?.release();

      // Thu Đàn giữa lúc xếp hàng: waiter rút lui, không kẹt sau lưng ai.
      const holderA = [grab(true, "Đang giữ 1"), grab(true, "Đang giữ 2")];
      await tick();
      let stopped = false;
      const quitter = grab(true, "Sắp thu đàn", () => stopped);
      await tick();
      stopped = true;
      await new Promise((r) => setTimeout(r, 700)); // nhịp poll 500ms phải tự nhặt nó ra
      check("Thu Đàn trong hàng đợi → rút lui qua nhịp poll, không chờ ai buông cổng", quitter.aborted, `aborted=${quitter.aborted}`);
      for (const h of holderA) h.slot.release();

      _resetGate();
    }

    console.log("\nLàn độc quyền theo tên — Mê Cung trên khôi lỗi tông môn: mỗi lúc một trận");

    // Luật 22/08/2026: server gửi soloQuestNames=["Mê Cung"] cho khôi lỗi tông môn ở claim,
    // runCycle gắn cờ `exclusive` cho nhiệm vụ mang tên ấy. Khối này đóng đinh các chốt của
    // cổng: trần 1 theo TÊN, kẻ đợi vì tên không giam ghế của người khác (bài học「hub nhường」
    // đã trả giá), FIFO giữa hai kẻ cùng tên, kẹt-cả-ghế-lẫn-tên vẫn chặn làn như thường, và
    // không cờ (khôi lỗi riêng, server đời cũ) thì nếp cặp đôi từ 09/08 còn nguyên.
    {
      const tick = () => new Promise((r) => setTimeout(r, 20));
      const grab = (name, { exclusive = false } = {}) => {
        const holder = { admitted: false, aborted: false, slot: null };
        holder.promise = acquireQuestSlot({ dedicated: true, exclusive, name }).then((result) => {
          if (result.aborted) holder.aborted = true;
          else {
            holder.admitted = true;
            holder.slot = result;
          }
        });
        return holder;
      };

      const tranA = grab("Mê Cung", { exclusive: true });
      await tick();
      const tranB = grab("Mê Cung", { exclusive: true });
      await tick();
      check(
        "trận Mê Cung thứ hai phải chờ dù làn trang riêng còn ghế — trần 1 theo tên",
        tranA.admitted && !tranB.admitted,
        `A=${tranA.admitted} B=${tranB.admitted}`,
      );

      const hoangVuc = grab("Hoang Vực");
      await tick();
      check(
        "Hoang Vực tới SAU vẫn vào ghế trống — kẻ đợi vì tên không chặn làn",
        hoangVuc.admitted,
        "Hoang Vực bị bắt xếp hàng sau một Mê Cung chỉ kẹt tên",
      );

      const tranC = grab("Mê Cung", { exclusive: true });
      await tick();
      tranA.slot.release();
      await tick();
      check(
        "Mê Cung buông thì kẻ đợi SỚM cùng tên vào, kẻ muộn tiếp tục chờ — FIFO theo tên",
        tranB.admitted && !tranC.admitted,
        `B=${tranB.admitted} C=${tranC.admitted}`,
      );

      tranB.slot.release();
      await tick();
      check("kẻ cùng tên còn lại vào nốt khi tới lượt", tranC.admitted, `C=${tranC.admitted}`);
      tranC.slot.release();
      hoangVuc.slot.release();
      await tick();

      // Kẹt CẢ ghế lẫn tên: phân loại theo LÝ DO kẹt, không theo loại nhiệm vụ — đang tranh
      // ghế thì chặn làn như mọi trang riêng khác, hết tranh ghế thì thôi.
      const giuMaze = grab("Mê Cung", { exclusive: true });
      const giuHV = grab("Hoang Vực");
      await tick();
      const doiMaze = grab("Mê Cung", { exclusive: true });
      await tick();
      const doiTeLe = grab("Tế Lễ");
      await tick();
      check(
        "làn đầy → kẻ tới sau không vượt mặt Mê Cung đang kẹt ghế",
        giuMaze.admitted && giuHV.admitted && !doiMaze.admitted && !doiTeLe.admitted,
        `giữ=${giuMaze.admitted}/${giuHV.admitted} đợi=${doiMaze.admitted}/${doiTeLe.admitted}`,
      );
      giuHV.slot.release();
      await tick();
      check(
        "ghế trống mà Mê Cung còn kẹt tên → ghế về tay kẻ sau, không bị giam theo",
        doiTeLe.admitted && !doiMaze.admitted,
        `teLe=${doiTeLe.admitted} maze=${doiMaze.admitted}`,
      );
      giuMaze.slot.release();
      await tick();
      check("Mê Cung đầu xong → kẻ cùng tên đang đợi vào ngay", doiMaze.admitted, `maze=${doiMaze.admitted}`);
      doiMaze.slot.release();
      doiTeLe.slot.release();
      await tick();

      // Khôi lỗi riêng không nhận soloQuestNames → không cờ exclusive: hai tài khoản cùng
      // đánh Mê Cung vẫn được cặp như từ 09/08 — luật mới không đổi nếp của máy nhà đạo hữu.
      const rieng1 = grab("Mê Cung");
      const rieng2 = grab("Mê Cung");
      await tick();
      check(
        "không cờ độc quyền (khôi lỗi riêng) → hai Mê Cung vẫn chạy cặp như cũ",
        rieng1.admitted && rieng2.admitted,
        `r1=${rieng1.admitted} r2=${rieng2.admitted}`,
      );
      rieng1.slot.release();
      rieng2.slot.release();

      _resetGate();
    }

    // Phân loại phải đọc từ hồ sơ thật, không từ một danh sách tay: twin thường của Điểm
    // Danh sống trên /diem-danh nên NÓ là trang riêng dù bản VIP là hub.
    {
      const classified = loadProfileForSchema();
      const byId = (id) => classified.quests.find((q) => q.id === id);
      check(
        // khoang-mach đổi phe từ schema 58: stub cũ không có pagePath (= hub), bản thật sống
        // trên /khoang-mach/?nv_embed=1 — trang riêng, ăn ghế own-page của questGate.
        "phân loại theo hồ sơ: hoang-vuc & diem-danh-thuong & khoang-mach = trang riêng; diem-danh = hub",
        isDedicatedPageQuest(classified, byId("hoang-vuc")) &&
          isDedicatedPageQuest(classified, byId("diem-danh-thuong")) &&
          isDedicatedPageQuest(classified, byId("khoang-mach")) &&
          !isDedicatedPageQuest(classified, byId("diem-danh")),
        ["hoang-vuc", "diem-danh-thuong", "khoang-mach", "diem-danh"]
          .map((id) => `${id}=${isDedicatedPageQuest(classified, byId(id))}`)
          .join(" "),
      );
    }

    console.log("\nTiến độ vòng chạy — thứ Hàng Đợi Công Việc hiển thị");

    // Chạy runCycle THẬT trên Chromium thật trước sảnh giả, chỉ để soi một thứ: chuỗi tiến
    // độ nó phát ra. Đây là phần duy nhất của tính năng mà server không tự suy ra được, nên
    // nếu nó im lặng hoặc kể sai thì hàng đợi nói dối — mà một cái đếm sai thì không ai bắt
    // được bằng mắt.
    //
    // Hai nhiệm vụ hạng thường có sẵn trong hồ sơ, hai trang mà máy chủ giả này đã phục vụ
    // cho các ca ở trên; đặt cuối cùng để không nhiệm vụ nào ở đây đụng vào trạng thái mà
    // các ca trước còn cần.
    const progressConfig = {
      gameCookie: "wordpress_logged_in_smoke=1",
      accountTier: "free",
      runner: "local",
      quests: { diemDanh: { enabled: true }, thiLuyen: { enabled: true } },
    };

    // Hai nhiệm vụ của vòng này đều là TRANG RIÊNG ở hạng thường (/diem-danh và
    // /thi-luyen-…). Từ 09/08/2026 chúng ĐƯỢC chạy cùng nhau — làn trang riêng có hai chỗ —
    // nên phép thử này thôi khẳng định "nối đuôi" mà canh hai TRẦN: không ảnh chụp nào được
    // vượt 5 tổng hay 2 trang riêng. Observer ghi mọi ảnh chụp cổng, nên nếu một ngày ai đó
    // nới trần mà quên chỗ này, dòng dưới đỏ ngay.
    //
    // Vẫn là phép thử tích hợp của đúng đêm 07/08 — thứ nó canh nay là cái TRẦN, không phải
    // con số 1.
    const gateSnapshots = [];
    _observeGate((snap) => gateSnapshots.push(snap));

    const parallelBeats = [];
    const parallelCycle = await runCycle({
      chromium,
      baseUrl,
      config: { ...progressConfig },
      say: () => {},
      reportProgress: (beat) => parallelBeats.push(beat),
      shouldStop: () => false,
    });

    _observeGate(null);
    check(
      "cổng toàn cục: không ảnh chụp nào vượt trần (tổng ≤ 7, trang riêng ≤ 2)",
      gateSnapshots.length > 0 &&
        gateSnapshots.every((snap) => snap.active <= 7 && snap.dedicatedActive <= 2),
      gateSnapshots.map((snap) => `${snap.active}/${snap.dedicatedActive}`).join(" → ") || "(không ảnh nào)",
    );

    check(
      "vòng chạy tới nơi trên sảnh giả",
      parallelCycle.outcome === "done",
      `${parallelCycle.outcome}: ${parallelCycle.message}`,
    );
    check(
      "nhịp đầu tiên đã nói '0/2' — hàng đợi có chữ ngay, không đợi nhiệm vụ đầu xong",
      parallelBeats.length > 0 &&
        parallelBeats[0].done === 0 &&
        parallelBeats[0].total === 2 &&
        parallelBeats[0].running.length === 0,
      JSON.stringify(parallelBeats[0]),
    );
    check(
      "nhịp cuối: xong cả hai, không còn nhiệm vụ nào trong tay",
      parallelBeats.at(-1)?.done === 2 && parallelBeats.at(-1)?.running.length === 0,
      JSON.stringify(parallelBeats.at(-1)),
    );
    check(
      "gọi đúng tên cả hai nhiệm vụ đã chạy",
      ["Điểm Danh", "Thí Luyện Tông Môn"].every((name) =>
        parallelBeats.some((beat) => beat.running.includes(name)),
      ),
      [...new Set(parallelBeats.flatMap((beat) => beat.running))].join(" · ") || "(không tên nào)",
    );
    // Cái đếm chỉ được đi tới. Một `finished++` đặt nhầm chỗ trong nhánh song song là con số
    // nhảy lùi giữa vòng — thứ người dùng đọc thành "chạy lại từ đầu".
    check(
      "số đã xong không bao giờ lùi, và không bao giờ vượt tổng",
      parallelBeats.every(
        (beat, i) =>
          beat.total === 2 &&
          beat.done <= beat.total &&
          (i === 0 || beat.done >= parallelBeats[i - 1].done),
      ),
      parallelBeats.map((beat) => `${beat.done}/${beat.total}`).join(" → "),
    );
    // Tên mắc kẹt trong `runningNow` là lỗi dễ xảy ra nhất ở đây (một ngả return sớm quên
    // dọn), và triệu chứng của nó là hàng đợi khoe một nhiệm vụ đã xong từ lâu.
    check(
      "không tên nào mắc kẹt lại sau khi nhiệm vụ đã rời tay",
      parallelBeats.every((beat) => beat.running.length + beat.done <= beat.total),
      parallelBeats.map((beat) => `[${beat.running.join(",")}]${beat.done}`).join(" → "),
    );

    const serialBeats = [];
    const serialCycle = await runCycle({
      chromium,
      baseUrl,
      config: { ...progressConfig },
      say: () => {},
      reportProgress: (beat) => serialBeats.push(beat),
      shouldStop: () => false,
    });
    check(
      "nhánh tuần tự cũng kể tiến độ, và không bao giờ cầm hai nhiệm vụ một lúc",
      serialCycle.outcome === "done" &&
        serialBeats.at(-1)?.done === 2 &&
        serialBeats.every((beat) => beat.running.length <= 1),
      serialBeats.map((beat) => `[${beat.running.join(",")}]${beat.done}/${beat.total}`).join(" → "),
    );

    console.log("\nTrang câm: dừng sớm và nói đúng nguyên nhân (sự cố 07/08)");

    // Đêm 07/08: site trả trang câm, cổng sẵn sàng vẫn phát「phiên đăng nhập còn hiệu lực」
    // rồi thả cả vòng vào 9 nhiệm vụ — mỗi cái chết sau 25 giây ở một selector vô tội. Bốn
    // phút đỏ mỗi vòng, nửa tiếng một lần, không dòng nào nhắc tới nguyên nhân thật.
    {
      const muteLines = [];
      const muteBeats = [];
      const startedAt = Date.now();
      let muteCycle;
      siteMute = true;
      try {
        muteCycle = await runCycle({
          chromium,
          baseUrl,
          config: { ...progressConfig },
          say: (message, level) => muteLines.push(`${level ?? "info"}: ${message}`),
          reportProgress: (beat) => muteBeats.push(beat),
          shouldStop: () => false,
        });
      } finally {
        // Cờ này bịt MỌI đường dẫn của máy chủ giả — rò nó ra ngoài là mọi ca sau đều hỏng
        // vì một lý do chẳng liên quan gì tới chúng.
        siteMute = false;
      }
      const elapsedMs = Date.now() - startedAt;

      check(
        "trang câm → vòng chạy DỪNG, không lao vào nhiệm vụ nào",
        muteCycle.outcome === "failed",
        `${muteCycle.outcome}: ${muteCycle.message}`,
      );
      // Đây là cả sự khác biệt giữa bản đã sửa và bản gây ra sự cố.
      check(
        "và KHÔNG còn dòng nào khẳng định「phiên đăng nhập còn hiệu lực」",
        !muteLines.some((line) => line.includes("phiên đăng nhập còn hiệu lực")),
        muteLines.join(" | ") || "(im lặng)",
      );
      check(
        "thông điệp gọi đúng tên hai nhân chứng đã câm, và chỉ đường sửa",
        String(muteCycle.message).includes("phiên đăng nhập") &&
          String(muteCycle.message).includes("hub") &&
          String(muteCycle.message).includes("cookie"),
        muteCycle.message,
      );
      // Không nhiệm vụ nào được cầm lên: `total` chỉ có mặt khi kế hoạch đã lập, mà vòng
      // này dừng trước đó.
      check(
        "không nhiệm vụ nào bị đem ra đốt 25 giây",
        muteBeats.length === 0,
        muteBeats.map((beat) => `${beat.done}/${beat.total}`).join(" → "),
      );
      // Hai nhiệm vụ × 25s = 50s ở bản cũ; giờ chỉ tốn đúng quãng dò hub có trần 20s.
      check(
        "và dừng NHANH — không còn trả giá 25 giây cho mỗi nhiệm vụ",
        elapsedMs < 45_000,
        `${Math.round(elapsedMs / 1000)}s`,
      );
    }

    console.log("\nSite dời tên miền: gọi đúng tên cú 301 (sự cố .am → .one)");

    // Gõ cửa bằng "tên miền cũ" (localhost) mà máy chủ 301 sang 127.0.0.1: cùng một máy chủ,
    // khác origin — đúng hình dạng một cú dời TLD, không cần DNS thật.
    const oldDomainBase = baseUrl.replace("127.0.0.1", "localhost");
    const runFromOldDomain = async (lines) =>
      runCycle({
        chromium,
        baseUrl: oldDomainBase,
        config: { ...progressConfig },
        say: (message, level) => lines.push(`${level ?? "info"}: ${message}`),
        reportProgress: () => {},
        shouldStop: () => false,
      });

    // NỬA THỨ NHẤT — dời tên miền mà phiên vẫn sống thì KHÔNG phải sự cố, và không được
    // phép cắt vòng. Phép dừng cố ý là PHÉP HỘI của hai nhân chứng; ca này canh đúng điều
    // đó, vì một cái dừng quá tay ở đây sẽ chặn đứng automation mỗi lần site đổi TLD dù
    // mọi thứ vẫn chạy tốt.
    {
      const lines = [];
      const benign = await runFromOldDomain(lines);
      check(
        "dời tên miền mà phiên vẫn sống → cứ chạy tiếp, không cắt vòng",
        benign.outcome === "done",
        `${benign.outcome}: ${benign.message}`,
      );
    }

    // NỬA THỨ HAI — nguyên nhân THẬT của đêm 07/08: tên miền mới không nhận ra khôi lỗi nữa
    // (cookie gắn theo tên miền nên không đi theo cú 301). Trước bản này, toàn bộ chuỗi ấy
    // hiện ra dưới dạng chín dòng「không thấy .nv-quest」.
    {
      const lines = [];
      let moved;
      siteMute = true;
      try {
        moved = await runFromOldDomain(lines);
      } finally {
        siteMute = false;
      }

      check(
        "dời tên miền + trang mới không nhận ra khôi lỗi → gọi đúng tên cú 301, cả hai đầu và việc phải làm",
        moved.outcome === "failed" &&
          String(moved.message).includes("dời tên miền") &&
          String(moved.message).includes("localhost") &&
          String(moved.message).includes("127.0.0.1") &&
          String(moved.message).includes("cookie"),
        `${moved.outcome}: ${moved.message}`,
      );
      check(
        "và vẫn không có dòng nào khẳng định phiên đăng nhập còn hiệu lực",
        !lines.some((line) => line.includes("phiên đăng nhập còn hiệu lực")),
        lines.join(" | ") || "(im lặng)",
      );
    }

    // NỬA THỨ BA — tên miền do SERVER gửi kèm job phải thắng hằng số trong mã nguồn của máy
    // chạy khôi lỗi. Đây là cả cơ chế khiến trưởng môn đổi được tên miền mà không ai phải cài
    // lại khôi lỗi.
    //
    // CỐ Ý KHÔNG truyền `baseUrl`: tham số truyền thẳng đứng TRÊN config trong thứ tự ưu
    // tiên, nên truyền cả hai là phép thử xanh kể cả khi `gameBaseUrl` bị bỏ qua sạch. Bỏ nó
    // đi thì đường duy nhất còn lại tới máy chủ giả là qua config — và nếu engine phớt lờ
    // trường ấy, nó sẽ đi hỏi hoathinh3d thật rồi hỏng, đúng như phải thế.
    {
      const lines = [];
      const fromConfig = await runCycle({
        chromium,
        config: { ...progressConfig, gameBaseUrl: baseUrl },
        say: (message, level) => lines.push(`${level ?? "info"}: ${message}`),
        reportProgress: () => {},
        shouldStop: () => false,
      });

      check(
        "tên miền server gửi kèm job dẫn đường được cả vòng chạy — đổi tên miền không cần cài lại khôi lỗi",
        fromConfig.outcome === "done" && lines.some((line) => line.includes("Điểm Danh")),
        `${fromConfig.outcome}: ${fromConfig.message}`,
      );
    }

    console.log("\nSổ đủ lượt hôm nay — nhiệm vụ ngày đã đủ lượt thì vòng sau không mở lại");

    // PHẠM VI, đối chiếu HAI CHIỀU với hồ sơ thật. Danh sách trong dailyQuota.mjs khoá theo ID,
    // nên một cú đổi ID bên hồ sơ sẽ lặng lẽ tắt tính năng — không có ca này thì cái tắt ấy chỉ
    // lộ ra qua việc mỗi vòng lại mở đủ chín trang như cũ, thứ không ai nhìn ra bằng mắt.
    {
      const profileNow = loadProfileForSchema();
      const idsInProfile = new Set(profileNow.quests.map((quest) => quest.id));
      const strayIds = [...DAILY_QUOTA_QUEST_IDS].filter((id) => !idsInProfile.has(id));
      check(
        "mọi ID trong sổ nhiệm vụ ngày còn tồn tại trong hồ sơ",
        strayIds.length === 0,
        strayIds.join(", ") || "(sạch)",
      );

      // Cùng phép đối chiếu ấy cho danh sách「lượt cuối mở sau cùng」— nó cũng khoá theo ID, nên
      // cũng lặng lẽ hết tác dụng nếu hồ sơ đổi ID. CHỈ bản VIP có mặt, từ 15/08/2026: bản thường
      // đã rời cả sổ ngày lẫn cổng này vì trang riêng của nó không phân biệt được「đủ 4」với
      //「lượt 4 đang khoá」— xem khối ghi chú trong dailyQuota.mjs.
      const gatedStrays = [...PEER_GATED_QUEST_IDS].filter((id) => !idsInProfile.has(id));
      check(
        "Vòng Quay bản VIP còn trong hồ sơ và trong danh sách chờ-nhiệm-vụ-khác",
        gatedStrays.length === 0 && PEER_GATED_QUEST_IDS.has("vong-quay-phuc-van"),
        gatedStrays.join(", ") || `(${PEER_GATED_QUEST_IDS.size} ID)`,
      );
      check(
        "…và bản THƯỜNG đứng ngoài cả hai danh sách — một lượt「Hết lượt」của nó không được khoá cả ngày",
        !PEER_GATED_QUEST_IDS.has("vong-quay-phuc-van-thuong") &&
          !DAILY_QUOTA_QUEST_IDS.has("vong-quay-phuc-van-thuong"),
      );

      // Chiều ngược: chín cái tên được yêu cầu, quy về ID. Cặp twin VIP/thường trùng tên nhau
      // và trần lượt là của TÀI KHOẢN, nên cả hai bản đều phải có mặt.
      const dailyNames = [
        "Điểm Danh",
        "Phúc Lợi Đường",
        "Hoang Vực",
        "Thí Luyện Tông Môn",
        "Tế Lễ Tông Môn",
        "Phúc Lợi VIP — Khắc Trận Văn",
        "Vòng Quay Phúc Vận",
        "Vấn Đáp",
        "Bí Cảnh Tông Môn",
      ];
      // MỘT ngoại lệ, và nó phải được gọi tên chứ không lặng lẽ lọt qua: bản THƯỜNG của Vòng
      // Quay đứng ngoài sổ từ 15/08/2026 (trang riêng của nó không phân biệt được「đủ 4」với
      //「lượt 4 đang khoá」— xem dailyQuota.mjs). Viết thẳng ID vào đây thay vì nới điều kiện,
      // để ngày ai đó bỏ sót một twin khác thì lưới vẫn đỏ.
      const OUTSIDE_BY_DESIGN = new Set(["vong-quay-phuc-van-thuong"]);
      const missing = profileNow.quests
        .filter((quest) => dailyNames.includes(quest.name) && !DAILY_QUOTA_QUEST_IDS.has(quest.id))
        .map((quest) => quest.id)
        .filter((id) => !OUTSIDE_BY_DESIGN.has(id));
      check(
        "cả chín nhiệm vụ ngày đều có trong sổ, kể cả twin VIP/thường (trừ đúng một ngoại lệ đã khai)",
        missing.length === 0,
        missing.join(", ") || "(đủ)",
      );
      check(
        "…và ngoại lệ ấy là THẬT: bản thường của Vòng Quay có trong hồ sơ nhưng ngoài sổ",
        profileNow.quests.some((q) => q.id === "vong-quay-phuc-van-thuong") &&
          !DAILY_QUOTA_QUEST_IDS.has("vong-quay-phuc-van-thuong"),
      );

      // Và KHÔNG được lan sang những nhiệm vụ mà `alreadyDone` chỉ là một trạng thái thoáng
      // qua: nhớ nhầm Mê Cung là tắt mất nhiệm vụ đáng giá nhất của cả ngày, trong im lặng.
      // Khoáng Mạch RỜI danh sách đứng-ngoài từ schema 58: trần của nó là trần NGÀY thật
      // (hai ô x/y do server render, stopIf「đã đầy」không kèm đồng hồ), đúng hình dạng sổ
      // này sinh ra để nhớ — khác hẳn Mê Cung/Luyện Đan, nơi alreadyDone chỉ thoáng qua.
      const intruders = profileNow.quests
        .filter((quest) => ["Mê Cung", "Luyện Đan Đường", "Hỷ Sự Đường"].includes(quest.name))
        .filter((quest) => DAILY_QUOTA_QUEST_IDS.has(quest.id))
        .map((quest) => quest.id);
      check(
        "Mê Cung · Luyện Đan · Hỷ Sự Đường đứng ngoài sổ; Khoáng Mạch (cả twin) phải Ở TRONG",
        intruders.length === 0 &&
          DAILY_QUOTA_QUEST_IDS.has("khoang-mach") &&
          DAILY_QUOTA_QUEST_IDS.has("khoang-mach-thuong"),
        intruders.join(", ") || "(sạch)",
      );
    }

    // NGUỒN của lượt dừng mới là thứ quyết định, không phải kết cục `alreadyDone`. Đây là chỗ
    // cả thiết kế đứng hoặc đổ: hai ca dưới đây cùng ra `alreadyDone`, và chỉ MỘT trong hai
    // được phép vào sổ.
    {
      // Về lại sảnh thử TRƯỚC mỗi ca: mấy vòng runCycle phía trên đã kéo trang này đi khắp nơi,
      // và một điều kiện không khớp vì phần tử không có mặt trông y hệt một điều kiện sai.
      const asDailyQuest = (steps) => ({
        ...questOf([{ action: "navigate", text: "/", timeoutMs: 15000 }, ...steps]),
        id: "diem-danh",
        name: "Điểm Danh",
      });

      const bySite = await run(
        asDailyQuest([
          {
            action: "stopIf",
            text: "hết lượt hôm nay",
            condition: { kind: "textMatches", selector: "#btn-disabled", text: "Đã nhận" },
          },
        ]),
      );
      check(
        "trang game tự nói hết lượt → alreadyDone CÓ dấu đủ lượt ngày",
        bySite.outcome === "alreadyDone" && bySite.dailyCapReached === true,
        `${bySite.outcome} cap=${bySite.dailyCapReached}`,
      );
      check("…và được ghi vào sổ", reachedDailyQuota({ id: "diem-danh" }, bySite) === true);

      // Vấn Đáp dừng vì KHÔI LỖI chưa biết đáp án — giới hạn của ta, không phải của tài khoản.
      // Ghi nó vào sổ là khoá cứng nhiệm vụ cả ngày đúng vào lúc kho đáp án có thể vừa học
      // thêm được câu ấy ở vòng sau.
      const byUs = await run(
        asDailyQuest([
          {
            action: "answerQuiz",
            selector: "#question",
            optionsSelector: "#quiz-fixture .quiz-option",
            timeoutMs: 5000,
          },
        ]),
      );
      check(
        "chưa có kho đáp án → vẫn alreadyDone nhưng KHÔNG có dấu đủ lượt ngày",
        byUs.outcome === "alreadyDone" && byUs.dailyCapReached === false,
        `${byUs.outcome} cap=${byUs.dailyCapReached}: ${byUs.message}`,
      );
      check("…nên không vào sổ", reachedDailyQuota({ id: "diem-danh" }, byUs) === false);

      // Lớp gác thứ hai: dấu đúng, nhưng nhiệm vụ không nằm trong phạm vi thì vẫn đứng ngoài.
      check(
        "nhiệm vụ ngoài phạm vi mang dấu vẫn không vào sổ",
        reachedDailyQuota({ id: "me-cung" }, bySite) === false,
      );

      // ĐƯỜNG THỨ HAI vào sổ: làm trọn cả 5 câu Vấn Đáp trong MỘT phiên thì「xong」đã là hết
      // ngày. Thiếu nó thì lượt chạy THẬT của ngày là lượt duy nhất không ghi được gì, và đàn
      // cứ mở lại trang ấy mỗi vòng — đo trên đàn thật 11/08/2026: xong lúc 21:55, 22:12,
      // 22:31, 22:48, 23:06 cho một nhiệm vụ cả ngày chỉ có 5 câu.
      const finished = { outcome: "completed", message: "xong" };
      check(
        "Vấn Đáp báo xong → vào sổ ngay, không đợi tới vòng sau",
        reachedDailyQuota({ id: "van-dap" }, finished) === true &&
          reachedDailyQuota({ id: "van-dap-thuong" }, finished) === true,
      );
      // Và KHÔNG lan sang nhiệm vụ nhiều lượt: Bí Cảnh có 5 lượt một ngày, ghi sổ ngay lượt
      // đầu là tự tay vứt bốn lượt còn lại — im lặng, và mỗi ngày một lần.
      check(
        "nhiệm vụ ngày nhiều lượt báo xong thì KHÔNG vào sổ",
        reachedDailyQuota({ id: "bi-canh-tong-mon" }, finished) === false &&
          reachedDailyQuota({ id: "diem-danh" }, finished) === false,
      );
      // Danh sách thứ hai phải nằm TRỌN trong danh sách thứ nhất: `reachedDailyQuota` gác bằng
      // `isDailyQuotaQuest` trước, nên một ID lạc vào đây sẽ không bao giờ có tác dụng — một
      // dòng chết trông y hệt một dòng đang chạy.
      const outsiders = [...COMPLETION_ENDS_DAY_QUEST_IDS].filter(
        (id) => !DAILY_QUOTA_QUEST_IDS.has(id),
      );
      check(
        "mọi ID của đường「xong là hết ngày」đều nằm trong sổ nhiệm vụ ngày",
        outsiders.length === 0,
        outsiders.join(", ") || "(sạch)",
      );

      // ─── LƯỢT CUỐI MỞ SAU CÙNG: Vòng Quay Phúc Vận ────────────────────────────────────
      //
      // Cả cụm này canh đúng một cái bẫy đã ĐO được trên trạm đang phục vụ ngày 15/08/2026:
      // 20:41「hết lượt quay hôm nay」→ 20:44 vào sổ → 20:51「Bỏ qua … Vòng Quay Phúc Vận」.
      // Site cho 4 lượt/ngày và khoá lượt thứ 4 tới khi xong hết nhiệm vụ ngày, nên lượt ghé
      // DUY NHẤT lấy được vòng ấy chính là lượt mà sổ vừa cấm. Không dòng nhật ký nào đỏ.
      const wheelStop = { outcome: "alreadyDone", dailyCapReached: true, message: "hết lượt quay hôm nay" };

      check(
        "vòng quay báo hết lượt khi nhiệm vụ ngày khác còn dở → KHÔNG vào sổ",
        reachedDailyQuota({ id: "vong-quay-phuc-van" }, wheelStop, { peersDone: false }) === false &&
          reachedDailyQuota({ id: "vong-quay-phuc-van-thuong" }, wheelStop, { peersDone: false }) === false,
      );
      // Bản THƯỜNG: KHÔNG có ngả nào vào sổ, kể cả ngả mà bản VIP đi được. Trang riêng của nó
      // đọc「Hết lượt」y hệt nhau ở hai cảnh「đủ 4」và「lượt 4 đang khoá」, nên một lời khai như thế
      // không đủ tư cách khoá cả ngày. Đây là ca tông chủ báo 15/08: thường chỉ quay được 3.
      check(
        "bản THƯỜNG không bao giờ vào sổ — kể cả khi mọi nhiệm vụ ngày khác đã xong",
        reachedDailyQuota({ id: "vong-quay-phuc-van-thuong" }, wheelStop, { peersDone: true }) === false,
      );
      check(
        "…và quên truyền cờ thì ngả về đúng phía an toàn ấy",
        reachedDailyQuota({ id: "vong-quay-phuc-van" }, wheelStop) === false,
      );
      check(
        "xong hết nhiệm vụ ngày khác rồi mà VẪN hết lượt → bấy giờ mới vào sổ",
        reachedDailyQuota({ id: "vong-quay-phuc-van" }, wheelStop, { peersDone: true }) === true,
      );
      // Cổng thứ ba chỉ mở cho đúng hai ID ấy. Nếu nó rò ra nhiệm vụ ngày thường thì mọi thứ
      // trong sổ đều phải đợi nhau, và cái giá là mở lại chín trang mỗi vòng như thời chưa có sổ.
      check(
        "cờ ấy KHÔNG đụng tới nhiệm vụ ngày thường",
        reachedDailyQuota({ id: "diem-danh" }, wheelStop, { peersDone: false }) === true,
      );
      // Và lời khai vẫn phải đến TỪ TRANG GAME: peersDone không cứu nổi một lượt dừng do chính
      // khôi lỗi bó tay (Vấn Đáp chưa biết đáp án).
      check(
        "peersDone không biến lượt dừng của CHÍNH TA thành đủ lượt",
        reachedDailyQuota(
          { id: "vong-quay-phuc-van" },
          { outcome: "alreadyDone", dailyCapReached: false },
          { peersDone: true },
        ) === false,
      );

      const wheel = { id: "vong-quay-phuc-van" };
      const peer = { id: "phuc-loi-duong" };
      const notDaily = { id: "me-cung" };
      check(
        "peersDoneForQuota: còn một nhiệm vụ ngày chưa vào sổ → CHƯA xong",
        peersDoneForQuota(wheel, [wheel, peer, notDaily], []) === false,
      );
      check(
        "…cái ấy vào sổ ngay trong vòng này → xong",
        peersDoneForQuota(wheel, [wheel, peer, notDaily], ["phuc-loi-duong"]) === true,
      );
      check(
        "nhiệm vụ ngoài sổ ngày (Mê Cung) không giữ vòng quay lại",
        peersDoneForQuota(wheel, [wheel, notDaily], []) === true,
      );
      check(
        "chính nó không tự tính là bạn đồng hành của mình",
        peersDoneForQuota(wheel, [wheel], []) === true && peersDoneForQuota(wheel, [], []) === true,
      );
      // Kế hoạch của vòng SAU đã bị `splitPlanForToday` cắt hết những cái vào sổ từ vòng trước —
      // đây là hình dạng thật của cái vòng ghé cuối cùng, cái lấy được vòng quay thứ 4.
      check(
        "vòng sau, kế hoạch chỉ còn vòng quay + việc ngoài sổ → xong",
        peersDoneForQuota(wheel, [wheel, notDaily, { id: "luyen-dan-duong" }], []) === true,
      );

      const gatedOutsiders = [...PEER_GATED_QUEST_IDS].filter((id) => !DAILY_QUOTA_QUEST_IDS.has(id));
      check(
        "mọi ID chờ-nhiệm-vụ-khác đều nằm trong sổ nhiệm vụ ngày",
        gatedOutsiders.length === 0,
        gatedOutsiders.join(", ") || "(sạch)",
      );
    }

    console.log("\nĐồng hồ ghé lại: một stopIf phải CHẶN được bước đọc đồng hồ đứng sau nó");

    // Đây là giả định CHỊU LỰC của bước「ghé lại sau 60s」cuối script Mê Cung (schema 64). Mê
    // cung không có đồng hồ của máy chủ, nên bước ấy tự khai một con số nhỏ để runner quay lại
    // đánh tiếp thay vì ngủ trọn tiếng theo fallbackCooldownSeconds. Nhưng ngả「đã đủ huyền
    // tinh hôm nay」thì MUỐN trọn tiếng ấy — và nó được miễn phí đúng nhờ một điều: `stopIf`
    // khớp là cắt luôn phần đuôi của danh sách bước, nên bước đọc đồng hồ không bao giờ chạy.
    //
    // Không có hai ca dưới đây thì ngày ai đó sửa `executeSteps` cho chạy tiếp sau stopIf, Mê
    // Cung sẽ lặng lẽ hoá thành một vòng gõ cửa mỗi phút suốt cả ngày đã đủ huyền tinh — xanh
    // hết, không dòng nào đỏ.
    {
      const stopThenClock = await run(
        questOf([
          { action: "navigate", text: "/", timeoutMs: 15000 },
          {
            action: "stopIf",
            text: "hết lượt hôm nay",
            condition: { kind: "textMatches", selector: "#btn-disabled", text: "Đã nhận" },
          },
          { action: "readCooldownSeconds", script: "() => 60", timeoutMs: 4000 },
        ]),
      );
      check(
        "stopIf khớp → bước đọc đồng hồ đứng sau KHÔNG chạy, giữ nguyên trần fallback",
        stopThenClock.outcome === "alreadyDone" && stopThenClock.cooldownSeconds === 3600,
        `${stopThenClock.outcome} / ${stopThenClock.cooldownSeconds}s`,
      );

      const clockOnly = await run(
        questOf([
          { action: "navigate", text: "/", timeoutMs: 15000 },
          { action: "readCooldownSeconds", script: "() => 60", timeoutMs: 4000 },
        ]),
      );
      check(
        "chạy trọn script → con số của bước ấy THẮNG fallback",
        clockOnly.outcome === "completed" && clockOnly.cooldownSeconds === 60,
        `${clockOnly.outcome} / ${clockOnly.cooldownSeconds}s`,
      );

      // Và script hỏng thì phải rơi về hành vi cũ, không phải làm hỏng lượt chạy: `evaluate`
      // nuốt lỗi của chính nó rồi trả undefined, nên cooldown ở nguyên null.
      const clockBroken = await run(
        questOf([
          { action: "navigate", text: "/", timeoutMs: 15000 },
          { action: "readCooldownSeconds", script: "() => { throw new Error('vỡ'); }", timeoutMs: 4000 },
        ]),
      );
      check(
        "script đọc đồng hồ vỡ → vẫn completed, và rơi về trần fallback",
        clockBroken.outcome === "completed" && clockBroken.cooldownSeconds === 3600,
        `${clockBroken.outcome} / ${clockBroken.cooldownSeconds}s`,
      );
    }

    // --- ba ca tích hợp trên runCycle thật --------------------------------------------
    const dailyConfig = {
      gameCookie: "wordpress_logged_in_smoke=1",
      accountTier: "free",
      runner: "local",
      quests: { diemDanh: { enabled: true }, thiLuyen: { enabled: true } },
    };
    /** Mở trình duyệt trong ca này là SAI — nên cái được truyền vào sẽ kêu to. */
    const forbiddenChromium = {
      launch: () => {
        throw new Error("vòng này lẽ ra không được mở trình duyệt");
      },
      launchPersistentContext: () => {
        throw new Error("vòng này lẽ ra không được mở trình duyệt");
      },
    };

    {
      const lines = [];
      const beats = [];
      const partial = await runCycle({
        chromium,
        baseUrl,
        config: dailyConfig,
        dailyDone: { day: "2026-08-11", questIds: ["diem-danh-thuong"], resetsInSeconds: 3600 },
        say: (message) => lines.push(message),
        reportProgress: (beat) => beats.push(beat),
        shouldStop: () => false,
      });

      check(
        "sổ có Điểm Danh → vòng này chỉ còn hành sự Thí Luyện",
        partial.outcome === "done" &&
          lines.some((line) => line.startsWith("Sẽ hành sự: Thí Luyện Tông Môn.")) &&
          beats.at(-1)?.total === 1,
        `${partial.outcome} | ${lines.filter((l) => l.startsWith("Sẽ hành sự")).join(" / ")} | total=${beats.at(-1)?.total}`,
      );
      check(
        "…và nói ra đã bỏ qua cái gì, không lặng lẽ bớt việc",
        lines.some((line) => line.includes("Bỏ qua 1 nhiệm vụ đã đủ lượt hôm nay: Điểm Danh")),
        lines.join(" | "),
      );
    }

    {
      const lines = [];
      const idle = await runCycle({
        chromium: forbiddenChromium,
        baseUrl,
        config: dailyConfig,
        dailyDone: {
          day: "2026-08-11",
          questIds: ["diem-danh-thuong", "thi-luyen-tong-mon-thuong"],
          resetsInSeconds: 3600,
        },
        say: (message) => lines.push(message),
        reportProgress: () => {},
        shouldStop: () => false,
      });

      check(
        "mọi nhiệm vụ đã đủ lượt → KHÔNG mở trình duyệt lần nào",
        idle.outcome === "done" && lines.some((line) => line.includes("không mở trình duyệt")),
        `${idle.outcome}: ${idle.message}`,
      );
      // Ngủ tới sau mốc sang ngày thay vì ghé lại mỗi năm phút: 3600 + 60 nhịp trễ + jitter
      // 0–25 giây. Không có chốt này thì một tài khoản đã xong việc vẫn đẻ 288 dòng nhật ký
      // mỗi ngày và chôn mất phần kể chuyện thật.
      check(
        "…và ngủ tới sau mốc sang ngày, không ghé lại sau 5 phút",
        idle.nextDelaySeconds >= 3660 && idle.nextDelaySeconds <= 3685,
        String(idle.nextDelaySeconds),
      );
      check("…không khai thêm gì vào sổ", Array.isArray(idle.dailyCapQuestIds) && idle.dailyCapQuestIds.length === 0);
    }

    // Hạng CHƯA CHỨNG MINH thì cấm tắt máy sớm: hạng quyết định kế hoạch, và đoán sai ở đây là
    // bỏ trắng cả một ngày chạy. Bằng chứng duy nhất chấp nhận được là trình duyệt VẪN mở.
    {
      let opened = false;
      try {
        await runCycle({
          chromium: forbiddenChromium,
          baseUrl,
          config: { ...dailyConfig, accountTier: null },
          dailyDone: {
            day: "2026-08-11",
            questIds: ["diem-danh-thuong", "thi-luyen-tong-mon-thuong", "diem-danh", "thi-luyen-tong-mon"],
            resetsInSeconds: 3600,
          },
          say: () => {},
          reportProgress: () => {},
          shouldStop: () => false,
        });
      } catch (err) {
        opened = String(err.message).includes("không được mở trình duyệt");
      }
      check("hạng chưa dò được → vẫn mở trình duyệt, không tắt máy sớm theo phỏng đoán", opened);
    }

    {
      const cycleLines = [];
      checkInDone = true;
      let observed;
      try {
        observed = await runCycle({
          chromium,
          baseUrl,
          config: dailyConfig,
          dailyDone: { day: "2026-08-11", questIds: [], resetsInSeconds: 3600 },
          say: (message) => cycleLines.push(message),
          reportProgress: () => {},
          shouldStop: () => false,
        });
      } finally {
        checkInDone = false;
      }

      check(
        "vòng gặp nhiệm vụ đã đủ lượt → khai đúng một cái tên về cho server",
        observed.outcome === "done" &&
          Array.isArray(observed.dailyCapQuestIds) &&
          observed.dailyCapQuestIds.length === 1 &&
          observed.dailyCapQuestIds[0] === "diem-danh-thuong",
        `${observed.outcome}: ${JSON.stringify(observed.dailyCapQuestIds)}`,
      );
      check(
        "…và báo cho người đọc biết vòng sau sẽ thôi mở trang ấy",
        cycleLines.some((line) => line.includes("Đã đủ lượt hôm nay: Điểm Danh")),
        cycleLines.join(" | "),
      );

      // Hoạt động là màn kể chuyện tu luyện, không phải nơi đổ ruột gan bộ máy. Chốt này ra
      // đời sau một lượt để lọt thật: dòng「Trình duyệt: mở bằng Chromium đầy đủ」từng được
      // nâng lên info để chứng minh một bản vá, rồi hiện lên đúng màn người dùng đọc.
      //
      // Bắt theo TỪ VỰNG chứ không theo một câu cụ thể — sửa lại lời văn mà vẫn để nó lên
      // Hoạt động thì vẫn phải đỏ. Muốn nhìn những dòng này: đọc log khôi lỗi (mức debug).
      const TU_VUNG_KERNEL = [
        "mở bằng",
        "Chromium đầy đủ",
        "chrome-headless-shell",
        "đường lui",
      ];
      const dinhKernel = (line) =>
        TU_VUNG_KERNEL.some((tu) => line.toLowerCase().includes(tu.toLowerCase()));

      // Chốt phải TỰ CHỨNG MINH LÀ CÓ RĂNG. Một phép「không có gì lọt」đứng một mình vẫn xanh
      // hồi hộp kể cả khi từ vựng gõ sai và nó chẳng bắt được gì — tức canh gác bằng một cái
      // lưới thủng. Nên đối chứng bằng ĐÚNG câu đã lọt ra thật ở 1.3.24.
      check(
        "chốt kernel có răng — vẫn bắt được đúng câu đã lọt ra hồi 1.3.24",
        dinhKernel("Trình duyệt: mở bằng Chromium đầy đủ.") &&
          dinhKernel("Trình duyệt: mở bằng chrome-headless-shell (đường lui).") &&
          !dinhKernel("Điểm Danh: đã điểm danh hôm nay"),
      );

      const loLot = cycleLines.filter(dinhKernel);
      check(
        "Hoạt động KHÔNG dính log kernel — chuyện binary/trình duyệt thuộc tầng khôi lỗi",
        loLot.length === 0,
        `lọt: ${loLot.join(" | ")}`,
      );
    }

    // Cửa giao thức: sổ chỉ có nghĩa khi nó đi được cả hai chiều trên dây. Hai chốt đọc thẳng
    // mã nguồn route vì đây là chỗ duy nhất nối engine với database, và nó không có phép thử
    // nào khác chạy được mà không dựng cả Next.
    check(
      "op claim gửi kèm sổ đủ lượt của đúng đàn ấy",
      workerRouteSrc.includes("dailyDone: dailyQuotaPlan(job.dailyDone)"),
    );
    check(
      "op complete chuyển tiếp lời khai kèm NGÀY, và bỏ qua khi thiếu một trong hai",
      /body\.dailyDay && body\.dailyCapQuestIds\?\.length/.test(workerRouteSrc),
    );
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
