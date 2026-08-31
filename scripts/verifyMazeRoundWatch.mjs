#!/usr/bin/env node
/**
 * Kiểm chứng NHỊP DÒ của vòng lái lượt đánh Mê Cung — thứ đứng ra chấm dứt mười một phút câm.
 *
 * ── Chuyện đã xảy ra ─────────────────────────────────────────────────────────────────────────
 *
 * Nhật ký thật ngày 31/08/2026 (đàn `mesa-monolith`, bảng `job_events`):
 *
 *     10:55:35  Đủ đội — BẮT ĐẦU!            10:57:04  Xong lượt đánh — 350/430 (+67)
 *     10:58:06  Đủ đội — BẮT ĐẦU!            11:00:14  Xong lượt đánh — 401/430 (+51)
 *     11:11:55  Đủ đội — BẮT ĐẦU!            11:23:15  …chưa lĩnh được rương, 401/430
 *
 * Hai lượt đầu 1m29s và 2m08s. Lượt thứ ba 680 GIÂY, không một dòng chữ nào ở giữa, và không
 * được cộng một huyền tinh nào. 680 chia cho 60 nhịp ra 11,3 giây — đúng bằng giá một vòng thân
 * (6s timeout của cú bấm hụt + 4s chờ), tức vòng lặp cạn TRẦN SỐ VÒNG chứ chưa bao giờ thấy
 * `until`. Lối ra duy nhất của nó là `#btn-start` hiện lại, mà nút ấy nằm trong `#room-panel`:
 * phòng bị xoá giữa trận thì nó không bao giờ hiện lại nữa. Tông chủ nhìn nhật ký và nói đúng
 * một câu: "flow đã stuck, trong game thật thì đã thoát ra khỏi phòng".
 *
 * ── Vì sao phép thử này đọc được bằng chứng chứ không phải trí tưởng tượng ────────────────────
 *
 * Bảng TRACE bên dưới KHÔNG phải fixture nghĩ ra. Nó chép từ 30 ảnh DOM của bản ghi
 * `me-cung-20260829-100237` (`dom/01-load.html` … `dom/30-probe-change.html`) — một lượt đánh
 * thật từ sảnh tới hết ải 5. Chép chứ không đọc thẳng, vì bản ghi nằm ở %APPDATA% chứ không
 * trong repo; giữ nguyên văn từng chuỗi class để người sau đối chiếu lại được.
 *
 * Chính bản ghi ấy quyết định hình dạng bản vá. Trang /me-cung là TRANG ĐƠN: `#screen-lobby` và
 * `#screen-battle` nằm sẵn cả ngày và chỉ đổi nhau class `active` (ảnh 23–29 là lúc màn trận
 * cầm `active`); còn "đang ở trong phòng" hiện ra ở chỗ `#room-panel` có mang `hidden` hay
 * không (ảnh 01–07 có, 08–30 không). Nên nhịp dò đọc CLASS, không đo hình học: luật CSS của
 * `.screen` nằm trong stylesheet ngoài mà bản ghi không lưu, trong khi
 * `.hidden{display:none!important}` thì nằm ngay trong thẻ style nội tuyến của trang.
 *
 * Chạy: node scripts/verifyMazeRoundWatch.mjs   (hoặc `npm run verify:maze-watch`)
 */
import { profileForConfig } from "../src/lib/quest-engine/profile.mjs";

let passed = 0;
const check = (name, condition, detail = "") => {
  if (!condition) throw new Error(`${name}${detail ? ` — ${detail}` : ""}`);
  console.log(`✔ ${name}`);
  passed++;
};

const OVER = "jvz-mc-round-over";
const NOROOM = "jvz-mc-noroom";

const config = {
  quests: { meCung: { enabled: true, mode: "is-normal", kickHp: 0, kickIdleSec: 0, capCheck: true } },
};
const twins = profileForConfig(config).quests.filter((q) => q.name === "Mê Cung");

// -------------------------------------------------------------------------------------------
// 1. Hình dạng flow — cờ phải được cắm ở chỗ có người đọc nó
// -------------------------------------------------------------------------------------------

