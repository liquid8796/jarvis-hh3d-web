#!/usr/bin/env node
/**
 * Kiểm chứng cụm「Mở Lì Xì Nhanh」của Hỷ Sự Đường (schema 72).
 *
 *   npm run verify:hy-su-quick
 *
 * ── VÌ SAO CỤM NÀY TỒN TẠI ───────────────────────────────────────────────────────────────
 *
 * Ghi chú của tông chủ trong bản ghi `hy-su-duong-20260822-222109`: "ngoài việc vào từng phòng
 * nhận lì xì thì chúng ta còn phải check thêm button mở lì xì nhanh nữa nhé, kết hợp cả 2 luôn
 * mới ko sót phòng nào."
 *
 * Bằng chứng nằm trong chính thân trả lời `show_all_wedding` của bản ghi ấy:
 * `unopened_li_xi_count: 1` trong khi CẢ HAI phòng đang hiện đều khai `has_li_xi: false`. Tức
 * có lì xì KHÔNG thuộc phòng nào còn trong danh sách — ghé hết mọi phòng vẫn sót đúng nó, và
 * cái nút này là đường duy nhất với tới. Chiều ngược lại cũng đúng: nút chỉ mở LÌ XÌ, còn lời
 * chúc vẫn phải gửi trong phòng. Hai việc, không thay nhau được.
 *
 * ── BA CÁI BẪY TỆP NÀY ĐÓNG ĐINH ─────────────────────────────────────────────────────────
 *
 * 1. **CHỖ ĐỨNG của cụm, không phải nội dung của nó.** Ngày「đã chúc hết」là ngày bước đếm cắm
 *    `jvz-hy-su-done` và `StopIf` KẾT THÚC nhiệm vụ. Bản ghi 22/08 chụp đúng ngày ấy — nút chúc
 *    nhanh xám ngắt "Đã Chúc Hết", `unbless_count: 0` — mà vẫn còn một lì xì. Cụm đặt SAU hai
 *    cổng ấy là mỗi ngày như thế lì xì nằm lại nguyên vẹn còn nhật ký vẫn báo xong.
 *
 * 2. **Cái nút BIẾN MẤT khi xong.** Trang thay hẳn `#quick-open-li-xi-btn` bằng
 *    `.no-li-xi-status`("Không có lì xì nào chưa mở") trong cùng `.wedding-quick-li-xi-section`.
 *    Nên mọi bước sau cú bấm mà hỏi lại cái nút sẽ bị bỏ qua ĐÚNG ở ca thành công — cùng cái
 *    bẫy đã trả giá ở cụm đoạt mỏ Khoáng Mạch. Cả cụm phải bám vào một CỜ trên body.
 *
 * 3. **Nút Hủy đứng TRƯỚC trong hộp xác nhận**, y như hộp của Tế Lễ. Rút gọn selector về
 *    `.td-confirm-btn` là bấm Hủy ở mọi lượt — và một lượt Hủy trông y hệt một lượt không có
 *    gì để mở.
 *
 * ── VÌ SAO CẢ HAI TWIN, DÙ NÚT MANG HUY HIỆU VIP ─────────────────────────────────────────
 *
 * `requiresVip` là PHỎNG ĐOÁN CỦA TA về hạng tài khoản; việc cái nút có được vẽ ra hay không
 * là quyết định của SITE. Gác bằng cờ DOM chặt hơn gác bằng phỏng đoán ấy — hạng đọc hụt một
 * lượt là mất trắng phần lì xì, còn thừa một bước dò thì không mất gì. Và hồ sơ này có luật
 * riêng: hai twin phải giống nhau ở phần tri thức về site.
 *
 * ── TỆP NÀY ĐO GÌ ────────────────────────────────────────────────────────────────────────
 *
 * Markup CHÉP NGUYÊN VĂN từ `dom/*.html` của bản ghi, dựng trong Chromium thật; điều kiện hỏi
 * bằng CHÍNH `conditionProbe` engine gửi xuống trang; script chạy qua ĐÚNG lớp bọc của
 * `session.evaluate`; và mọi selector đọc TỪ `profile.json` đang ship chứ không chép tay.
 */
