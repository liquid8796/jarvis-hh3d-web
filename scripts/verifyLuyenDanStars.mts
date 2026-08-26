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
import { loadProfile, profileForConfig } from "../src/lib/quest-engine/profile.mjs";

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
 * Hai chỗ thay được: `__SAO__` cho bậc sao, và `__TUI__` cho con số「Đan trong túi (phẩm)」—
 * cái sau là thứ cửa HẠN MỨC đọc, nên nó phải thổi lại được y như bậc sao.
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
          <dd><span class="ld-info__usage ld-info__usage--bag"><span class="ld-info__usage-val">__TUI__/10 viên</span></span></dd>
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

/** Hộp thoại với đúng bậc sao và đúng số đan đang nằm trong túi. */
const modalHtml = (stars: number, bag = 1) =>
  MODAL_HTML.replace("__SAO__", String(stars)).replace("__TUI__", String(bag));

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
  await page.setContent(`<!doctype html><html lang="vi"><body>${modalHtml(2)}</body></html>`);

  /** Thổi lại số sao rồi hỏi engine đúng một câu, y như lúc chạy thật. */
  const ask = async (stars: number, selector: string, text: string): Promise<boolean> => {
    await page.evaluate(
      ({ html }) => {
        document.body.innerHTML = html;
      },
      { html: modalHtml(stars) },
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
    // ĐẾM THEO NHIỆM VỤ, không đếm số cửa. Từ schema 57 mỗi twin có HAI bước dùng chung cửa ấy
    // — bước kể chuyện nhánh giữ và lượt đóng hộp ngay sau nó — nên một phép đếm instance sẽ đỏ
    // với đúng cái nó phải cho qua. Điều luật này canh vẫn nguyên nghĩa: KHÔNG twin nào được
    // phép mất cửa. (Mọi cửa phải cùng loại và cùng selector — hai phép kiểm ngay dưới.)
    const covered = new Set(gates.map((g) => g.questId));
    check(`đủ ${QUEST_IDS.length} nhiệm vụ luyện đan có cửa chặn sao`, covered.size === QUEST_IDS.length, [...covered].join(", "));
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
      await page.evaluate(({ html }) => { document.body.innerHTML = html; }, { html: modalHtml(2) });
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
        { html: stars == null ? "<p>không có hộp nào</p>" : modalHtml(stars) });
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

  // ---- 8. NHÁNH GIỮ cũng phải có tiếng nói (schema 57) ------------------------------------
  //
  // Trước 14/08/2026 nhánh giữ hoàn toàn câm: nhật ký có「Thu được đan N sao」và「Phân giải viên
  // đan」, nhưng khi cửa GIỮ bật thì không một dòng nào. Hệ quả không phải chuyện thẩm mỹ — nó
  // làm tính năng này KHÔNG KIỂM CHỨNG ĐƯỢC từ nhật ký: một báo cáo「giữ 4 sao không hoạt động」
  // phải ghép snapshot của hai database mới trả lời nổi, và câu trả lời hoá ra là engine vẫn
  // đúng. Nhóm này đóng đinh cái tiếng nói ấy.
  {
    const KEEP_NOTE = "kể chuyện: viên đan được GIỮ, không phân giải";

    // Có ở CẢ HAI twin, và đứng ĐÚNG trước lượt đóng hộp — đứng sau thì hộp đã đóng, script đọc
    // vào khoảng không rồi im, tức lại câm y như cũ.
    let placed = 0;
    let sameGate = 0;
    for (const id of QUEST_IDS) {
      const steps = (profile.quests.find((q: { id: string }) => q.id === id)?.steps ?? []) as {
        action: string;
        note?: string;
        selector?: string;
        when?: { kind?: string; selector?: string; text?: string };
      }[];
      const at = steps.findIndex((s) => s.note === KEEP_NOTE);
      const next = at >= 0 ? steps[at + 1] : undefined;
      if (at >= 0 && next?.action === "click" && next.selector === "#ldModalCloseBtn") placed += 1;
      // Cùng MỘT cửa với lượt đóng hộp: lệch cửa là kể một đằng làm một nẻo — dòng nhật ký nói
      // 「đã giữ」trong khi bước dưới vẫn đi phân giải.
      if (
        at >= 0 &&
        JSON.stringify(steps[at].when ?? null) === JSON.stringify(next?.when ?? null) &&
        steps[at].when?.kind === "textMatches"
      ) {
        sameGate += 1;
      }
    }
    check("cả hai twin có bước kể chuyện nhánh GIỮ, ngay trước lượt đóng hộp", placed === 2, `${placed}/2`);
    check("bước kể chuyện dùng ĐÚNG cửa của lượt đóng hộp — không kể một đằng làm một nẻo", sameGate === 2, `${sameGate}/2`);

    const keepStep = (profile.quests.find((q: { id: string }) => q.id === QUEST_IDS[0])?.steps ?? []).find(
      (s: { note?: string }) => s.note === KEEP_NOTE,
    ) as { script?: string } | undefined;
    const keepSource = keepStep?.script ?? "";
    check("bước ấy có script để mà chạy", keepSource.length > 0);

    const runKeep = async (stars: number | null): Promise<unknown> => {
      await page.evaluate(({ html }) => { document.body.innerHTML = html; },
        { html: stars == null ? "<p>không có hộp nào</p>" : modalHtml(stars) });
      return page.evaluate(`(() => { const v = (${keepSource}); return typeof v === "function" ? v() : v; })()`);
    };

    const said: string[] = [];
    let bad = 0;
    for (const stars of STARS) {
      const out = await runKeep(stars);
      if (out !== `!Giữ lại viên đan ${stars} sao — mức phân giải đã chọn không đụng tới nó`) bad += 1;
      said.push(String(out).slice(0, 26));
    }
    check("nói đúng số sao của viên được giữ, ở cả bốn bậc", bad === 0, said.join(" · "));

    // Dấu `!` là kênh đưa dòng này lên nhật ký người dùng; thiếu nó thì câu chữ vẫn đúng mà
    // không ai đọc được — đúng cái im lặng đang vá.
    const one = String(await runKeep(4));
    check("dòng kể đi kênh `!` (nhật ký người dùng), không phải kênh debug", one.startsWith("!"), one.slice(0, 30));

    // Hộp đã đóng / chưa có hộp: PHẢI im. `conditionProbe` lùi về els[0] khi không phần tử nào
    // đang hiện, nên cửa `when` một mình không đủ chặn một hộp cũ còn nằm trong DOM — chính vì
    // thế script tự đo bề rộng.
    const quietKeep = await runKeep(null);
    check("không có hộp thì nhánh GIỮ cũng im", quietKeep === "", JSON.stringify(quietKeep));

    await page.evaluate(({ html }) => { document.body.innerHTML = html; }, { html: modalHtml(4) });
    await page.evaluate(() => {
      const el = document.querySelector("#ldItemModal") as HTMLElement | null;
      if (el) el.style.display = "none";
    });
    const hidden = await page.evaluate(`(() => { const v = (${keepSource}); return typeof v === "function" ? v() : v; })()`);
    check("hộp ĐANG ẨN mà còn markup cũ thì vẫn im — phép đo bề rộng gác chỗ này", hidden === "", JSON.stringify(hidden));
  }

  // ---- 9. HẠN MỨC GIỮ ĐAN (schema 75) ----------------------------------------------------
  //
  // Hạn mức đếm dòng「Đan trong túi (phẩm)」/「5/10 viên」— tổng đan cùng phẩm đang nằm trong
  // túi. Nó là con số DUY NHẤT một lần mở hộp trả lời trọn vẹn: dòng「Số lượng ô này」chỉ nói
  // về đúng ô đang mở, nên muốn cộng đủ mọi bậc sao thì phải mở lần lượt từng ô — một vòng lặp
  // mà flow này không có.
  //
  // Cửa vẫn là `textMatches`, tức SO CHỮ chứ không so số, nên lớp dịch rải sẵn từng con số hợp
  // lệ (`bagCountAtLeast`). Hai cái bẫy của lối ấy được đóng đinh ở đây:
  //
  //   • mỗi mảnh phải kết thúc bằng dấu `/`, không thì「… 1」nuốt luôn「… 11/10」và một túi
  //     mười một viên bị đọc thành một viên;
  //   • hết trần 30 thì cửa thôi khớp — và đó là phía AN TOÀN: không khớp nghĩa là GIỮ đan,
  //     chứ không phải phân giải nhầm.
  {
    const NO_CAP = "«không hạn mức»";
    const CAP_KEYS = ["capOver", "capFull"] as const;
    const selector = gates[0]?.selector ?? "";

    type CapStep = {
      action: string;
      selector?: string;
      note?: string;
      script?: string;
      when?: { kind?: string; selector?: string; text?: string };
      condition?: { kind?: string; selector?: string; text?: string };
    };
    const stepsOf = (id: string) =>
      (profile.quests.find((q: { id: string }) => q.id === id)?.steps ?? []) as CapStep[];
    const optionOf = (id: string, key: string) =>
      ((profile.quests.find((q: { id: string }) => q.id === id)?.options ?? []) as {
        key: string;
        selectedValue?: string;
      }[]).find((o) => o.key === key);

    /** Hỏi engine đúng một câu, với một hộp mang `stars` sao và `bag` viên trong túi. */
    const askBag = async (stars: number, bag: number, text: string): Promise<boolean> => {
      await page.evaluate(({ html }) => { document.body.innerHTML = html; }, { html: modalHtml(stars, bag) });
      return page.evaluate(conditionProbe, { kind: "textMatches", selector, text });
    };

    // 9a. Hai option có mặt ở CẢ HAI twin, và mặc định của chúng là một chuỗi không khớp gì.
    let present = 0;
    for (const id of QUEST_IDS) {
      for (const key of CAP_KEYS) {
        if (optionOf(id, key)?.selectedValue === NO_CAP) present += 1;
      }
    }
    check(
      `cả ${QUEST_IDS.length} twin mang đủ ${CAP_KEYS.length} option hạn mức, mặc định「không hạn mức」`,
      present === 4,
      `${present}/4`,
    );

    // 9b. Mặc định ấy phải CÂM thật: không hộp nào — bậc sao nào, túi mấy viên — khớp nổi nó.
    {
      let leaked = 0;
      for (const bag of [1, 5, 10, 30]) {
        for (const stars of STARS) if (await askBag(stars, bag, NO_CAP)) leaked += 1;
      }
      check("「không hạn mức」không khớp ô nào trong 16 ô — nhánh tắt là nhánh câm", leaked === 0, `${leaked} ô lọt`);
    }

    // 9c. Thứ tự bước — đây là toàn bộ thiết kế, nên nó phải được đóng đinh.
    //
    // Nhánh giữ GIỮ đan bằng cách ĐÓNG hộp, và cú đóng ấy mang luôn nút Phân Giải đi. Nên thứ
    // gì muốn lật lại chữ「giữ」đều phải nói trước nó, lúc hộp còn mở và chữ còn sống. Còn
    // `stopIf` phải đứng trước cụm khai lô, không thì「đủ chỉ tiêu」biết muộn mất một mẻ đan.
    {
      let ordered = 0;
      let beforeCraft = 0;
      let chained = 0;
      for (const id of QUEST_IDS) {
        const steps = stepsOf(id);
        const capOver = steps.findIndex((s) => s.when?.text === "{{capOver}}");
        const stopIf = steps.findIndex((s) => s.action === "stopIf" && s.condition?.text === "{{capFull}}");
        const keepClose = steps.findIndex(
          (s) => s.action === "click" && s.selector === "#ldModalCloseBtn" && s.when?.text === "{{decompose}}",
        );
        const craft = steps.findIndex((s) => s.action === "click" && s.selector === "#ldBtnCraft");
        if (capOver >= 0 && stopIf >= 0 && keepClose >= 0 && capOver < keepClose && stopIf < keepClose) ordered += 1;
        if (stopIf >= 0 && craft >= 0 && stopIf < craft) beforeCraft += 1;

        // Cụm phân giải của nhánh hạn mức phải TRỌN VẸN: kể chuyện, bấm Phân Giải, chờ hộp xác
        // nhận, bấm OK. Thiếu cú xác nhận thì hộp treo giữa màn và mọi bước sau bấm vào khoảng
        // không.
        const chain = steps.slice(capOver, capOver + 4);
        if (
          capOver >= 0 &&
          chain.length === 4 &&
          chain[0]?.action === "evaluateJavaScript" &&
          chain[1]?.selector === "#ldModalDecompose" &&
          chain[2]?.action === "waitForCondition" &&
          chain[3]?.selector === "#ldConfirmOk"
        ) {
          chained += 1;
        }
      }
      check("cụm hạn mức nói TRƯỚC nhánh giữ sao — hộp còn mở thì mới lật lại được", ordered === 2, `${ordered}/2`);
      check("stopIf đứng TRƯỚC cụm khai lô — đủ chỉ tiêu là thôi luyện, không luyện thừa một mẻ", beforeCraft === 2, `${beforeCraft}/2`);
      check("nhánh vượt hạn mức đi trọn cụm: kể → Phân Giải → chờ xác nhận → OK", chained === 2, `${chained}/2`);
    }

    // 9d. BẢNG THẬT: lớp dịch sinh danh sách, Chromium chấm bài.
    //
    // `từ` là ngưỡng danh sách bắt đầu — mode phân giải lấy `cap + 1` (chỉ đụng viên DƯ), mode
    // dừng lấy chính `cap` (đủ là dừng). Cột 11/12 là cái bẫy tiền tố: thiếu dấu `/` ở cuối mỗi
    // mảnh thì một túi 11 viên khớp cả danh sách bắt đầu từ 1.
    {
      const listFor = (mode: "decompose" | "stop", cap: number): string => {
        const built = profileForConfig({
          quests: {
            luyenDan: {
              enabled: true,
              tier: "Hạ Phẩm",
              keepStarsFrom: 4,
              keepCapEnabled: true,
              keepCap: cap,
              keepCapMode: mode,
            },
          },
        });
        const quest = built.quests.find((x: { id: string }) => x.id === QUEST_IDS[0]);
        const key = mode === "stop" ? "capFull" : "capOver";
        return (
          ((quest?.options ?? []) as { key: string; selectedValue?: string }[]).find((o) => o.key === key)
            ?.selectedValue ?? ""
        );
      };

      const BAGS = [1, 2, 3, 4, 10, 11, 12, 30];
      const CASES = [
        ["decompose", 1],
        ["decompose", 3],
        ["decompose", 10],
        ["stop", 1],
        ["stop", 3],
        ["stop", 11],
      ] as const;
      const rows: string[] = [];
      let bad = 0;
      for (const [mode, cap] of CASES) {
        const text = listFor(mode, cap);
        const from = mode === "stop" ? cap : cap + 1;
        const got: number[] = [];
        for (const bag of BAGS) if (await askBag(4, bag, text)) got.push(bag);
        const want = BAGS.filter((b) => b >= from);
        if (got.join(",") !== want.join(",")) bad += 1;
        rows.push(
          `      ${mode.padEnd(10)} hạn mức ${String(cap).padStart(2)} (từ ${String(from).padStart(2)})  khớp [${got.join(",")}]  (mong đợi [${want.join(",")}])`,
        );
      }
      check(`bảng hạn mức: ${CASES.length} cấu hình × ${BAGS.length} mức túi, đo bằng chính conditionProbe`, bad === 0, bad ? `${bad} hàng sai` : "");
      console.log("\n  Bảng hạn mức giữ đan đo được:");
      for (const r of rows) console.log(r);
      console.log("");

      // Đường đi THẬT của giá trị này còn một chặng nữa mà phép đo trên không chạm tới:
      // `buildOptionValues` của engine, với một giá trị tự nhập, CẮT bỏ nháy đơn, backslash và
      // ký tự xuống dòng trước khi thay vào `{{capOver}}`. Danh sách nào mang một trong số ấy sẽ
      // tới trang dưới hình dạng khác hẳn thứ đo được ở đây — nên đóng đinh rằng nó không mang.
      const scrubbed = /['\\\n\r]/.test(listFor("decompose", 7));
      check("danh sách sinh ra không mang ký tự nào engine sẽ cắt lúc thay {{…}}", !scrubbed);

      // Trần 30: quá nó thì cửa thôi khớp, và im lặng ấy phải nghiêng về phía GIỮ đan.
      const over = await askBag(4, 31, listFor("decompose", 3));
      check("túi vượt trần 30 thì cửa thôi khớp — im lặng nghiêng về phía GIỮ, không phân giải", !over);

      // Lớp dịch phải TỪ CHỐI đặt hạn mức khi không giữ viên nào: hạn mức của một tuỳ chọn
      //「Phân giải tất cả」là một con số không có gì để đếm.
      const none = profileForConfig({
        quests: {
          luyenDan: {
            enabled: true,
            tier: "Hạ Phẩm",
            keepStarsFrom: 0,
            keepCapEnabled: true,
            keepCap: 3,
            keepCapMode: "stop",
          },
        },
      });
      const quest0 = none.quests.find((x: { id: string }) => x.id === QUEST_IDS[0]);
      const stillOff = CAP_KEYS.every(
        (k) =>
          ((quest0?.options ?? []) as { key: string; selectedValue?: string }[]).find((o) => o.key === k)
            ?.selectedValue === NO_CAP,
      );
      check("chọn「Phân giải tất cả」thì hạn mức bị bỏ qua, dù công tắc có bật", stillOff);
    }

    // 9e. Hai dòng kể chuyện của cụm hạn mức — cùng luật với nhánh giữ: nói đúng, và IM khi
    // không có hộp nào để đọc.
    {
      const scriptOf = (noteFragment: string) =>
        stepsOf(QUEST_IDS[0]).find((s) => (s.note ?? "").includes(noteFragment))?.script ?? "";
      const runScript = async (source: string, html: string | null): Promise<unknown> => {
        await page.evaluate(({ h }) => { document.body.innerHTML = h; }, { h: html ?? "<p>không có hộp nào</p>" });
        return page.evaluate(`(() => { const v = (${source}); return typeof v === "function" ? v() : v; })()`);
      };

      const overSrc = scriptOf("phân giải vì túi đã đủ hạn mức");
      const fullSrc = scriptOf("đã đủ hạn mức, dừng luyện");
      check("hồ sơ có đủ hai bước kể chuyện của cụm hạn mức", overSrc.length > 0 && fullSrc.length > 0);

      const overSaid = String(await runScript(overSrc, modalHtml(4, 7)));
      check(
        "dòng vượt hạn mức nói đúng số viên trong túi VÀ bậc sao của viên bị phân giải",
        overSaid.startsWith("!") && overSaid.includes(" 7 viên") && overSaid.includes("4 sao"),
        overSaid,
      );

      const fullSaid = String(await runScript(fullSrc, modalHtml(2, 5)));
      check("dòng đủ hạn mức nói đúng số viên đang giữ", fullSaid.startsWith("!") && fullSaid.includes(" 5 viên"), fullSaid);

      const quiet = [await runScript(overSrc, null), await runScript(fullSrc, null)];
      check("không có hộp thì cả hai dòng đều im", quiet.every((v) => v === ""), JSON.stringify(quiet));
    }
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