check("hồ sơ có đúng hai twin Mê Cung", twins.length === 2, `thấy ${twins.length}`);

const driverOf = (quest) => {
  const outer = quest.steps.find((s) => s.action === "repeat" && s.maxIterations === 18);
  return { outer, driver: outer?.steps.find((s) => s.action === "repeat" && s.maxIterations === 60) };
};

for (const quest of twins) {
  const who = quest.id;
  const { outer, driver } = driverOf(quest);
  check(`${who}: còn vòng ngoài (18 hiệp) và vòng lái (60 nhịp)`, Boolean(outer && driver));

  // Lối ra CŨ phải còn nguyên: cái kết đẹp — đánh xong, cả đội vẫn trong phòng — là ngả hay gặp
  // nhất, và bản ghi 29/08 ảnh 30 chụp đúng nó. Bản vá thêm lối, không thay lối.
  check(
    `${who}: vòng lái giữ lối ra cũ VÀ có lối ra mới`,
    driver.until?.kind === "visible" &&
      driver.until.selector.includes("#btn-start") &&
      driver.until.selector.includes(`body.${OVER}`),
    JSON.stringify(driver.until),
  );

  // `until` được giải TRƯỚC thân vòng (xem handler `repeat` bên engine), nên cờ phải được cắm ở
  // bước CUỐI: đặt nó ở đầu thì mỗi kết luận đều trễ mất trọn một nhịp.
  const watch = driver.steps.at(-1);
  check(
    `${who}: bước dò là bước CUỐI thân vòng lái`,
    watch?.action === "evaluateJavaScript" && typeof watch.script === "string" && watch.script.includes(OVER),
    JSON.stringify(watch?.action),
  );
  check(`${who}: bước dò là optional — một nhịp hỏng không được giết cả lượt`, watch.optional === true);

  check(
    `${who}: vòng ngoài về sớm khi phòng không còn`,
    outer.until?.selector.includes(`body.${NOROOM}`),
    outer.until?.selector,
  );
}

check(
  "hai twin dùng CHUNG một script dò — sửa một chỗ mà quên chỗ kia là lỗi im lặng",
  driverOf(twins[0]).driver.steps.at(-1).script === driverOf(twins[1]).driver.steps.at(-1).script,
);

const WATCH = driverOf(twins[0]).driver.steps.at(-1).script;

// -------------------------------------------------------------------------------------------
// 2. DOM giả — đúng bốn phép mà script dùng tới, không hơn
// -------------------------------------------------------------------------------------------

const node = (cls, text = "") => {
  const set = new Set(String(cls ?? "").split(/\s+/).filter(Boolean));
  return {
    textContent: text,
    classList: { contains: (c) => set.has(c), add: (c) => set.add(c), remove: (c) => set.delete(c) },
    _has: (c) => set.has(c),
  };
};

/** `null` cho một selector = phần tử KHÔNG có trên trang, một ca thật lúc trang dựng dở. */
const page = ({ lobby, battle, room, fail, stage = "", boss = "", why = "" }, body) => {
  const map = {
    "#screen-lobby": lobby === null ? null : node(lobby),
    "#screen-battle": battle === null ? null : node(battle),
    "#room-panel": room === null ? null : node(room),
    "#modal-fail": fail === null ? null : node(fail),
    "#current-stage-num": node("", stage),
    "#boss-name-text": node("", boss),
    "#modal-fail-message": node("", why),
  };
  return { body, querySelector: (sel) => (sel in map ? map[sel] : null) };
};

/** Một lượt chạy: `window` sống xuyên các nhịp, đúng như trong một trang không nạp lại. */
const runner = ({ withBody = true } = {}) => {
  const body = withBody ? node("") : null;
  const win = {};
  const fn = new Function("window", "document", `return (${WATCH});`);
  return {
    body,
    win,
    tick: (view) => fn(win, page(view, body))(),
    flag: (cls) => Boolean(body && body._has(cls)),
  };
};

// -------------------------------------------------------------------------------------------
// 3. Bản ghi thật, chạy lại từng nhịp một
// -------------------------------------------------------------------------------------------
//
// Chép nguyên văn class từ `me-cung-20260829-100237/dom/*.html`. Cột `stage` và `boss` là nội
// dung thật của #current-stage-num / #boss-name-text ở đúng ảnh ấy.

