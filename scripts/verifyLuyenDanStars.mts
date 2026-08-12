#!/usr/bin/env node
/**
 * Kiểm chứng CỬA CHẶN「giữ đan mấy sao」của Luyện Đan Đường.
 *
 *   npm run verify:luyen-dan-stars
 *
 * ── CHUYỆN ĐÃ XẢY RA ─────────────────────────────────────────────────────────────────────
 *
 * Tuỳ chọn「Phân giải đan」cho người dùng chọn giữ lại đan từ N sao trở lên. Cách nó hoạt
 * động: mỗi lựa chọn là một DANH SÁCH CHẶN dạng `a|b|c`, đem so với chữ trong hộp thông tin
 * viên đan; hộp nào có tên một bậc sao đang được giữ thì bước「đóng hộp, không phân giải」
 * chạy, và nút Phân giải rời đi cùng cái hộp.
 *
 * Cửa ấy gác bằng selector `#ldModal`. **Trang thật không có phần tử nào tên `#ldModal`.**
 * Hộp thoại của trang là `#ldItemModal`, ruột là `#ldModalBody` (đo trên 13 bản chụp DOM của
 * bản ghi 12/08/2026, và đọc thẳng trong `luyen-dan.min.js`: `Bn("#ldModalBody").innerHTML =
 * '<dl class="ld-info ld-info--pill"><dt>Dược khí</dt><dd>' + n.stars + ' sao</dd>…'`).
 *
 * `conditionProbe` có một luật cố ý: selector có tên mà không khớp phần tử nào thì
 * `textMatches` trả về FALSE, không được phép rơi về quét cả trang. Nên cửa này LUÔN đóng,
 * nhánh giữ đan KHÔNG BAO GIỜ chạy, và mọi lựa chọn — kể cả「Không phân giải (giữ tất cả)」—
 * đều phân giải sạch. Một tính năng im lặng không làm gì suốt từ ngày ra đời.
 *
 * VÌ SAO KHÔNG AI THẤY: fixture `_jarvis-fixtures/pages/alchemy.html` tự dựng một
 * `id="ldModal"` không có thật, nên bộ chạy thử fixture xanh mướt trong khi production câm.
 * Đó chính là lý do tệp này đo trên MARKUP CỦA TRANG THẬT, chép nguyên văn từ bản ghi, chứ
 * không đo trên một trang tự bịa.
 *
 * ── TỆP NÀY ĐO GÌ ────────────────────────────────────────────────────────────────────────
 *
 * Dựng đúng hộp thoại ấy trong Chromium thật rồi chạy CHÍNH `conditionProbe` mà engine gửi
 * xuống trang (`engine.mjs` → `session.evaluate(conditionProbe, …)`), cho đủ bảng thật:
 * 4 bậc sao × 5 lựa chọn. Cộng thêm hai phép so: selector CŨ phải sai ở mọi ô, selector MỚI
 * phải đúng ở mọi ô.
 */
import { chromium } from "playwright-core";
import { conditionProbe } from "../src/lib/quest-engine/boardScripts.mjs";
import { loadProfile } from "../src/lib/quest-engine/profile.mjs";

/**
 * Ruột hộp thoại, CHÉP NGUYÊN VĂN từ `dom/12-click.html` của bản ghi
 * `luyen-dan-duong-20260812-195342` — bản chụp lúc hộp thưởng đang mở với viên 2 sao.
 *
 * Hai chỗ đổi so với bản chụp, và cả hai đều có lý do:
 *   • bỏ `hidden` trên `#ldItemModal` — bản chụp lấy sau khi hộp đã đóng, mà cửa này chỉ được
 *     hỏi lúc hộp đang MỞ.
 *   • thanh nút mang `#ldModalUse` + `#ldModalDecompose` thay vì mỗi nút Đóng: đó là biến thể
 *     mở-từ-TÚI (`luyen-dan.min.js` dựng hai bộ nút khác nhau cho hộp-thưởng và hộp-trong-túi),
 *     và nhánh giữ/phân giải chỉ chạy ở biến thể ấy.
 * Số sao thay bằng `__SAO__` để thổi lại cho từng bậc.
 */
