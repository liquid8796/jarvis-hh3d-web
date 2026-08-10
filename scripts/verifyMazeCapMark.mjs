#!/usr/bin/env node
/**
 * Kiểm chứng lượt DỪNG của Mê Cung: "đã đủ huyền tinh hôm nay thì thôi, đừng mở phòng nữa".
 *
 * Vì sao chuyện này đáng có một phép thử riêng — vì lỗi cũ KHÔNG kêu một tiếng nào. Điều kiện
 * dừng vốn so chuỗi cứng "385/385", con số của riêng tài khoản dùng để ghi hình; mà trần huyền
 * tinh thì MỖI TÀI KHOẢN MỘT KHÁC (nhật ký thật 10/08/2026: 200 và 360). Chuỗi không bao giờ
 * khớp, nên `stopIf` không bắn và `until` không thoả: Mê Cung mở phòng rồi đánh đủ 6 vòng / 35
 * phút mỗi lượt, suốt cả ngày, sau khi đã đầy trần từ sáng — trong khi nhật ký vẫn ghi
 * "Mê Cung: xong" và "Đi hết một vòng — 10 nhiệm vụ thuận lợi". Hai đàn đo được hôm ấy đã đánh
 * lần lượt 15 và 16 trận trắng, không một huyền tinh nào.
 *
 * Bản vá thay phép so chuỗi bằng một bước JS đọc trần ngay trên trang rồi CẮM CỜ; `stopIf` và
 * `until` chỉ còn hỏi một câu `visible`. Phép thử này giữ ba thứ:
 *
 *   1. hình dạng flow — cờ được cắm ĐÚNG CHỖ (trước lượt hỏi, và cuối mỗi vòng đánh),
 *   2. chính cái script ấy chạy đúng trên đủ loại chữ mà trang có thể hiện ra,
 *   3. lớp dịch ngọc giản vẫn đặt được công tắc bật/tắt vào hồ sơ.
 *
 * ĐÃ ĐO TRÊN CHROMIUM THẬT (10/08/2026), vì `visible` của engine đòi phần tử rộng và cao ít
 * nhất 1px — một đòi hỏi không suy luận được, phải hỏi trình duyệt:
 *
 *   • ô chữ hiện bình thường  → dừng được
 *   • ô chữ `display:none`, trang có nội dung khác (đúng trang game) → dừng được, nhờ cờ <body>
 *   • ô chữ trong panel `height:0;overflow:hidden` → dừng được
 *   • trang RỖNG hoàn toàn, chỉ có mỗi ô chữ bị ẩn → KHÔNG dừng, vì <body> cũng cao 0px
 *
 * Ca cuối là trang thử tự dựng, không phải trang game: sảnh Mê Cung luôn mang `#lobby-overview`
 * còn phòng luôn mang `#btn-start`, nên <body> không bao giờ cao 0. Chép lại đây để người sau
 * đọc con số 0px ấy mà không tưởng là bản vá hỏng.
 *
 * Chạy: node scripts/verifyMazeCapMark.mjs  (hoặc `npm run verify:maze-cap`)
 */
import { profileForConfig } from "../src/lib/quest-engine/profile.mjs";

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

let passed = 0;
const check = (name, condition, detail = "") => {
  assert(condition, `${name}${detail ? ` — ${detail}` : ""}`);
  console.log(`✔ ${name}`);
  passed++;
};

/** Cờ được hỏi ở HAI nơi: xem chú thích trong chính bước JS của hồ sơ. */
const MARK_SELECTOR = "body.jvz-cap-full, .mc-ht-daily-text.jvz-cap-full";
const MARK_CLASS = "jvz-cap-full";

const configFor = (capCheck) => ({
  quests: { meCung: { enabled: true, mode: "is-normal", kickHp: 0, kickIdleSec: 0, capCheck } },
});

const mazeTwins = (capCheck) =>
  profileForConfig(configFor(capCheck)).quests.filter((q) => q.name === "Mê Cung");

const isMarkStep = (step) =>
  step?.action === "evaluateJavaScript" && typeof step.script === "string" && step.script.includes(MARK_CLASS);

// -------------------------------------------------------------------------------------------
// 1. Hình dạng flow
// -------------------------------------------------------------------------------------------

const twins = mazeTwins(true);
check("hồ sơ có đúng hai twin Mê Cung", twins.length === 2, `thấy ${twins.length}`);

