#!/usr/bin/env node
/**
 * Kiểm chứng HỘP XÁC NHẬN của Tế Lễ Tông Môn (tài khoản thường).
 *
 *   npm run verify:te-le-confirm
 *
 * ── CHUYỆN ĐÃ XẢY RA ─────────────────────────────────────────────────────────────────────
 *
 * Tế Lễ bấm `#te-le-button`, trang mở một hộp「Đạo hữu chắc chắn dùng 10 Tinh Thạch tế lễ cho
 * Tông Môn?」, và script bấm nút thuận trong hộp ấy. Nút thuận ấy TỪNG là `.swal2-confirm`.
 *
 * **Trang đã bỏ SweetAlert2.** Bản ghi 13/08/2026 (`te-le-tong-mon-20260813-001731`) chụp
 * `/danh-sach-thanh-vien-tong-mon` với **0 lần** xuất hiện chữ `swal2` trong toàn bộ HTML —
 * kể cả phần CSS. Hộp bây giờ là component của chính site: `#hh3d-confirm-layer`, nút thuận
 * `.hh3d-confirm__btn--confirm`, nút từ chối `.hh3d-confirm__btn--cancel`.
 *
 * Nên bước cũ chỉ có thể chờ hết 10 giây rồi hỏng, mọi lượt, kể từ ngày trang đổi.
 *
 * ── HAI CÁI BẪY TỆP NÀY ĐÓNG ĐINH ────────────────────────────────────────────────────────
 *
 * 1. **`#hh3d-confirm-layer` là hộp DÙNG CHUNG, không phải hộp của Tế Lễ.** Cùng trang ấy có
 *    `#leaveGroupBtn`「Thoát Khỏi Tông」, và lớp này là nơi trang hỏi mọi câu có/không. Chờ
 *    「có hộp nào hiện không」rồi bấm nút thuận là một ngày nào đó tự nguyện rời tông môn. Nên
 *    cửa chờ hỏi CHỮ trong hộp, không hỏi sự tồn tại của hộp.
 *
 * 2. **`data-done` trên nút trông như cờ trạng thái nhưng KHÔNG phải.** CSS của trang làm xám
 *    nút ở `[data-done="1"]`, nên rất dễ tin. Bản chụp SAU một lượt tế lễ THÀNH CÔNG
 *    (`dom/04-click.html`) vẫn mang `data-done="0"` trên một cái nút đã `disabled` và đã đổi
 *    chữ thành「Đã Tế Lễ」. Chỉ có CHỮ là nói thật ở cả hai trạng thái.
 *
 * ── TỆP NÀY ĐO GÌ ────────────────────────────────────────────────────────────────────────
 *
 * Dựng markup CHÉP NGUYÊN VĂN từ bản ghi trong Chromium thật, rồi chạy CHÍNH `conditionProbe`
 * mà engine gửi xuống trang — với selector và chữ đọc TỪ `profile.json` đang ship, không chép
 * tay vào đây (chép tay là phép thử tự chấm bài của mình).
 */
import { chromium } from "playwright-core";
import { conditionProbe } from "../src/lib/quest-engine/boardScripts.mjs";
import { loadProfile } from "../src/lib/quest-engine/profile.mjs";

const QUEST_ID = "te-le-tong-mon-thuong";

/** Selector CŨ — giữ lại như tang vật. Một phép thử dưới đây đóng đinh rằng trang không có nó. */
const BROKEN_SELECTOR = ".swal2-confirm";

/**
 * Thanh công cụ tông môn, chép từ `dom/01-load.html` — trạng thái CHƯA tế lễ hôm nay.
 * Giữ nguyên `data-done="0"` và cả nút「Thoát Khỏi Tông」đứng cạnh, vì cái nút ấy chính là
 * lý do cửa chờ phải hỏi chữ.
 */
const TOOLBAR_FRESH = `
<div class="tm-guild-toolbar">
  <button id="leaveGroupBtn" class="btn btn-danger group-button">Thoát Khỏi Tông</button>
  <button id="te-le-button" class="btn btn-danger group-button" data-done="0"><i class="fas fa-praying-hands"></i> Tế Lễ</button>
  <button id="shop-button" type="button" class="btn group-button"><i class="fas fa-store" aria-hidden="true"></i> Tiệm</button>
</div>`;

/**
 * Cùng thanh ấy, chép từ `dom/04-click.html` — SAU một lượt tế lễ thành công.
 * `data-done` vẫn là "0": đó là cái bẫy, không phải lỗi chép.
 */