const MODAL_HTML = `
<div class="ld-modal ld-modal--item" id="ldItemModal" role="dialog" aria-modal="true">
  <div class="ld-modal__frame" id="ldItemModalFrame">
    <button type="button" class="ld-modal__close" id="ldModalClose" aria-label="Đóng"></button>
    <div class="ld-modal__scroll" id="ldModalScroll">
      <div class="ld-modal__preview" id="ldModalPreview">
        <img class="ld-modal__preview-img" src="data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==" alt="" decoding="async">
      </div>
      <h3 class="ld-modal__title" id="ldModalTitle">Hạ Phẩm Đan Dược</h3>
      <div class="ld-modal__body" id="ldModalBody">
        <dl class="ld-info ld-info--pill">
          <dt>Dược khí</dt><dd>__SAO__ sao</dd>
          <dt>Số lượng ô này</dt><dd>1</dd>
          <dt>Đan trong túi (phẩm)</dt>
          <dd><span class="ld-info__usage ld-info__usage--bag"><span class="ld-info__usage-val">1/10 viên</span></span></dd>
          <dt>Tu Vi / lần dùng</dt><dd class="ld-info__tu-vi">5.000</dd>
          <dt>Đã sử dụng tháng này</dt>
          <dd><span class="ld-info__usage"><span class="ld-info__usage-val">2/8 viên</span></span></dd>
        </dl>
        <p class="ld-modal__hint ld-modal__hint--pill-collect">Đan đã vào túi — mở ô đan trong <strong>Túi</strong> bên dưới để Sử dụng hoặc Phân giải.</p>
        <p class="ld-modal__hint ld-modal__hint--rank-xp-blocked" role="alert">Không nhận XP nghề. Cấp Đan Tông cần Thu đan Trung Phẩm mới được cộng XP.</p>
      </div>
    </div>
    <div class="ld-modal__actions" id="ldModalActions">
      <button type="button" class="ld-modal-btn ld-modal-btn--use" id="ldModalUse">Sử dụng</button>
      <button type="button" class="ld-modal-btn ld-modal-btn--decompose" id="ldModalDecompose">Phân giải</button>
      <button type="button" class="ld-modal-btn ld-modal-btn--ghost" id="ldModalCloseBtn">Đóng</button>
    </div>
  </div>
</div>`;

/**
 * Selector CŨ — giữ lại trong tệp này như một tang vật, không phải để dùng. Nó là lý do tính
 * năng chết lặng, và một phép thử dưới đây đóng đinh rằng trang không có phần tử nào tên vậy.
 */
const BROKEN_SELECTOR = "#ldModal";

/**
 * BẢN ĐẶC TẢ: mỗi lựa chọn giữ lại những bậc sao nào.
 *
 * Giá trị lấy TỪ `profile.json` chứ không chép tay vào đây — chép tay là phép thử tự chấm bài
 * của chính mình, và bản gốc đổi một chữ thì nó vẫn xanh. Đây chỉ khai ý NGHĨA: chuỗi nào thì
 * phải giữ những sao nào. Danh sách chuỗi phải trùng khít với hồ sơ, và điều đó cũng được kiểm.
 *
 * `«luôn phân giải»` dùng ngoặc nhọn có chủ ý: không chữ nào trên trang chứa nó, nên nó không
 * khớp gì cả — đó chính là cách「phân giải tất cả」được diễn đạt bằng một danh sách chặn.
 */
const SPEC = new Map<string, number[]>([
  ["«luôn phân giải»", []],
  ["dược khí 4 sao", [4]],
  ["dược khí 3 sao|dược khí 4 sao", [3, 4]],
  ["dược khí 2 sao|dược khí 3 sao|dược khí 4 sao", [2, 3, 4]],
  ["dược khí", [1, 2, 3, 4]],
]);

/** Hai nhiệm vụ luyện đan trong hồ sơ (bản VIP và bản thường) — cả hai dùng chung một bộ bước. */
const QUEST_IDS = ["luyen-dan-duong", "luyen-dan-duong-thuong"];

/**
 * Móc CỬA CHẶN SAO ra khỏi hồ sơ đang ship: bước nào mang `when.text === "{{decompose}}"`.
 * Đọc theo Ý NGHĨA chứ không theo số thứ tự bước — chèn thêm một bước ở trên không được phép
 * làm phép thử này im lặng đo nhầm chỗ.
 */