import { chromium } from "playwright-core";
import { conditionProbe } from "../src/lib/quest-engine/boardScripts.mjs";
import { loadProfile } from "../src/lib/quest-engine/profile.mjs";

const VIP_ID = "hy-su-duong";
const FREE_ID = "hy-su-duong-thuong";
const QUICK_BTN = "#quick-open-li-xi-btn";
const QUICK_MARK = "body.jvz-hy-su-quick";

/** `dom/02-click.html` — còn 1 lì xì chưa mở. Nút chúc nhanh xám ngắt đứng ngay trên, giữ nguyên. */
const SECTION_OPEN = `
<div class="wedding-quick-bless-section"><button id="quick-bless-btn" class="wedding-quick-bless-btn disabled" onclick="quickBlessAll()" disabled=""><i class="fas fa-magic"></i> Đã Chúc Hết </button></div>
<div class="wedding-quick-li-xi-section"><button id="quick-open-li-xi-btn" class="wedding-quick-open-li-xi-btn" onclick="quickOpenAllLiXi()"><i class="fas fa-gift"></i> Mở Lì Xì Nhanh (1) </button></div>`;

/** `dom/05-click.html` — SAU khi mở hết. Cùng một khung, ruột thay hẳn. */
const SECTION_DONE = `
<div class="wedding-quick-bless-section"><button id="quick-bless-btn" class="wedding-quick-bless-btn disabled" onclick="quickBlessAll()" disabled=""><i class="fas fa-magic"></i> Đã Chúc Hết </button></div>
<div class="wedding-quick-li-xi-section"><div class="no-li-xi-status"><span class="li-xi-icon">🧧</span><span class="status-text">Không có lì xì nào chưa mở</span></div></div>`;

/** `dom/03-click.html` — hộp xác nhận dùng chung của theme. Hủy Bỏ đứng TRƯỚC Mở Tất Cả. */
const CONFIRM_DIALOG = `
<div class="td-confirm-overlay active"><div class="td-confirm-dialog "><div class="td-confirm-header"><div class="td-confirm-icon "><i class="fas fa-gift"></i></div><h3 class="td-confirm-title">🧧 Mở Lì Xì Nhanh</h3></div><div class="td-confirm-body"><p class="td-confirm-message">Xác nhận mở tất cả lì xì hiện có?</p><div class="td-confirm-details "><ul><li>Mở tất cả lì xì đang có trong 1 lần</li><li>Hiển thị tổng hợp phần thưởng nhận được</li><li>Tiết kiệm thời gian cho VIP</li></ul></div></div><div class="td-confirm-buttons"><button class="td-confirm-btn td-confirm-btn-cancel "><i class="fas fa-times"></i> Hủy Bỏ </button><button class="td-confirm-btn td-confirm-btn-confirm "><i class="fas fa-check"></i> Mở Tất Cả </button></div></div></div>`;

/** `dom/04-click.html` — bảng kết quả, đúng con số 63 Tinh Thạch của bản ghi. */
const RESULT_MODAL = `
<div class="li-xi-result-modal active"><div class="li-xi-result-backdrop"></div><div class="li-xi-result-content"><div class="li-xi-result-header"><h3>🎉 Kết Quả Mở Lì Xì</h3><button class="li-xi-result-close"><i class="fas fa-times"></i></button></div><div class="li-xi-result-body"><p class="li-xi-result-message">Đã mở thành công 1 lì xì!</p><div class="li-xi-result-summary"><h4>🎊 Tổng Phần Thưởng Nhận Được:</h4><div class="li-xi-summary-grid"><div class="li-xi-summary-item"><span class="li-xi-summary-icon"><img class="hh3d-curr-icon" width="28" height="28"></span><span class="li-xi-summary-name">Tinh Thạch</span><span class="li-xi-summary-amount">63</span></div></div></div></div><div class="li-xi-result-footer"><button class="li-xi-result-ok-btn"><i class="fas fa-check"></i> Tuyệt Vời!</button></div></div></div>`;