const LOBBY_ON = "screen active";
const LOBBY_OFF = "screen";
const ROOM_IN = "room-panel";
const ROOM_OUT = "room-panel hidden";
const MODAL_OFF = "modal-overlay hidden";
const MODAL_ON = "modal-overlay";

/** Ảnh 23–30: trọn một lượt đánh, từ lúc màn trận bật lên tới lúc về phòng. */
const REAL_ROUND = [
  { at: "23-click", lobby: LOBBY_OFF, battle: "screen active", room: ROOM_IN, fail: MODAL_OFF, stage: "1", boss: "Diễm Sát Ngưu Nhân" },
  { at: "24-probe", lobby: LOBBY_OFF, battle: "screen active", room: ROOM_IN, fail: MODAL_OFF, stage: "1", boss: "Diễm Sát Ngưu Nhân" },
  { at: "25-probe", lobby: LOBBY_OFF, battle: "screen active", room: ROOM_IN, fail: MODAL_OFF, stage: "2", boss: "Băng Nguyên Cự Nhân" },
  { at: "26-probe", lobby: LOBBY_OFF, battle: "screen active", room: ROOM_IN, fail: MODAL_OFF, stage: "3", boss: "Huyết Sát Ma Nhân" },
  { at: "27-probe", lobby: LOBBY_OFF, battle: "screen active", room: ROOM_IN, fail: MODAL_OFF, stage: "4", boss: "Mộc Linh Ma Thụ" },
  { at: "28-probe", lobby: LOBBY_OFF, battle: "screen active", room: ROOM_IN, fail: MODAL_OFF, stage: "5", boss: "Băng Vương Alaska" },
  { at: "29-probe", lobby: LOBBY_OFF, battle: "screen active", room: ROOM_IN, fail: MODAL_OFF, stage: "5", boss: "Băng Vương Alaska" },
  // Ảnh 30: về phòng. #current-stage-num còn đọng số 5 của trận vừa rồi — lý do nhịp dò chỉ
  // đọc con số ấy khi màn trận đang cầm `active`.
  { at: "30-probe", lobby: LOBBY_ON, battle: LOBBY_OFF, room: ROOM_IN, fail: MODAL_OFF, stage: "5", boss: "Băng Vương Alaska" },
];

const real = runner();
const said = REAL_ROUND.map((v) => real.tick(v));

check(
  "bản ghi thật: mỗi ải một dòng, ải lặp lại thì im",
  JSON.stringify(said) ===
    JSON.stringify([
      "!Đang đánh ải 1/5 — «Diễm Sát Ngưu Nhân»",
      "",
      "!Đang đánh ải 2/5 — «Băng Nguyên Cự Nhân»",
      "!Đang đánh ải 3/5 — «Huyết Sát Ma Nhân»",
      "!Đang đánh ải 4/5 — «Mộc Linh Ma Thụ»",
      "!Đang đánh ải 5/5 — «Băng Vương Alaska»",
      "",
      "",
    ]),
  JSON.stringify(said),
);

// Ngả HAY GẶP NHẤT phải đi qua mà không ai hay biết: cờ cắm ở đây là cắt ngang một trận đang
// đánh, và lối ra `#btn-start` vốn đã lo trọn cái kết đẹp.
check(
  "bản ghi thật: một lượt trọn vẹn KHÔNG cắm cờ nào",
  !real.flag(OVER) && !real.flag(NOROOM),
);

// -------------------------------------------------------------------------------------------
// 4. Cái kết mà bản cũ không biết: phòng biến mất
// -------------------------------------------------------------------------------------------