const TOOLBAR_DONE = `
<div class="tm-guild-toolbar">
  <button id="leaveGroupBtn" class="btn btn-danger group-button">Thoát Khỏi Tông</button>
  <button id="te-le-button" class="btn group-button" data-done="0" disabled="" style="background-color: black;"><i class="fas fa-times"></i> Đã Tế Lễ</button>
  <button id="shop-button" type="button" class="btn group-button"><i class="fas fa-store" aria-hidden="true"></i> Tiệm</button>
</div>`;

/**
 * Hộp xác nhận TẾ LỄ, chép nguyên văn từ `dom/02-click.html` — bản chụp lúc hộp đang mở.
 * Nút「Hủy」đứng TRƯỚC nút「Tế Lễ」trong DOM, nên bất kỳ selector nào không nói rõ `--confirm`
 * đều bấm nhầm vào Hủy. Đó là một phép thử riêng bên dưới.
 */
const CONFIRM_TE_LE = `
<div id="hh3d-confirm-layer" role="alertdialog" aria-modal="true" data-allow-esc="1" data-allow-backdrop="1" style="z-index: 200000;"><div class="hh3d-confirm__backdrop" aria-hidden="true"></div><div class="hh3d-confirm__panel"><div class="hh3d-confirm__iconRow"><div class="hh3d-confirm__icWrap hh3d-confirm__icWrap--warning"><i class="hh3d-confirm__ic hh3d-confirm__ic--warning fa-solid fa-triangle-exclamation"></i></div></div><div class="hh3d-confirm__head"><h2 class="hh3d-confirm__title" id="hh3d-confirm-title">Xác nhận tế lễ</h2></div><div class="hh3d-confirm__body"><p class="hh3d-confirm__text" id="hh3d-confirm-text">Đạo hữu chắc chắn dùng 10 Tinh Thạch tế lễ cho Tông Môn?</p></div><div class="hh3d-confirm__actions"><button type="button" class="hh3d-confirm__btn hh3d-confirm__btn--cancel">Hủy</button><button type="button" class="hh3d-confirm__btn hh3d-confirm__btn--confirm">Tế Lễ</button></div></div></div>`;

/**
 * Hộp「Thoát Khỏi Tông」dựng trên CÙNG component.
 *
 * **Chữ trong hộp này là DỰNG RA, không phải bản ghi** — bản ghi 13/08 không ai bấm nút ấy, và
 * sẽ không ai bấm để lấy mẫu. Cái được kiểm ở đây không phải câu chữ chính xác của site mà là
 * tính chất của cửa chờ: hộp cùng lớp nhưng KHÁC việc thì phải không khớp. Ngày nào có bản ghi
 * thật thì thay chữ vào đây, hình dạng khối không đổi.
 */
const CONFIRM_LEAVE = `
<div id="hh3d-confirm-layer" role="alertdialog" aria-modal="true" style="z-index: 200000;"><div class="hh3d-confirm__backdrop" aria-hidden="true"></div><div class="hh3d-confirm__panel"><div class="hh3d-confirm__head"><h2 class="hh3d-confirm__title" id="hh3d-confirm-title">Xác nhận rời tông</h2></div><div class="hh3d-confirm__body"><p class="hh3d-confirm__text" id="hh3d-confirm-text">Đạo hữu chắc chắn muốn thoát khỏi Tông Môn?</p></div><div class="hh3d-confirm__actions"><button type="button" class="hh3d-confirm__btn hh3d-confirm__btn--cancel">Hủy</button><button type="button" class="hh3d-confirm__btn hh3d-confirm__btn--confirm">Thoát</button></div></div></div>`;