const results: string[] = [];
const check = (name: string, ok: boolean, detail = "") => {
  results.push(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
};

type Condition = { kind?: string; selector?: string; text?: string };
type Step = {
  action: string;
  selector?: string;
  text?: string;
  script?: string;
  optional?: boolean;
  condition?: Condition;
  when?: Condition;
};

const profile = loadProfile();
const questOf = (id: string) =>
  profile.quests.find((q: { id: string }) => q.id === id) as { id: string; steps: Step[] } | undefined;

const vip = questOf(VIP_ID);
const free = questOf(FREE_ID);
if (!vip || !free) {
  console.error("✗ không thấy đủ hai bản Hỷ Sự Đường trong hồ sơ.");
  process.exit(1);
}

const steps = vip.steps ?? [];
// Móc theo Ý NGHĨA, không theo số thứ tự: chèn thêm một bước ở trên không được phép làm phép
// thử này lặng lẽ đo nhầm chỗ.
const scanStep = steps.find((s) => s.action === "evaluateJavaScript" && (s.script ?? "").includes("jvz-hy-su-quick"));
const clickBtn = steps.find((s) => s.action === "click" && (s.selector ?? "") === QUICK_BTN);
const confirmClick = steps.find((s) => s.action === "click" && (s.selector ?? "").includes("td-confirm-btn-confirm"));
const resultWait = steps.find(
  (s) =>
    s.action === "waitForCondition" &&
    (s.condition?.selector ?? "").includes("li-xi-result-modal") &&
    s.condition?.kind === "visible",
);
const verdictStep = steps.find(
  (s) => s.action === "evaluateJavaScript" && (s.script ?? "").includes("li-xi-result-message"),
);
const okClick = steps.find((s) => s.action === "click" && (s.selector ?? "").includes("li-xi-result-ok-btn"));

const browser = await chromium.launch({ headless: true, channel: "chromium" });
try {
  const page = await browser.newPage();
  await page.setContent('<!doctype html><html lang="vi"><body></body></html>');

  const render = (html: string) =>
    page.evaluate(
      ({ h }) => {
        document.body.className = "";
        document.body.innerHTML = h;
      },
      { h: html },
    );
  const ask = (condition: Condition) => page.evaluate(conditionProbe, condition);
  /** Chạy một script của hồ sơ qua ĐÚNG lớp bọc `session.evaluate` dùng lúc chạy thật. */
  const run = (src: string) =>
    page.evaluate(
      `(() => { const v = (${src}); return typeof v === "function" ? v() : v; })()`,
    ) as Promise<unknown>;
  const bodyHasMark = () => page.evaluate(() => document.body.classList.contains("jvz-hy-su-quick"));

  // ---- 1. Hồ sơ ĐANG SHIP có đủ cụm, và có ở CẢ HAI twin ---------------------------------
  {
    check("hồ sơ có bước dò nút", Boolean(scanStep));
    check("hồ sơ có bước bấm Mở Lì Xì Nhanh", Boolean(clickBtn), clickBtn?.selector ?? "KHÔNG CÓ");
    check("hồ sơ có bước bấm Mở Tất Cả", Boolean(confirmClick), confirmClick?.selector ?? "KHÔNG CÓ");
    check("hồ sơ có bước chờ bảng kết quả", Boolean(resultWait), resultWait?.condition?.selector ?? "KHÔNG CÓ");
    check("hồ sơ có bước phán xử bảng kết quả", Boolean(verdictStep));
    check("hồ sơ có bước đóng bảng kết quả", Boolean(okClick), okClick?.selector ?? "KHÔNG CÓ");

    // Luật của hồ sơ: hai twin giống nhau ở phần tri thức về site. Cụm này gác bằng cờ DOM nên
    // trên tài khoản thường nó nằm im — không có lý do gì để hai bản lệch nhau ở đây.
    const freeSteps = free.steps ?? [];
    const countQuick = (list: Step[]) =>
      list.filter((s) =>
        `${s.selector ?? ""} ${s.condition?.selector ?? ""} ${s.when?.selector ?? ""} ${s.script ?? ""}`.includes(
          "quick-open-li-xi",
        ),
      ).length;
    check(
      "bản thường mang ĐÚNG cùng số bước của cụm",
      countQuick(freeSteps) === countQuick(steps) && countQuick(steps) > 0,
      `vip ${countQuick(steps)} · thường ${countQuick(freeSteps)}`,
    );
  }

  // ---- 2. CHỖ ĐỨNG: cả cụm phải nằm TRƯỚC hai cổng StopIf ---------------------------------
  {
    const stopAt = steps.map((s, i) => (s.action === "stopIf" ? i : -1)).filter((i) => i >= 0);
    const clusterAt = [scanStep, clickBtn, confirmClick, resultWait, verdictStep, okClick]
      .map((s) => (s ? steps.indexOf(s) : -1))
      .filter((i) => i >= 0);
    check("hồ sơ có đúng hai cổng StopIf", stopAt.length === 2, `đếm được ${stopAt.length}`);
    const lastCluster = Math.max(...clusterAt);
    const firstStop = Math.min(...stopAt);
    check(
      "TOÀN BỘ cụm đứng trước cổng StopIf đầu tiên",
      lastCluster < firstStop,
      `bước cuối của cụm = ${lastCluster}, StopIf đầu = ${firstStop}`,
    );
    // Ngày "đã chúc hết" là ngày cổng thứ hai đóng lượt lại. Đóng đinh đúng cái cổng ấy.
    const doneGate = steps[stopAt[1]];
    check(
      "cổng thứ hai đúng là cổng『không còn phòng nào khớp bộ lọc』",
      (doneGate?.condition?.selector ?? "") === "body.jvz-hy-su-done",
      doneGate?.condition?.selector ?? "",
    );
    // Vét xong phải ĐẾM LẠI: cú "Mở Tất Cả" tự gọi lại show_all_wedding nên các dòng hồng bao
    // đã rụng, mà `until` của vòng lặp thì đọc chính cờ do bước đếm cắm.
    const tallyAt = steps
      .map((s, i) => ({ s, i }))
      .filter(({ s }) => s.action === "evaluateJavaScript" && (s.script ?? "").includes("jvz-hy-su-done"))
      .map(({ i }) => i);
    check(
      "có một bước đếm lại đứng SAU cụm và TRƯỚC cổng StopIf",
      tallyAt.some((i) => i > lastCluster && i < firstStop),
      `bước đếm ở ${tallyAt.join(", ")} · cụm kết ở ${lastCluster} · StopIf đầu ${firstStop}`,
    );
  }

  // ---- 3. Cờ trên body, không hỏi lại cái nút đã biến mất ---------------------------------
  {
    check("bước bấm nút gác bằng CỜ", (clickBtn?.when?.selector ?? "") === QUICK_MARK, clickBtn?.when?.selector ?? "KHÔNG CÓ");
    // Đây là phép thử của bẫy số 2: bất kỳ bước nào ĐỨNG SAU cú bấm mà lại hỏi chính cái nút
    // sẽ bị bỏ qua đúng ở ca thành công.
    const clickAt = steps.indexOf(clickBtn as Step);
    const afterAsksBtn = steps
      .slice(clickAt + 1)
      .filter((s) => (s.when?.selector ?? "").includes("quick-open-li-xi-btn"));
    check(
      "không bước nào SAU cú bấm hỏi lại chính cái nút",
      afterAsksBtn.length === 0,
      afterAsksBtn.map((s) => s.when?.selector).join(", "),
    );
  }

  // ---- 4. conditionProbe trên markup thật: hai hình dạng phải TRÁI NGƯỢC -------------------
  {
    await render(SECTION_OPEN);
    check("còn lì xì → nút hiện", (await ask({ kind: "visible", selector: QUICK_BTN })) === true);
    check(
      "còn lì xì → chưa có dòng『không có lì xì』",
      (await ask({ kind: "visible", selector: ".wedding-quick-li-xi-section .no-li-xi-status" })) === false,
    );

    await render(SECTION_DONE);
    check("mở hết → nút BIẾN MẤT (đây là bẫy số 2)", (await ask({ kind: "visible", selector: QUICK_BTN })) === false);
    check(
      "mở hết → hiện dòng『Không có lì xì nào chưa mở』",
      (await ask({ kind: "visible", selector: ".wedding-quick-li-xi-section .no-li-xi-status" })) === true,
    );
  }

  // ---- 5. Script dò ĐANG SHIP: cắm cờ đúng lúc, và chỉ đúng lúc ---------------------------
  {
    const src = scanStep?.script ?? "";
    await render(SECTION_OPEN);
    const said = String(await run(src));
    check("còn lì xì → script cắm cờ", await bodyHasMark(), said);
    check("…và kể ra con số đọc từ nhãn nút", said.startsWith("!") && said.includes("1 lì xì"), said);

    await render(SECTION_DONE);
    const saidDone = String(await run(src));
    check("mở hết → KHÔNG cắm cờ", (await bodyHasMark()) === false, saidDone);
    check("…và nói bằng dòng debug, không phải dòng lên Hoạt Động", !saidDone.startsWith("!"), saidDone);

    // Ca NGƯỢC: tài khoản thường vắng hẳn cụm nút. Không được cắm cờ, và cũng không được ném.
    await render('<div class="wedding-now-list"></div>');
    const saidFree = String(await run(src));
    check("vắng hẳn cụm nút → không cắm cờ, không ném", (await bodyHasMark()) === false && saidFree !== "undefined", saidFree);
  }

  // ---- 6. Hộp xác nhận: bấm ĐÚNG nút, Hủy Bỏ đứng trước (bẫy số 3) ------------------------
  {
    await render(SECTION_OPEN + CONFIRM_DIALOG);
    const sel = confirmClick?.selector ?? "";
    const hit = await page.evaluate((s) => {
      if (!s) return { count: 0, text: "", isCancel: false };
      const els = Array.from(document.querySelectorAll(s));
      return {
        count: els.length,
        text: els.length === 1 ? (els[0].textContent ?? "").replace(/\s+/g, " ").trim() : "",
        isCancel: els.some((e) => e.classList.contains("td-confirm-btn-cancel")),
      };
    }, sel);
    check("selector bấm khớp đúng MỘT phần tử", hit.count === 1, `đếm được ${hit.count}`);
    check("phần tử ấy là nút「Mở Tất Cả」", hit.text === "Mở Tất Cả", JSON.stringify(hit.text));
    check("và tuyệt đối không phải nút Hủy Bỏ", hit.isCancel === false);
    const first = await page.evaluate(() =>
      (document.querySelector(".td-confirm-btn")?.textContent ?? "").replace(/\s+/g, " ").trim(),
    );
    check(
      "nút ĐẦU TIÊN trong hộp vẫn là Hủy Bỏ — nên selector rút gọn là bấm nhầm",
      first === "Hủy Bỏ",
      JSON.stringify(first),
    );
  }

  // ---- 7. Bảng kết quả: phán xử đọc THẲNG con số, và ca trượt phải kêu --------------------
  {
    const src = verdictStep?.script ?? "";
    await render(SECTION_DONE + RESULT_MODAL);
    check("cửa chờ bảng kết quả mở trên markup thật", (await ask(resultWait?.condition ?? {})) === true);
    const said = String(await run(src));
    check("phán xử đọc đúng lời máy chủ", said.includes("Đã mở thành công 1 lì xì!"), said);
    check("…và kê đúng phần thưởng 63 Tinh Thạch", said.includes("63 Tinh Thạch"), said);
    check("…ở mức lên Hoạt Động", said.startsWith("!"), said);

    // Ca NGƯỢC: bấm xong mà không bảng nào lật ra. Phải KÊU chứ không được im.
    await render(SECTION_OPEN);
    const missed = String(await run(src));
    check("không có bảng kết quả → kêu TRƯỢT chứ không nhận vơ là xong", missed.startsWith("!") && missed.includes("TRƯỢT"), missed);

    // Nút đóng: bảng che kín modal sảnh, không đóng thì mọi bước sau mù.
    await render(SECTION_DONE + RESULT_MODAL);
    const okHit = await page.evaluate((s) => (s ? document.querySelectorAll(s).length : 0), okClick?.selector ?? "");
    check("selector nút「Tuyệt Vời!」khớp đúng một phần tử", okHit === 1, `đếm được ${okHit}`);
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
console.log(`\n✔ Mở Lì Xì Nhanh (Hỷ Sự Đường): ${results.length} phép thử thuận.`);