const gone = runner();
gone.tick(REAL_ROUND[0]);
gone.tick(REAL_ROUND[2]);
// Ảnh 01–07 của chính bản ghi ấy là cảnh "ở sảnh, chưa/không còn ở phòng nào".
const OUT = { lobby: LOBBY_ON, battle: LOBBY_OFF, room: ROOM_OUT, fail: MODAL_OFF, stage: "3" };
const first = gone.tick(OUT);
check("mất phòng: nhịp ĐẦU chưa kết luận gì", first === "" && !gone.flag(OVER) && !gone.flag(NOROOM), first);
const second = gone.tick(OUT);
check(
  "mất phòng: nhịp thứ HAI mới nói, và nói đúng chuyện",
  second === "!Đã ra khỏi phòng — sảnh Mê Cung hiện ra mà phòng thì không còn; lượt đánh dừng ở đây",
  second,
);
check("mất phòng: cắm cả cờ tan hiệp lẫn cờ hết phòng", gone.flag(OVER) && gone.flag(NOROOM));
check("mất phòng: nói đúng MỘT lần, nhịp sau im", gone.tick(OUT) === "");

// -------------------------------------------------------------------------------------------
// 5. Ngả sai đắt nhất: thoát oan giữa trận
// -------------------------------------------------------------------------------------------
//
// Ngay sau cú bấm BẮT ĐẦU, trang còn đang ở sảnh với phòng nguyên vẹn — vòng lái vừa vào nhịp
// đầu. Kết luận "hết trận" ở đây là cắt ngang một trận thật, rồi hiệp sau đi chờ #lobby-ready
// trong một trang đang đánh nhau và đốt trọn 5 phút. Nên trạng thái ấy phải câm như thóc.

const settling = runner();
const IN_ROOM = { lobby: LOBBY_ON, battle: LOBBY_OFF, room: ROOM_IN, fail: MODAL_OFF, stage: "1" };
const quietTicks = Array.from({ length: 5 }, () => settling.tick(IN_ROOM));
check(
  "còn trong phòng: không cờ, không lời — nhường lối ra #btn-start",
  quietTicks.every((s) => s === "") && !settling.flag(OVER) && !settling.flag(NOROOM),
  JSON.stringify(quietTicks),
);

// Trang đang chuyển màn (chưa màn nào cầm `active`) KHÔNG được tính là một nhịp "mất phòng" —
// nếu tính, hai nhịp chuyển màn liền nhau là đủ để thoát oan.
const blur = runner();
const LIMBO = { lobby: LOBBY_OFF, battle: LOBBY_OFF, room: ROOM_OUT, fail: MODAL_OFF, stage: "" };
blur.tick(LIMBO);
blur.tick(LIMBO);
check("trang đang chuyển màn: không kết luận gì", !blur.flag(OVER) && !blur.flag(NOROOM));
check("…và không tính vào bộ đếm hai nhịp", blur.tick(OUT) === "" && !blur.flag(OVER));

// -------------------------------------------------------------------------------------------
// 6. Hộp THẤT BẠI — trang tự nói ra lý do, cứ chép lại nguyên văn
// -------------------------------------------------------------------------------------------

const WHY = "Phòng hết thời gian tồn tại và đã bị xóa";

const lost = runner();
// Phòng còn đó (đội thua ải): tan hiệp thì có, mất phòng thì không.
const FAIL_IN_ROOM = { lobby: LOBBY_OFF, battle: "screen active", room: ROOM_IN, fail: MODAL_ON, stage: "3", why: "Cả đội đã gục" };
lost.tick(FAIL_IN_ROOM);
const lostSaid = lost.tick(FAIL_IN_ROOM);
check(
  "thua ải mà phòng còn: kể lý do trang đưa, KHÔNG cắm cờ hết phòng",
  lostSaid === "!Lượt đánh dừng — trang báo THẤT BẠI:「Cả đội đã gục」" && lost.flag(OVER) && !lost.flag(NOROOM),
  lostSaid,
);

const wiped = runner();
const FAIL_NO_ROOM = { lobby: LOBBY_ON, battle: LOBBY_OFF, room: ROOM_OUT, fail: MODAL_ON, stage: "3", why: WHY };
wiped.tick(FAIL_NO_ROOM);
const wipedSaid = wiped.tick(FAIL_NO_ROOM);
check(
  "phòng hết hạn: chép lại nguyên văn lời trang, và cắm cả hai cờ",
  wipedSaid === `!Lượt đánh dừng — trang báo THẤT BẠI:「${WHY}」; phòng cũng không còn` &&
    wiped.flag(OVER) &&
    wiped.flag(NOROOM),
  wipedSaid,
);