/**
 * Mọi chữ mà nhiệm vụ đem SO với trang, cùng mọi giá trị option — tức đúng những chỗ một con
 * số trần ngày có thể lẻn vào lần nữa. Chú thích thì không tính: bản vá cố ý kể lại "385/385"
 * ở đó để người sau hiểu vì sao flow trông như bây giờ.
 */
const comparedTexts = (quest) => {
  const out = [];
  const walk = (node) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) return node.forEach(walk);
    for (const [key, value] of Object.entries(node)) {
      if (typeof value === "string" && (key === "text" || key === "value" || key === "selectedValue")) out.push(value);
      else walk(value);
    }
  };
  walk(quest.steps);
  walk(quest.options);
  return out;
};

for (const quest of twins) {
  const who = quest.id ?? quest.name;
  const steps = quest.steps;

  // Bất biến thật sự: KHÔNG một phép so nào được mang sẵn một con số trần trong mình.
  const hardcoded = comparedTexts(quest).filter((t) => /\d+\s*\/\s*\d+/.test(t));
  check(
    `${who}: không phép so nào mang sẵn con số trần`,
    hardcoded.length === 0,
    hardcoded.join(" | "),
  );

  const stopIndex = steps.findIndex((s) => s.action === "stopIf");
  check(`${who}: vẫn còn bước stopIf`, stopIndex > 0);
  check(
    `${who}: stopIf hỏi cờ, không so chuỗi`,
    steps[stopIndex].condition?.kind === "visible" && steps[stopIndex].condition?.selector === MARK_SELECTOR,
    JSON.stringify(steps[stopIndex].condition),
  );

  // Thứ tự là TẤT CẢ ở đây: cờ phải được cắm TRƯỚC khi có ai hỏi tới nó.
  check(`${who}: ngay trước stopIf là bước đọc trần`, isMarkStep(steps[stopIndex - 1]));

  const loop = steps.find((s) => s.action === "repeat" && s.maxIterations === 6);
  check(`${who}: còn vòng ngoài 6 lượt`, Boolean(loop));
  check(
    `${who}: until hỏi cờ, không so chuỗi`,
    loop.until?.kind === "visible" && loop.until?.selector === MARK_SELECTOR,
    JSON.stringify(loop.until),
  );

  // `until` được kiểm ở ĐẦU mỗi vòng, nên bước đọc trần phải là bước CUỐI của thân vòng —
  // đặt ở đầu thì cờ luôn trễ đúng một lượt đánh, tức vẫn đánh thừa một trận sau khi đầy.
  check(`${who}: bước đọc trần là bước cuối thân vòng`, isMarkStep(loop.steps.at(-1)));

  // Hai bản sao của cùng một script: sửa một chỗ mà quên chỗ kia là lỗi im lặng y hệt lỗi cũ.
  check(
    `${who}: hai bước đọc trần dùng chung một script`,
    steps[stopIndex - 1].script === loop.steps.at(-1).script,
  );

  const capOption = quest.options.find((o) => o.key === "capCheck");
  check(
    `${who}: selectedValue nằm trong choices`,
    capOption.choices.some((c) => c.value === capOption.selectedValue),
    // buildOptionValues của engine rơi về lựa chọn ĐẦU TIÊN khi selectedValue lạ — im lặng.
    `'${capOption.selectedValue}' không có trong choices`,
  );
}

// -------------------------------------------------------------------------------------------
// 2. Lớp dịch ngọc giản → hồ sơ
// -------------------------------------------------------------------------------------------

const valueOf = (quest) => quest.options.find((o) => o.key === "capCheck").selectedValue;
const SENTINEL = "«";

for (const quest of mazeTwins(true)) {
  check(`${quest.id}: bật kiểm tra → giá trị thật`, !valueOf(quest).includes(SENTINEL), valueOf(quest));
}
for (const quest of mazeTwins(false)) {
  check(`${quest.id}: tắt kiểm tra → sentinel`, valueOf(quest).includes(SENTINEL), valueOf(quest));
}

// -------------------------------------------------------------------------------------------
// 3. Chính cái script ấy, trên đủ loại chữ trang có thể hiện ra
// -------------------------------------------------------------------------------------------

/** classList tối thiểu — đúng ba phép mà script dùng tới. */
const classList = (initial = []) => {
  const set = new Set(initial);
  return { add: (c) => set.add(c), remove: (c) => set.delete(c), has: (c) => set.has(c) };
};