type Gate = { questId: string; selector: string; kind: string };
function gatesOf(profile: { quests: { id: string; steps?: { when?: { kind?: string; selector?: string; text?: string } }[] }[] }): Gate[] {
  const gates: Gate[] = [];
  for (const id of QUEST_IDS) {
    const quest = profile.quests.find((q) => q.id === id);
    if (!quest) continue;
    for (const step of quest.steps ?? []) {
      if (step.when?.text === "{{decompose}}") {
        gates.push({ questId: id, selector: step.when.selector ?? "", kind: step.when.kind ?? "" });
      }
    }
  }
  return gates;
}

const STARS = [1, 2, 3, 4];

const results: string[] = [];
const check = (name: string, ok: boolean, detail = "") => {
  results.push(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const profile = loadProfile();

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.setContent(`<!doctype html><html lang="vi"><body>${MODAL_HTML}</body></html>`);

  /** Thổi lại số sao rồi hỏi engine đúng một câu, y như lúc chạy thật. */
  const ask = async (stars: number, selector: string, text: string): Promise<boolean> => {
    await page.evaluate(
      ({ html }) => {
        document.body.innerHTML = html;
      },
      { html: MODAL_HTML.replace("__SAO__", String(stars)) },
    );
    return page.evaluate(conditionProbe, { kind: "textMatches", selector, text });
  };

  // ---- 1. Trang thật KHÔNG có `#ldModal` — nguyên nhân gốc -------------------------------
  {
    const count = await page.evaluate(() => document.querySelectorAll("#ldModal").length);
    check(`trang không có phần tử nào tên ${BROKEN_SELECTOR}`, count === 0, `đếm được ${count}`);
    const body = await page.evaluate(() => document.querySelectorAll("#ldModalBody").length);
    check("hộp thoại thật là #ldItemModal, ruột là #ldModalBody", body === 1, `đếm được ${body}`);
  }

  // ---- 2. Hồ sơ ĐANG SHIP gác bằng selector nào? -----------------------------------------
  const gates = gatesOf(profile);
  {
    check(`đủ ${QUEST_IDS.length} nhiệm vụ luyện đan có cửa chặn sao`, gates.length === QUEST_IDS.length, gates.map((g) => g.questId).join(", "));
    check("mọi cửa đều là textMatches", gates.every((g) => g.kind === "textMatches"), gates.map((g) => g.kind).join(", "));
    check(
      "không cửa nào còn trỏ vào selector ma",
      gates.every((g) => g.selector !== BROKEN_SELECTOR),
      gates.map((g) => `${g.questId}→${g.selector}`).join(", "),
    );
    const distinct = new Set(gates.map((g) => g.selector));
    check("hai nhiệm vụ dùng CÙNG một selector", distinct.size === 1, [...distinct].join(", "));
  }

  // ---- 3. Danh sách lựa chọn trong hồ sơ phải trùng khít bản đặc tả -----------------------
  const choices: string[] = [];
  {
    const quest = profile.quests.find((q: { id: string }) => q.id === QUEST_IDS[0]);
    const option = quest?.options?.find((o: { key: string }) => o.key === "decompose");
    for (const c of option?.choices ?? []) choices.push(c.value);
    const unknown = choices.filter((v) => !SPEC.has(v));
    const missing = [...SPEC.keys()].filter((v) => !choices.includes(v));
    check(
      `hồ sơ mang đúng ${SPEC.size} lựa chọn phân giải, không thừa không thiếu`,
      unknown.length === 0 && missing.length === 0,
      [...unknown.map((v) => `lạ: ${v}`), ...missing.map((v) => `thiếu: ${v}`)].join(" · "),
    );
  }

  // ---- 4. Bảng thật: mọi lựa chọn × mọi bậc sao, qua selector ĐANG SHIP -------------------
  {
    const selector = gates[0]?.selector ?? "";
    const rows: string[] = [];
    let bad = 0;
    for (const value of choices) {
      const want = SPEC.get(value);
      if (!want) continue;
      const got: number[] = [];
      for (const stars of STARS) {
        if (await ask(stars, selector, value)) got.push(stars);
      }
      if (got.join(",") !== want.join(",")) bad++;
      rows.push(`      ${value.slice(0, 44).padEnd(46)} giữ [${got.join(",") || "—"}]  (mong đợi [${want.join(",") || "—"}])`);
    }
    check(`selector đang ship「${selector}」: đúng ${choices.length} lựa chọn × ${STARS.length} bậc sao`, bad === 0, bad ? `${bad} lựa chọn sai` : "");
    console.log(`\n  Bảng giữ/phân giải đo được (selector ${selector}):`);
    for (const r of rows) console.log(r);
    console.log("");
  }

  // ---- 5. Chính cái lỗi đã xảy ra: selector ma thì cả bảng chết lặng ---------------------
  {
    let leaked = 0;
    for (const value of choices) {
      for (const stars of STARS) {
        if (await ask(stars, BROKEN_SELECTOR, value)) leaked++;
      }
    }
    check(
      `nếu ai trỏ lại vào ${BROKEN_SELECTOR}: cửa câm ở cả ${choices.length * STARS.length} ô — mọi lựa chọn hoá「phân giải tất cả」`,
      leaked === 0,
      `${leaked} ô lọt qua`,
    );
  }

  // ---- 4. Hai cái bẫy của phép so chữ ----------------------------------------------------
  {
    // `dt`/`dd` là hai khối RIÊNG, nên innerText chèn xuống dòng giữa「Dược khí」và「2 sao」.
    // Cửa này sống được là nhờ `conditionProbe` gộp mọi khoảng trắng về một dấu cách trước
    // khi so — mất phép gộp ấy là mất luôn tính năng, nên đóng đinh nó lại.
    const raw = await (async () => {
      await page.evaluate(({ html }) => { document.body.innerHTML = html; }, { html: MODAL_HTML.replace("__SAO__", "2") });
      return page.evaluate(() => (document.querySelector("#ldModalBody") as HTMLElement).innerText);
    })();
    check(
      "chữ trong hộp có xuống dòng giữa tên và giá trị — phép so phải gộp khoảng trắng",
      /Dược khí\s+2 sao/.test(raw) && !raw.includes("Dược khí 2 sao"),
      JSON.stringify(raw.slice(0, 40)),
    );

    // Chỉ số sao mới được nói lên chuyện; các con số khác trong hộp (1/10 viên, 2/8 viên,
    // 5.000) không được phép giả làm một bậc sao.
    const falsePositive = await ask(1, gates[0]?.selector ?? "", "dược khí 2 sao");
    check("viên 1 sao KHÔNG khớp「dược khí 2 sao」dù hộp có số 2 ở chỗ khác", !falsePositive);
  }

  // ---- 7. Dòng kể chuyện phải NÓI RA số sao ----------------------------------------------
  {
    // Lấy chính script đang ship, và chạy nó y như `session.evaluate` bọc chuỗi trước khi gọi
    // — bọc sai thì mọi bước evaluateJavaScript lặng lẽ trả undefined (xem bình chú ở
    // session.mjs), nên phép thử này phải đi qua đúng lớp bọc ấy.
    const quest = profile.quests.find((q: { id: string }) => q.id === QUEST_IDS[0]);
    const step = (quest?.steps ?? []).find(
      (s: { action: string; script?: string }) => s.action === "evaluateJavaScript" && (s.script ?? "").includes("#ldModalBody"),
    );
    const source = step?.script ?? "";
    check("hồ sơ có bước kể chuyện đọc số sao", source.length > 0);

    const run = async (stars: number | null): Promise<unknown> => {
      await page.evaluate(({ html }) => { document.body.innerHTML = html; },
        { html: stars == null ? "<p>không có hộp nào</p>" : MODAL_HTML.replace("__SAO__", String(stars)) });
      return page.evaluate(`(() => { const v = (${source}); return typeof v === "function" ? v() : v; })()`);
    };

    const said: string[] = [];
    let bad = 0;
    for (const stars of STARS) {
      const out = await run(stars);
      if (out !== `!Thu được đan ${stars} sao`) bad++;
      said.push(String(out));
    }
    check("đọc đúng số sao ở cả bốn bậc", bad === 0, said.join(" · "));

    // Lượt ghé giữa chừng (chưa thu đan, không có hộp nào) phải IM — một dòng tường thuật
    // bịa ra còn tệ hơn không có dòng nào.
    const quiet = await run(null);
    check("không có hộp thưởng thì không nói gì", quiet === "", JSON.stringify(quiet));
  }
} finally {
  await browser.close();
}

for (const line of results) console.log(`  ${line}`);
const failed = results.filter((r) => r.startsWith("✗"));
if (failed.length > 0) {
  console.error(`\n✗ ${failed.length}/${results.length} phép thử hỏng.`);
  process.exit(1);
}
console.log(`\n✔ Cửa chặn sao Luyện Đan: ${results.length} phép thử thuận.`);