// -------------------------------------------------------------------------------------------
// 7. Lời hứa: không bao giờ im nữa
// -------------------------------------------------------------------------------------------
//
// Mọi ngả không nói gì đều đi qua `hush`. Cứ 30 nhịp lặng (~5 phút) là một nhịp thở — kể cả khi
// trang rơi vào một trạng thái chưa ai lường trước. Đó mới là thứ mà mười một phút câm đòi hỏi.

const stuck = runner();
stuck.tick(REAL_ROUND[0]);
const beats = [];
for (let i = 0; i < 60; i += 1) {
  const line = stuck.tick({ ...REAL_ROUND[0], stage: "1" });
  if (line) beats.push({ tick: i + 1, line });
}
check(
  "trận đứng hình: cứ 30 nhịp một nhịp thở, không hơn",
  beats.length === 2 && beats[0].tick === 30 && beats[1].tick === 60,
  JSON.stringify(beats),
);
check(
  "nhịp thở nói rõ đang đứng ở đâu",
  beats[0].line === "!Lượt đánh vẫn chưa xong — còn trong trận (ải 1/5); đã dò 30 nhịp",
  beats[0].line,
);

const idleRoom = runner();
let roomBeat = "";
for (let i = 0; i < 30; i += 1) roomBeat = idleRoom.tick(IN_ROOM) || roomBeat;
check(
  "kẹt trong phòng mà nút BẮT ĐẦU không về: cũng phải kêu",
  roomBeat === "!Lượt đánh vẫn chưa xong — đã về phòng; đã dò 30 nhịp",
  roomBeat,
);

// -------------------------------------------------------------------------------------------
// 8. Những ca trang không tử tế
// -------------------------------------------------------------------------------------------

const noBody = runner({ withBody: false });
noBody.tick(OUT);
check("trang chưa có <body>: chạy trót lọt, không ném", noBody.tick(OUT).length > 0);

const noStage = runner();
check(
  "màn trận chưa vẽ số ải: im, không đoán bừa",
  noStage.tick({ lobby: LOBBY_OFF, battle: "screen active", room: ROOM_IN, fail: MODAL_OFF, stage: "" }) === "",
);
check(
  "số ải là chữ chứ không phải số: cũng im",
  noStage.tick({ lobby: LOBBY_OFF, battle: "screen active", room: ROOM_IN, fail: MODAL_OFF, stage: "—" }) === "",
);

const noNodes = runner();
noNodes.tick({ lobby: null, battle: null, room: null, fail: null });
check("trang trống trơn: không ném, không kết luận", !noNodes.flag(OVER) && !noNodes.flag(NOROOM));

const noBoss = runner();
check(
  "boss chưa có tên (chỗ giữ chỗ '---'): bỏ tên, giữ số ải",
  noBoss.tick({ lobby: LOBBY_OFF, battle: "screen active", room: ROOM_IN, fail: MODAL_OFF, stage: "1", boss: "---" }) ===
    "!Đang đánh ải 1/5",
);

// -------------------------------------------------------------------------------------------
// 9. Dòng tổng kết thôi khẳng định một điều nó không biết
// -------------------------------------------------------------------------------------------
//
// Lượt 11:23:15 hôm 31/08 in ra "Về phòng sau lượt đánh" trong khi phòng đã bị xoá từ lâu. Nhánh
// ấy chạy khi không lĩnh được rương và phải đọc tạm con số trên trang — nó không có quyền nói
// mình đang ở đâu, nên bây giờ nó đi hỏi #room-panel.

const chest = twins[0].steps
  .find((s) => s.action === "repeat" && s.maxIterations === 18)
  .steps.find((s) => s.action === "evaluateJavaScript" && String(s.script).includes("Về phòng sau lượt đánh"));
check("vẫn tìm được bước tổng kết cuối hiệp", Boolean(chest));