const results: string[] = [];
const check = (name: string, ok: boolean, detail = "") => {
  results.push(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
};

type Condition = { kind?: string; selector?: string; text?: string };
type Step = { action: string; selector?: string; text?: string; condition?: Condition };

const profile = loadProfile();
const quest = profile.quests.find((q: { id: string }) => q.id === QUEST_ID) as
  | { id: string; steps: Step[] }
  | undefined;

if (!quest) {
  console.error(`✗ không thấy nhiệm vụ ${QUEST_ID} trong hồ sơ.`);
  process.exit(1);
}

/**
 * Móc các bước ra theo Ý NGHĨA, không theo số thứ tự — chèn thêm một bước ở trên không được
 * phép làm phép thử này lặng lẽ đo nhầm chỗ.
 */
const steps = quest.steps ?? [];
const doneGate = steps.find(
  (s) => s.action === "stopIf" && s.condition?.selector === "#te-le-button",
);
const confirmWait = steps.find(
  (s) => s.action === "waitForCondition" && (s.condition?.selector ?? "").includes("hh3d-confirm"),
);
const confirmClick = steps.find(
  (s) => s.action === "click" && (s.selector ?? "").includes("hh3d-confirm"),
);
const successWait = steps.filter(
  (s) => s.action === "waitForCondition" && s.condition?.selector === "#te-le-button",
);

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.setContent('<!doctype html><html lang="vi"><body></body></html>');

  /** Thay ruột trang rồi hỏi engine đúng một câu, y như lúc chạy thật. */
  const render = (html: string) =>
    page.evaluate(({ h }) => {
      document.body.innerHTML = h;
    }, { h: html });
  const ask = (condition: Condition) => page.evaluate(conditionProbe, condition);

  // ---- 1. Nguyên nhân gốc: trang KHÔNG còn SweetAlert2 -----------------------------------
  {
    await render(TOOLBAR_FRESH + CONFIRM_TE_LE);
    const swal = await page.evaluate((sel) => document.querySelectorAll(sel).length, BROKEN_SELECTOR);
    check(`hộp thật không có phần tử nào tên ${BROKEN_SELECTOR}`, swal === 0, `đếm được ${swal}`);
    const layer = await page.evaluate(() => document.querySelectorAll("#hh3d-confirm-layer").length);
    check("hộp thật là #hh3d-confirm-layer", layer === 1, `đếm được ${layer}`);
  }

  // ---- 2. Hồ sơ ĐANG SHIP trỏ vào đâu ----------------------------------------------------
  {
    check("hồ sơ có bước chờ hộp xác nhận", Boolean(confirmWait), confirmWait?.condition?.selector ?? "KHÔNG CÓ");
    check("hồ sơ có bước bấm nút thuận", Boolean(confirmClick), confirmClick?.selector ?? "KHÔNG CÓ");
    // Hỏi các trường SELECTOR chứ không quét cả khối JSON: ghi chú được phép — và nên — kể
    // rằng trang đã bỏ SweetAlert2, mà một phép quét chuỗi sẽ đọc chính lời kể ấy thành vi phạm.
    const selectorsOf = (list: Step[]) =>
      list.flatMap((s) => [s.selector ?? "", s.condition?.selector ?? ""]).filter(Boolean);
    const stillSwal = selectorsOf(steps).filter((sel) => sel.includes("swal2"));
    check("không selector nào trong nhiệm vụ còn trỏ vào swal2", stillSwal.length === 0, stillSwal.join(", "));
    check(
      "cửa chờ hỏi CHỮ chứ không chỉ hỏi hộp",
      confirmWait?.condition?.kind === "textMatches" && Boolean(confirmWait?.condition?.text),
      `${confirmWait?.condition?.kind} / ${JSON.stringify(confirmWait?.condition?.text ?? null)}`,
    );
    check(
      "nút thuận được khoanh trong lớp xác nhận, và nói rõ --confirm",
      (confirmClick?.selector ?? "").startsWith("#hh3d-confirm-layer ") &&
        (confirmClick?.selector ?? "").includes("--confirm"),
      confirmClick?.selector ?? "",
    );
    // Hỏi các trường SELECTOR, không quét cả khối JSON: ghi chú của bước bấm có nhắc tên nút
    // Hủy đúng để dặn đừng đụng vào, và một phép quét chuỗi sẽ đọc lời dặn ấy thành vi phạm.
    const touchesCancel = steps.filter(
      (s) => (s.selector ?? "").includes("--cancel") || (s.condition?.selector ?? "").includes("--cancel"),
    );
    check("không bước nào TRỎ vào nút Hủy", touchesCancel.length === 0, touchesCancel.map((s) => s.selector).join(", "));
  }

  // ---- 3. Cửa chờ: đúng hộp thì mở, hộp khác cùng lớp thì KHÔNG ---------------------------
  {
    const cond = confirmWait?.condition ?? {};

    await render(TOOLBAR_FRESH + CONFIRM_TE_LE);
    check(`cửa chờ mở trên hộp tế lễ thật`, (await ask(cond)) === true);

    await render(TOOLBAR_FRESH + CONFIRM_LEAVE);
    const leaked = await ask(cond);
    check(
      "cửa chờ KHÔNG mở trên hộp「Thoát Khỏi Tông」dựng trên cùng component",
      leaked === false,
      leaked ? "LỌT — script sẽ tự bấm thuận cho một câu hỏi khác" : "",
    );

    await render(TOOLBAR_FRESH);
    check("chưa có hộp nào thì cửa chờ đóng", (await ask(cond)) === false);
  }

  // ---- 4. Cú bấm rơi vào ĐÚNG nút — Hủy đứng trước trong DOM ------------------------------
  {
    await render(TOOLBAR_FRESH + CONFIRM_TE_LE);
    // Selector rỗng nghĩa là hồ sơ KHÔNG có bước bấm nào trỏ vào lớp xác nhận — mục 2 đã kêu
    // rồi. Đưa chuỗi rỗng cho `querySelectorAll` thì nó NÉM, và một cú ném ở đây giết cả bản
    // kê, biến một phép thử đỏ thành một tệp câm. Trả về "không khớp gì" mới là câu trả lời
    // đúng cho câu hỏi đang hỏi.
    const hit = await page.evaluate((sel) => {
      if (!sel) return { count: 0, text: "", isCancel: false };
      const els = Array.from(document.querySelectorAll(sel));
      return {
        count: els.length,
        text: els.length === 1 ? (els[0].textContent ?? "").trim() : "",
        isCancel: els.some((e) => e.classList.contains("hh3d-confirm__btn--cancel")),
      };
    }, confirmClick?.selector ?? "");
    check("selector bấm khớp đúng MỘT phần tử", hit.count === 1, `đếm được ${hit.count}`);
    check("phần tử ấy là nút「Tế Lễ」", hit.text === "Tế Lễ", JSON.stringify(hit.text));
    check("và tuyệt đối không phải nút Hủy", hit.isCancel === false);

    // Nếu ai đó rút gọn selector về `.hh3d-confirm__btn`, cú bấm rơi vào Hủy — vì Hủy đứng
    // trước trong DOM và Playwright bấm phần tử đầu tiên khớp. Đóng đinh cái thứ tự ấy lại.
    const first = await page.evaluate(() =>
      (document.querySelector(".hh3d-confirm__btn")?.textContent ?? "").trim(),
    );
    check("nút ĐẦU TIÊN trong hộp vẫn là Hủy — nên selector rút gọn là bấm nhầm", first === "Hủy", JSON.stringify(first));
  }

  // ---- 5. Cửa「đã tế lễ hôm nay」: chỉ CHỮ nói thật, `data-done` thì không ------------------
  {
    const cond = doneGate?.condition ?? {};
    check("hồ sơ có cửa dừng khi đã tế lễ", Boolean(doneGate), JSON.stringify(cond.text ?? null));

    await render(TOOLBAR_FRESH);
    check("nút「Tế Lễ」KHÔNG bị nhận nhầm là đã xong (bài học bỏ dấu: \"te le\" ⊅ \"da te le\")", (await ask(cond)) === false);

    await render(TOOLBAR_DONE);
    check("nút「Đã Tế Lễ」thì cửa dừng mở", (await ask(cond)) === true);

    // Cái bẫy, đo trên chính bản chụp sau lượt thành công.
    const attr = await page.evaluate(() => ({
      done: document.querySelector("#te-le-button")?.getAttribute("data-done"),
      disabled: (document.querySelector("#te-le-button") as HTMLButtonElement | null)?.disabled,
    }));
    check(
      "sau lượt THÀNH CÔNG, data-done vẫn là \"0\" — nên không ai được gác bằng nó",
      attr.done === "0" && attr.disabled === true,
      `data-done=${JSON.stringify(attr.done)} disabled=${attr.disabled}`,
    );
    // Lại là phép hỏi SELECTOR: ghi chú ở trên cố ý nêu tên `data-done` để dặn đừng dùng nó.
    const readsDone = steps.filter(
      (s) => (s.selector ?? "").includes("data-done") || (s.condition?.selector ?? "").includes("data-done"),
    );
    check("và không selector nào của hồ sơ đọc data-done", readsDone.length === 0, readsDone.map((s) => s.selector).join(", "));
  }

  // ---- 6. Cửa nghiệm thu sau khi bấm: lễ bị từ chối phải kêu to ---------------------------
  {
    check("có ít nhất một cửa chờ nghiệm thu trên chính cái nút", successWait.length >= 1, `đếm được ${successWait.length}`);
    const cond = successWait.at(-1)?.condition ?? {};

    await render(TOOLBAR_DONE);
    check("nút đã đổi chữ thì cửa nghiệm thu mở", (await ask(cond)) === true);

    // Lễ bị từ chối (hết Tinh Thạch, server lỗi): trang đóng hộp nhưng nút không đổi gì. Cửa
    // này phải ĐÓNG, để bước hết giờ và lượt chạy báo hỏng thay vì nhận vơ là xong.
    await render(TOOLBAR_FRESH);
    check("lễ bị từ chối (nút không đổi) thì cửa nghiệm thu vẫn đóng", (await ask(cond)) === false);
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
console.log(`\n✔ Hộp xác nhận Tế Lễ: ${results.length} phép thử thuận.`);