/**
 * DOM giả vừa đủ. `withBody: false` là ca thật chứ không phải ca tưởng tượng: bước này chạy
 * cả lúc trang đang dựng dở, và một cú `document.body.classList` trên `null` sẽ ném ra giữa
 * lượt — mà bước lại `optional`, nên lỗi ấy chỉ còn là một dòng debug rồi trôi qua.
 */
const fakeDom = ({ texts = [], withBody = true, bodyClasses = [] } = {}) => {
  const els = texts.map((textContent) => ({ textContent, classList: classList() }));
  const body = withBody ? { classList: classList(bodyClasses) } : null;
  return {
    els,
    body,
    document: {
      body,
      querySelectorAll: (selector) => (selector === ".mc-ht-daily-text" ? els : []),
    },
  };
};

const MARK_SCRIPT = twins[0].steps.find(isMarkStep).script;

/** Thay `{{capCheck}}` đúng phép mà engine dùng (fillString: split/join), rồi chạy thật. */
const runMark = (capValue, dom) => {
  const filled = MARK_SCRIPT.split("{{capCheck}}").join(capValue);
  const fn = new Function("document", `return (${filled});`)(dom.document);
  return fn();
};

const ON = valueOf(mazeTwins(true)[0]);
const OFF = valueOf(mazeTwins(false)[0]);

const cases = [
  { name: "đầy trần 200/200 → cắm cờ", texts: ["Hôm nay đã nhận 200/200"], value: ON, marked: true },
  { name: "chưa đầy 199/200 → không cắm", texts: ["Hôm nay đã nhận 199/200"], value: ON, marked: false },
  { name: "trần 360 của tài khoản khác cũng chạy", texts: ["Hôm nay đã nhận 360/360"], value: ON, marked: true },
  // Hai ca dấu phân cách hàng nghìn: đọc ngây thơ thì "1.200/1.200" ra 200/1 và LÚC NÀO CŨNG
  // tưởng đã đầy — tức nghỉ đánh oan cả ngày. Đây là mặt trái đúng bằng lỗi vừa vá.
  { name: "1.200/1.200 kiểu vi-VN → cắm cờ", texts: ["Hôm nay đã nhận 1.200/1.200"], value: ON, marked: true },
  { name: "1.199/1.200 → KHÔNG cắm", texts: ["Hôm nay đã nhận 1.199/1.200"], value: ON, marked: false },
  { name: "vượt trần 210/200 vẫn là đầy", texts: ["Hôm nay đã nhận 210/200"], value: ON, marked: true },
  { name: "0/0 không tin được", texts: ["Hôm nay đã nhận 0/0"], value: ON, marked: false },
  { name: "chưa vẽ ô nào → không đoán bừa", texts: [], value: ON, marked: false },
  { name: "ô không có dạng x/y → không đoán bừa", texts: ["Đang tải…"], value: ON, marked: false },
  { name: "tắt kiểm tra thì đầy trần cũng không cắm", texts: ["Hôm nay đã nhận 200/200"], value: OFF, marked: false },
];

for (const c of cases) {
  const dom = fakeDom({ texts: c.texts });
  const said = runMark(c.value, dom);
  const onBody = dom.body.classList.has(MARK_CLASS);
  const onText = dom.els.length > 0 && dom.els[0].classList.has(MARK_CLASS);
  check(c.name, onBody === c.marked && onText === (c.marked && dom.els.length > 0), `script nói: ${said}`);
}

// Cờ CŨ phải bị dọn, nếu không một lượt đầy trần hôm qua còn dính lại là nghỉ đánh oan hôm nay.
const stale = fakeDom({ texts: ["Hôm nay đã nhận 100/200"], bodyClasses: [MARK_CLASS] });
stale.els[0].classList.add(MARK_CLASS);
runMark(ON, stale);
check("cờ cũ bị dọn khi trần chưa đầy", !stale.body.classList.has(MARK_CLASS) && !stale.els[0].classList.has(MARK_CLASS));

// Trang đang dựng dở: không có <body> thì vẫn phải chạy trót lọt.
const noBody = fakeDom({ texts: ["Hôm nay đã nhận 200/200"], withBody: false });
const saidNoBody = runMark(ON, noBody);
check("không có <body> vẫn không ném, và vẫn cắm được cờ trên ô chữ", noBody.els[0].classList.has(MARK_CLASS), saidNoBody);

console.log(`\n${passed} phép thử qua.`);