const capValue = twins[0].options.find((o) => o.key === "capCheck").selectedValue;
const runChest = (roomCls) => {
  const filled = String(chest.script).split("{{capCheck}}").join(capValue);
  const body = node("");
  const daily = node("", "Hôm nay đã nhận 401/430");
  const doc = {
    body,
    querySelectorAll: (sel) => (sel === ".mc-ht-daily-text" ? [daily] : []),
    querySelector: (sel) => (sel === "#room-panel" ? (roomCls === null ? null : node(roomCls)) : null),
  };
  // `fought` bật, và rương thì không lĩnh được — đúng hiện trường 11:23:15.
  const win = { __jvz: { battle: true, told: [], roster: null } };
  const store = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  return new Function("window", "document", "sessionStorage", `return (${filled});`)(win, doc, store)();
};

check(
  "về được phòng thì vẫn nói y như cũ",
  runChest(ROOM_IN) === "!Về phòng sau lượt đánh — chưa lĩnh được rương, đọc tạm trên trang: 401/430",
  runChest(ROOM_IN),
);
check(
  "phòng không còn thì thôi nói dối",
  runChest(ROOM_OUT) === "!Hết lượt đánh mà KHÔNG về được phòng — chưa lĩnh được rương, đọc tạm trên trang: 401/430",
  runChest(ROOM_OUT),
);
check(
  "trang không có khối phòng: coi như không về được, đừng đoán tốt cho mình",
  runChest(null).startsWith("!Hết lượt đánh mà KHÔNG về được phòng"),
  runChest(null),
);

// -------------------------------------------------------------------------------------------
// 10. Lá cờ của hiệp trước không được phép giết hiệp sau
// -------------------------------------------------------------------------------------------
//
// Nhịp dò gỡ cờ `jvz-mc-round-over` ở ĐẦU mỗi nhịp rồi cắm lại — nhưng nhịp cuối thì cắm xong là
// thoát, nên lá cờ ở lại trên <body>. Mà `until` được giải TRƯỚC thân vòng: hiệp sau đọc phải lá
// cờ của hiệp trước và thoát ngay khi chưa đánh nhịp nào — không đánh, không kể, không gì cả.
// Chỗ dọn đúng là bước ĐẦU TIÊN của thân vòng ngoài, tức bước gắn tai nghe rương.

const outerBody = twins[0].steps.find((s) => s.action === "repeat" && s.maxIterations === 18).steps;
const hook = outerBody[0];
check(
  "bước đầu mỗi hiệp là bước gắn tai nghe, và nó dọn cờ tan hiệp",
  hook.action === "evaluateJavaScript" && String(hook.script).includes(`classList.remove('${OVER}')`),
  hook.action,
);

const dirty = node(OVER);
check("…cờ cũ đang bám trên <body> trước khi hiệp mới bắt đầu", dirty._has(OVER));
const hookWin = { __jvz: { battle: true, watch: "left", quiet: 9, out: 2 } };
new Function(
  "window",
  "document",
  "sessionStorage",
  `return (${hook.script});`,
)(hookWin, { body: dirty, querySelector: () => null }, { getItem: () => null, setItem: () => {}, removeItem: () => {} })();
check("hiệp mới dọn sạch cờ tan hiệp", !dirty._has(OVER));
check(
  "…và dọn cả sổ dò, để nhịp thở đếm theo từng hiệp",
  hookWin.__jvz.watch === "" && hookWin.__jvz.quiet === 0 && hookWin.__jvz.out === 0,
  JSON.stringify(hookWin.__jvz),
);

// Cờ MẤT PHÒNG thì ngược lại: nó phải sống sót, vì vòng ngoài đọc nó sau bước tổng kết để kết
// thúc lượt ghé. Dọn nhầm nó là quay về đúng cảnh đứng gọi người vào một căn phòng đã mất.
const sticky = node(`${OVER} ${NOROOM}`);
new Function(
  "window",
  "document",
  "sessionStorage",
  `return (${hook.script});`,
)({ __jvz: {} }, { body: sticky, querySelector: () => null }, { getItem: () => null, setItem: () => {}, removeItem: () => {} })();
check("cờ MẤT PHÒNG thì không ai được dọn", sticky._has(NOROOM) && !sticky._has(OVER));

console.log(`\n${passed} phép thử qua.`);
