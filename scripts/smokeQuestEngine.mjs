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
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createQuestEngine } from "../src/lib/quest-engine/engine.mjs";
import { createSession } from "../src/lib/quest-engine/session.mjs";
import { mapWithLimit, parseCookieString, runCycle } from "../src/lib/quest-engine/runCycle.mjs";
// Nhập thẳng từ module LÁ: `detectWordPressUser` chỉ biết định dạng cookie, không đi qua engine.
import { detectWordPressUser } from "../src/lib/quest-engine/cookies.mjs";
import {
  _observeGate,
  _resetGate,
  acquireQuestSlot,
  isDedicatedPageQuest,
} from "../src/lib/quest-engine/questGate.mjs";
import { profileDirForJob } from "../src/lib/quest-engine/browserProfile.mjs";
import {
  DAILY_QUOTA_QUEST_IDS,
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
const FREE_HUB_PAGE = `<!doctype html><html lang="vi"><meta charset="utf-8">
<div class="nv-quest"><a class="btn-go" onclick="location.href='/phuc-loi-duong'">Làm Ngay ›</a></div>
<div class="nv-quest"><span>Thí Luyện Tông Môn</span><a class="btn-go" href="/thi-luyen-tong-mon-hh3d/?nv_embed=1">Làm Ngay ›</a></div>`;

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

// Trang thí luyện theo recording 05/08: một rương (#chestImage) + đồng hồ chung
// #countdown-timer; mở rương lúc 00:00 là đồng hồ nhảy 29:59 trong ~2s.
const FREE_TRIAL_PAGE = `<!doctype html><html lang="vi"><meta charset="utf-8">
<div id="countdown-timer">00:00</div>
<img id="chestImage" class="chest-close" alt="Rương thí luyện" style="width:60px;height:60px">
<script>const timer=document.getElementById('countdown-timer');
chestImage.onclick=()=>{if(timer.textContent!=='00:00')return;
  setTimeout(()=>{timer.textContent='29:59';timer.dataset.claimed='1'},30)}</script>`;

// Trang tế lễ theo recording 05/08: #te-le-button mở hộp SweetAlert2, xác nhận xong nút
// đổi thành "Đã Tế Lễ" + disabled (~1.5s sau confirm ngoài đời, rút ngắn trong fixture).
// Là HÀM vì site thật nhớ lễ PHÍA SERVER: lần ghé sau, trang render sẵn trạng thái đã tế —
// đó chính là điều kiện StopIf của flow, và bài "lần hai phải dừng" kiểm đúng nó.
const freeSacrificePage = (offered) => offered
  ? `<!doctype html><html lang="vi"><meta charset="utf-8">
<button id="te-le-button" class="btn btn-danger" disabled data-offered="1">Đã Tế Lễ</button>`
  : `<!doctype html><html lang="vi"><meta charset="utf-8">
<button id="te-le-button" class="btn btn-danger">Tế Lễ</button>
<div id="modal" style="display:none"><p>Đạo hữu chắc chắn dùng 10 Tinh Thạch tế lễ cho Tông Môn?</p>
<button class="swal2-confirm">Tế Lễ</button><button class="swal2-cancel">Hủy</button></div>
<script>const btn=document.getElementById('te-le-button');const modal=document.getElementById('modal');
btn.onclick=()=>{if(btn.disabled)return;modal.style.display='block'};
document.querySelector('.swal2-cancel').onclick=()=>{modal.style.display='none';btn.dataset.cancelled='1'};
document.querySelector('.swal2-confirm').onclick=()=>{modal.style.display='none';
  fetch('/te-le-offered');
  setTimeout(()=>{btn.textContent='Đã Tế Lễ';btn.disabled=true;btn.dataset.offered='1'},40)}</script>`;

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
const bossPage = (broken, { stateMs = 0, cooling = false, turnsLeft = 5 } = {}) => `<!doctype html><html lang="vi"><meta charset="utf-8">
<div id="boss-info">
  <div>Huyết Trư Địa Quỷ 61.55%</div>
  <div id="boss-slot">${bossControls(turnsLeft)}</div>
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
  if (t.id === 'battle-button') {
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
const hySuHallPage = (rooms, blessed) => {
  const rows = rooms
    .map((room) => {
      const done = blessed.has(room.id);
      const href = room.type === "hong-nhan" ? `/hong-nhan/?id=${room.id}` : `/phong-cuoi?id=${room.id}`;
      return `<div class="wedding-now-item${room.type === "hong-nhan" ? " type-hong-nhan" : ""}">
        <div class="wedding-now-info">
          <p class="wedding-now-couple"><strong>${room.couple}</strong></p>
          <p class="wedding-now-blessing-status">Trạng thái: <span class="${done ? "blessed" : "not-blessed"}">${done ? "Đã chúc" : "Chưa chúc"}</span></p>
        </div>
        <div class="wedding-now-action"><a href="${href}" class="wedding-now-btn" target="_blank">Vào Chúc Ngay</a></div>
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
// là lưới bắt kịch bản script chọn-ngẫu-nhiên không điền được gì. Bao lì xì chỉ có ở một
// phòng, để ghim cả nhánh nhặt lẫn nhánh guard-bỏ-qua.
const hySuRoomPage = (id, alreadyBlessed, withLixi) => `<!doctype html><html lang="vi"><meta charset="utf-8">
<div class="blessing-section"><h2>Gửi Lời Chúc Phúc</h2>
<div class="blessing-form">
<select id="blessing-default-options" onchange="fillBlessingMessage()">
  <option value="">🌿 Chọn lời chúc mặc định...</option>
  <option value="Thiên duyên vạn kiếp, hội ngộ giữa hồng trần!">🔮 Lời chúc 1</option>
  <option value="Duyên khởi từ tâm, đạo hợp bởi ý!">💫 Lời chúc 2</option>
  <option value="Một bước nhập đạo, vạn kiếp thành tiên!">🔥 Lời chúc 3</option>
</select>
<textarea id="blessing-message"></textarea>
${alreadyBlessed ? "" : '<button class="blessing-button" onclick="showConfirmModal()">Gửi Chúc Phúc</button>'}
</div></div>
${withLixi ? '<div class="lixi-envelope" style="width:40px;height:40px">🧧</div>' : ""}
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
const lx=document.querySelector('.lixi-envelope');
if(lx)lx.onclick=()=>{fetch('/hy-su-lixi?id=${id}');lx.remove()};
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

  console.log("\nTrần số tab chạy song song");

  // Cái trần này ra đời từ 18 dòng lỗi thật trên khôi lỗi tông môn ngày 05/08: tám trang
  // khác nhau cùng dựng trên VM 2 nhân thì các tab thua cuộc đua báo "không thấy selector".
  // Ba điều phải đúng: không bao giờ vượt trần, không bỏ sót nhiệm vụ nào, và thứ tự kết
  // quả giữ nguyên (phần tường thuật một vòng phải đọc như bản tuần tự).
  {
    const items = Array.from({ length: 9 }, (_, i) => i);
    let inFlight = 0;
    let peak = 0;
    const order = await mapWithLimit(items, 3, async (item) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      // Trễ so le để mọi làn không cùng nhịp — đúng cảnh các nhiệm vụ dài ngắn khác nhau.
      await new Promise((r) => setTimeout(r, item % 3 === 0 ? 18 : 6));
      inFlight--;
      return item * 2;
    });
    check("không bao giờ mở quá trần 3 tab", peak === 3, `đỉnh ${peak}`);
    check("chạy đủ 9 nhiệm vụ, không sót", order.length === 9 && order.every((v, i) => v === i * 2));
    check(
      "kết quả giữ đúng thứ tự đầu vào dù chạy xen kẽ",
      JSON.stringify(order) === JSON.stringify(items.map((i) => i * 2)),
      order.join(","),
    );
  }
  {
    // Trần lớn hơn số nhiệm vụ, và trần 1 (tức tuần tự) — hai đầu mút của phép kẹp.
    let peakWide = 0;
    let liveWide = 0;
    await mapWithLimit([1, 2], 8, async () => {
      liveWide++;
      peakWide = Math.max(peakWide, liveWide);
      await new Promise((r) => setTimeout(r, 5));
      liveWide--;
    });
    check("trần lớn hơn số nhiệm vụ thì chỉ mở đúng số nhiệm vụ", peakWide === 2, String(peakWide));

    let peakOne = 0;
    let liveOne = 0;
    const seq = await mapWithLimit([1, 2, 3], 1, async (n) => {
      liveOne++;
      peakOne = Math.max(peakOne, liveOne);
      await new Promise((r) => setTimeout(r, 3));
      liveOne--;
      return n;
    });
    check("trần 1 = chạy tuần tự", peakOne === 1 && JSON.stringify(seq) === "[1,2,3]", String(peakOne));
    check("danh sách rỗng không treo", (await mapWithLimit([], 3, async () => 1)).length === 0);
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
  ];
  check(
    "bốn cặp twin thường là bản sao nguyên flow VIP, chỉ đổi id/hạng/nhịp ghé lại",
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
    // 51 = chat Mê Cung (recording 08/08). Bump schema là thay hồ sơ đã lưu bên desktop
    // ngay lần mở đầu tiên — chốt này bắt mỗi cú bump phải là một quyết định có chủ ý.
    "hồ sơ đang ở schema 51",
    loadProfileForSchema().schemaVersion === 51,
    String(loadProfileForSchema().schemaVersion),
  );

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
  // phải thấy "Đã chúc". Phòng hồng-nhan cố ý đứng ĐẦU danh sách — flow phải chúc hai
  // phòng /phong-cuoi (dạng trang đã có recording) trước rồi mới tới nó.
  const hySuRooms = [
    { id: "230", type: "hong-nhan", couple: "Trái Tim Mỹ Nhân 💕 Trái Tim Bao Dung" },
    { id: "2534", type: "dao-lu", couple: "ミ★Ôɴԍтʀùмнн3ᴅ★彡 & 𝙐𝙮ê𝙣𝙉𝙝𝙞" },
    { id: "2533", type: "dao-lu", couple: "1 Trái tim 1 Ngừi iu & Trái Tim Bất Chấp" },
  ];
  const hySuBlessed = new Map(); // id → lời chúc đã gửi, theo thứ tự vào phòng
  const hySuLixi = [];
  let bossBroken = false;
  let bossStateMs = 0;
  let bossCooling = false;
  let bossTurnsLeft = 5;

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
    else if (path === "/nhiem-vu-hang-ngay") res.end(FREE_HUB_PAGE);
    else if (path === "/phuc-loi-duong") res.end(FREE_WELFARE_PAGE);
    else if (path === "/vong-quay-phuc-van") res.end(FREE_WHEEL_PAGE);
    else if (path === "/thi-luyen-tong-mon-hh3d") res.end(FREE_TRIAL_PAGE);
    else if (path === "/danh-sach-thanh-vien-tong-mon") res.end(freeSacrificePage(teLeOffered));
    else if (path === "/te-le-offered") { teLeOffered = true; res.end("ok"); }
    else if (path === "/hoang-vuc")
      res.end(bossPage(bossBroken, { stateMs: bossStateMs, cooling: bossCooling, turnsLeft: bossTurnsLeft }));
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
    else if (path === "/tien-duyen") res.end(hySuHallPage(hySuRooms, hySuBlessed));
    else if (path === "/phong-cuoi" || path === "/hong-nhan") {
      const id = url.searchParams.get("id") ?? "";
      res.end(hySuRoomPage(id, hySuBlessed.has(id), id === "2534"));
    }
    else if (path === "/hy-su-blessed") {
      hySuBlessed.set(url.searchParams.get("id") ?? "", url.searchParams.get("msg") ?? "");
      res.end("ok");
    }
    else if (path === "/hy-su-lixi") { hySuLixi.push(url.searchParams.get("id") ?? ""); res.end("ok"); }
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
    check("Tế Lễ bấm nút, xác nhận swal2, chờ nút đổi chữ", sacrificeResult.outcome === "completed", sacrificeResult.outcome);
    check(
      "Tế Lễ đi qua confirm (không đụng Hủy) và site ghi nhận lễ",
      (await page.locator("#te-le-button").getAttribute("data-offered")) === "1" &&
        (await page.locator("#te-le-button").getAttribute("data-cancelled")) == null &&
        (await page.locator("#te-le-button").textContent()) === "Đã Tế Lễ",
    );

    const sacrificeAgain = await run(sacrificeFree);
    check(
      "Tế Lễ lần hai dừng ở \"đã tế lễ hôm nay\", không bấm gì thêm",
      sacrificeAgain.outcome === "alreadyDone" || sacrificeAgain.outcome === "onCooldown",
      sacrificeAgain.outcome,
    );

    // Nhật ký người dùng nói tiếng người (ảnh 05/08): lý do dừng hiện TRẦN, còn "stopIf",
    // "repeat", "until" — ngôn ngữ của script — không được rơi vào kênh info/warning.
    check(
      "nhật ký kể lý do trần, không lộ từ ngữ của script",
      infos.some((m) => m.includes("đã tế lễ hôm nay")) &&
        !infos.some((m) => /stopIf|repeat|until/.test(m)),
      infos.filter((m) => /stopIf|repeat|until/.test(m)).join(" / ") || "(sạch)",
    );

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
    const hySu = exportedProfile.quests.find((q) => q.id === "hy-su-duong-thuong");
    const hySuFirst = await run(hySu);
    check("chúc hết các phòng rồi hoàn tất", hySuFirst.outcome === "completed", `${hySuFirst.outcome}: ${hySuFirst.message}`);
    check(
      "cả ba phòng đều được chúc, /phong-cuoi (đã có recording) đi trước /hong-nhan (chưa)",
      JSON.stringify([...hySuBlessed.keys()]) === JSON.stringify(["2534", "2533", "230"]),
      [...hySuBlessed.keys()].join(","),
    );
    check(
      "lời chúc gửi đi là một lựa chọn THẬT của select — chọn ngẫu nhiên không rơi vào ô trống",
      [...hySuBlessed.values()].every((msg) => msg.trim().length > 0),
      [...hySuBlessed.values()].join(" / "),
    );
    check(
      "bao lì xì được nhặt đúng ở phòng đang phát, phòng không phát thì guard bỏ qua êm",
      JSON.stringify(hySuLixi) === JSON.stringify(["2534"]),
      hySuLixi.join(","),
    );
    check(
      "tường thuật gọi tên từng cặp đôi được chúc",
      infos.filter((m) => m.startsWith("Vào chúc phúc:")).length === 3,
      infos.filter((m) => m.startsWith("Vào chúc phúc:")).join(" / "),
    );

    // Ghé lại khi đã chúc hết: modal vẫn mở, danh sách vẫn về, nhưng không còn .not-blessed
    // nào — dừng bằng lời người, không bấm thêm gì.
    const hySuAgain = await run(hySu);
    check(
      "lần hai dừng ở \"đã chúc phúc hết các tiệc đang mở\"",
      hySuAgain.outcome === "alreadyDone" && hySuAgain.message === "đã chúc phúc hết các tiệc đang mở",
      `${hySuAgain.outcome}: ${hySuAgain.message}`,
    );
    check("và không gửi thêm lời chúc nào", hySuBlessed.size === 3, String(hySuBlessed.size));

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

    // Phân loại phải đọc từ hồ sơ thật, không từ một danh sách tay: twin thường của Điểm
    // Danh sống trên /diem-danh nên NÓ là trang riêng dù bản VIP là hub.
    {
      const classified = loadProfileForSchema();
      const byId = (id) => classified.quests.find((q) => q.id === id);
      check(
        "phân loại theo hồ sơ: hoang-vuc & diem-danh-thuong = trang riêng; diem-danh & khoang-mach = hub",
        isDedicatedPageQuest(classified, byId("hoang-vuc")) &&
          isDedicatedPageQuest(classified, byId("diem-danh-thuong")) &&
          !isDedicatedPageQuest(classified, byId("diem-danh")) &&
          !isDedicatedPageQuest(classified, byId("khoang-mach")),
        ["hoang-vuc", "diem-danh-thuong", "diem-danh", "khoang-mach"]
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
      config: { ...progressConfig, parallelQuests: true },
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
      config: { ...progressConfig, parallelQuests: false },
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
          config: { ...progressConfig, parallelQuests: true },
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
        config: { ...progressConfig, parallelQuests: true },
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
        config: { ...progressConfig, parallelQuests: true, gameBaseUrl: baseUrl },
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
      const missing = profileNow.quests
        .filter((quest) => dailyNames.includes(quest.name) && !DAILY_QUOTA_QUEST_IDS.has(quest.id))
        .map((quest) => quest.id);
      check(
        "cả chín nhiệm vụ ngày đều có trong sổ, kể cả twin VIP/thường",
        missing.length === 0,
        missing.join(", ") || "(đủ)",
      );

      // Và KHÔNG được lan sang những nhiệm vụ mà `alreadyDone` chỉ là một trạng thái thoáng
      // qua: nhớ nhầm Mê Cung là tắt mất nhiệm vụ đáng giá nhất của cả ngày, trong im lặng.
      const intruders = profileNow.quests
        .filter((quest) =>
          ["Mê Cung", "Luyện Đan Đường", "Khoáng Mạch", "Hỷ Sự Đường"].includes(quest.name),
        )
        .filter((quest) => DAILY_QUOTA_QUEST_IDS.has(quest.id))
        .map((quest) => quest.id);
      check(
        "Mê Cung · Luyện Đan · Khoáng Mạch · Hỷ Sự Đường đứng ngoài sổ",
        intruders.length === 0,
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
