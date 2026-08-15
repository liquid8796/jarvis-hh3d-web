#!/usr/bin/env node
/**
 * Kiểm chứng SUẤT LINH QUANG PHÙ — một lá mỗi ngày cho mỗi đàn, và cái sổ giữ lời hứa ấy.
 *
 * Vì sao đáng có lưới riêng: cổng cũ nằm trong một khoá `localStorage`, mà `localStorage` thuộc
 * về MỘT hồ sơ trình duyệt trên MỘT máy — còn đàn thì nhảy giữa các khôi lỗi. Đo trên đàn
 * 7cf87cfb ngày 15/08/2026: mua 17:10, chặn đúng ở 17:30 và 17:58, rồi MUA LẦN HAI lúc 18:08 khi
 * vòng ấy rơi vào một khôi lỗi khác với hồ sơ trắng. Mỗi lá là tiền thật.
 *
 * Sổ mới là `automation_jobs.daily_done` — server phát ở mỗi lượt claim, khôi lỗi trả lại ở cuối
 * vòng. Ba mối nối phải khớp nhau, và cả ba đều là loại trôi trong im lặng:
 *
 *   1. HỒ SƠ ↔ MÃ  — chuỗi dấu nằm trong script của hồ sơ quest (một tệp JSON) phải trùng hằng
 *      số `PHU_DAILY_MARK` trong mã. Không ai bắt được lúc chúng lệch, và lúc ấy dấu chỉ đơn
 *      giản là không bao giờ được ghi.
 *   2. ENGINE      — dòng `@…` phải thành DẤU, không phải một dòng số liệu.
 *   3. DỊCH CẤU HÌNH — có dấu trong sổ thì tuỳ chọn mua phù phải bị ép TẮT.
 *
 * Thuần và không cần database: cùng lối với `verify:queue-pools`.
 */
import { readFileSync } from "node:fs";
import { createQuestEngine } from "../src/lib/quest-engine/engine.mjs";
import { PHU_DAILY_MARK, profileForConfig } from "../src/lib/quest-engine/profile.mjs";

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};

let checks = 0;
const check = (label: string, condition: unknown, detail = "") => {
  assert(condition, `${label}${detail ? ` — ${detail}` : ""}`);
  checks++;
  console.log(`  ✓ ${label}`);
};

console.log("Suất Linh Quang Phù — một lá mỗi ngày, ghi ở sổ của ĐÀN chứ không ở máy\n");

// ---- 1. Hồ sơ quest mang đúng chuỗi dấu mà mã đang chờ ---------------------------------------
type Step = { action?: string; script?: string; when?: { selector?: string } };
type Quest = { id: string; steps?: Step[] };

const profileJson = JSON.parse(
  readFileSync(new URL("../src/lib/quest-engine/profile.json", import.meta.url), "utf8"),
) as { quests: Quest[] };

const MARK_LINE = `@${PHU_DAILY_MARK}`;
/**
 * Cờ canh MỌI bước tiêu tiền: quyết định của lượt NÀY, VÀ cái dấu trên đúng nút món hàng.
 * Chỉ canh bằng dấu trên nút là chưa đủ — TIỆM là một tab, không phải một lượt điều hướng, nên
 * dấu của lượt trước còn nguyên ở lượt sau (bộ chạy thử 15/08/2026 bắt được đúng cảnh ấy).
 */
const BUY_WHEN = "body.jvz-km-buy-now .jvz-km-buy";
const twins = profileJson.quests.filter((q) => q.id === "khoang-mach" || q.id === "khoang-mach-thuong");
check("hồ sơ có ĐỦ HAI bản Khoáng Mạch (VIP + thường)", twins.length === 2, twins.map((q) => q.id).join(","));

for (const quest of twins) {
  const steps = quest.steps ?? [];
  const markSteps = steps.filter((s) => s.action === "evaluateJavaScript" && s.script?.includes(MARK_LINE));
  check(`${quest.id}: có ĐÚNG MỘT bước ghi dấu「${MARK_LINE}」`, markSteps.length === 1, `thấy ${markSteps.length}`);

  // Dấu phải đi CÙNG CỜ với chính cú bấm mua: cùng một `when` nghĩa là không có đường nào ghi
  // dấu mà chưa đi qua tiệm, và cũng không có đường nào mua mà quên ghi dấu.
  const buyClick = steps.find((s) => s.action === "click" && s.when?.selector === BUY_WHEN);
  check(
    `${quest.id}: bước ghi dấu dùng cùng cờ với cú bấm mua (${BUY_WHEN})`,
    buyClick != null && markSteps[0]?.when?.selector === BUY_WHEN,
    `dấu=${markSteps[0]?.when?.selector} · mua=${buyClick?.when?.selector}`,
  );

  // Và nó phải đứng SAU cú bấm xác nhận: ghi trước là ghi cho một việc chưa xảy ra.
  const confirmAt = steps.findIndex((s) => s.action === "click" && String(s["selector" as keyof Step] ?? "").includes("swal2-confirm"));
  const markAt = steps.indexOf(markSteps[0]);
  check(`${quest.id}: dấu đứng SAU cú bấm xác nhận mua`, confirmAt >= 0 && markAt > confirmAt, `xác nhận=${confirmAt} · dấu=${markAt}`);
}

// ---- 2. Engine đọc dòng `@…` thành DẤU, không thành số liệu ----------------------------------
{
  const lines: string[] = [];
  const engine = createQuestEngine({
    log: {
      info: (_scope: string, m: string) => lines.push(`info:${m}`),
      debug: (_scope: string, m: string) => lines.push(`debug:${m}`),
      warning: (_scope: string, m: string) => lines.push(`warn:${m}`),
    },
  });

  /** Session giả: chỉ cần trả lời đúng một phép `evaluate` — bước duy nhất của quest dưới đây. */
  const sessionReturning = (value: string) => ({ evaluate: async () => value });
  const questWith = (script: string) => ({
    id: "thu-nghiem",
    name: "Thử Nghiệm",
    kind: "customSteps",
    enabled: true,
    steps: [{ action: "evaluateJavaScript", script }],
  });

  const marked = await engine.run(
    sessionReturning(`!kể chuyện cho người đọc\n${MARK_LINE}`),
    profileJson,
    questWith("() => ''"),
  );
  check(
    "dòng `@…` thành dấu ngày, và câu tường thuật đi cùng vẫn được kể",
    JSON.stringify(marked.dailyMarks) === JSON.stringify([PHU_DAILY_MARK]) &&
      lines.some((l) => l === "info:kể chuyện cho người đọc"),
    JSON.stringify({ marks: marked.dailyMarks, lines }),
  );

  const plain = await engine.run(sessionReturning("shop: không thấy món nào"), profileJson, questWith("() => ''"));
  check("dòng thường KHÔNG thành dấu", plain.dailyMarks === undefined, JSON.stringify(plain.dailyMarks));

  const empty = await engine.run(sessionReturning("@"), profileJson, questWith("() => ''"));
  check("dấu RỖNG bị vứt, không ghi một chuỗi rỗng vào sổ", empty.dailyMarks === undefined, JSON.stringify(empty.dailyMarks));
}

// ---- 3. Có dấu trong sổ → tuỳ chọn mua phù bị ép TẮT -----------------------------------------
{
  const configWith = (buyPhu: boolean) => ({
    quests: {
      khoangMach: { enabled: true, mineType: "2", mineName: "", minBonus: 0, buyPhu, hostMode: false, hostMinBonus: 100 },
      khoangMachThuong: { enabled: true, mineType: "2", mineName: "", minBonus: 0, buyPhu, hostMode: false, hostMinBonus: 100 },
    },
  });
  /**
   * Giá trị đang chọn nằm ở `selectedValue`, KHÔNG phải `value` — `value` là của từng lựa chọn
   * trong `choices`. Bản đầu của lưới này đọc nhầm sang `value`, và cái giá là mọi khẳng định
   * đều xanh trong khi chẳng đo gì: `"".includes("«")` là `false`, nên「chưa tắt」luôn đúng.
   * Ca「sổ trắng thì phải BẬT」bên dưới chính là thứ đã bắt được nó.
   */
  const phuValueOf = (
    profile: { quests: Array<{ id: string; options?: Array<{ key: string; selectedValue?: string }> }> },
    id: string,
  ) => profile.quests.find((q) => q.id === id)?.options?.find((o) => o.key === "buyPhu")?.selectedValue ?? "";
  const isOff = (value: string) => value.includes("«");
  const isOn = (value: string) => value.length > 0 && !value.includes("«");

  const fresh = profileForConfig(configWith(true), undefined, []);
  check(
    "sổ trắng + người dùng bật → mua phù BẬT (bằng không lưới này vô nghĩa)",
    isOn(phuValueOf(fresh, "khoang-mach")) && isOn(phuValueOf(fresh, "khoang-mach-thuong")),
    phuValueOf(fresh, "khoang-mach"),
  );

  const spent = profileForConfig(configWith(true), undefined, [PHU_DAILY_MARK]);
  check(
    "sổ đã có dấu → ép TẮT ở CẢ HAI bản, dù người dùng vẫn bật",
    isOff(phuValueOf(spent, "khoang-mach")) && isOff(phuValueOf(spent, "khoang-mach-thuong")),
    `${phuValueOf(spent, "khoang-mach")} · ${phuValueOf(spent, "khoang-mach-thuong")}`,
  );

  const spentFromSet = profileForConfig(configWith(true), undefined, new Set([PHU_DAILY_MARK]));
  check("nhận cả Set lẫn mảng — runCycle đưa xuống mảng của sổ", isOff(phuValueOf(spentFromSet, "khoang-mach")));

  const userOff = profileForConfig(configWith(false), undefined, []);
  check("người dùng tắt → vẫn tắt, sổ không có quyền bật hộ", isOff(phuValueOf(userOff, "khoang-mach")));

  // Dấu của một việc KHÁC không được đụng tới phù — sổ dùng chung với「nhiệm vụ đã đủ lượt」.
  const otherMark = profileForConfig(configWith(true), undefined, ["diem-danh", "khoang-mach"]);
  check(
    "dấu lạ (kể cả ID nhiệm vụ trùng tên quest) KHÔNG tắt nhầm mua phù",
    isOn(phuValueOf(otherMark, "khoang-mach")),
    phuValueOf(otherMark, "khoang-mach"),
  );
}

// ---- 4. Mắt xích cuối: runCycle chở dấu ra dây --------------------------------------------
// Đọc THẲNG mã nguồn, cùng lối smoke đang dùng cho ranh giới engine↔route: khúc này chỉ chạy
// được khi có cả trình duyệt lẫn một site giả biết diễn trọn màn khoáng mạch, mà thứ cần canh
// lại chỉ là hai câu nối. Một lưới rẻ đứng đúng chỗ hơn là không có lưới nào.
{
  const runCycleSrc = readFileSync(new URL("../src/lib/quest-engine/runCycle.mjs", import.meta.url), "utf8");
  check(
    "runCycle đổ dấu của nhiệm vụ vào cùng lời khai với「đã đủ lượt」",
    /for \(const mark of outcome\.dailyMarks \?\? \[\]\)/.test(runCycleSrc) &&
      /cappedToday\.push\(mark\)/.test(runCycleSrc),
  );
  check(
    "runCycle đưa sổ ngày xuống phép dịch cấu hình — bằng không dấu ghi rồi cũng không ai đọc",
    // Không dùng `[^)]*`: chính lời gọi ấy có một arrow function nên đã có `)` nằm giữa đường.
    /profileForConfig\(.*dailyDone\?\.questIds\)/.test(runCycleSrc),
  );
}

// ---- 5. MUA CHỈ SAU KHI ĐOẠT THÀNH — thứ tự bước và cờ canh cửa ------------------------------
// Đổi ngày 15/08/2026 theo yêu cầu của tông chủ: phù sống 1 giờ và phục vụ cú chốt lời trên mỏ
// VỪA ĐOẠT ĐƯỢC, nên mua trước khi biết có đoạt nổi hay không là đốt tiền. Đo 15/08: 17:10 mua
// một lá trong đúng một lượt「không đoạt: bonus 44% dưới ngưỡng 50%」.
for (const quest of twins) {
  const steps = (quest.steps ?? []) as Array<Step & { selector?: string }>;
  const whenOf = (s: Step) => s.when?.selector ?? "";

  const buyNow = steps.filter((s) => whenOf(s) === "body.jvz-km-buy-now");
  check(`${quest.id}: cụm mua canh bằng cờ jvz-km-buy-now`, buyNow.length >= 4, `${buyNow.length} bước`);
  check(
    `${quest.id}: KHÔNG còn bước nào chạy theo cờ cũ jvz-km-buy-go`,
    steps.every((s) => whenOf(s) !== "body.jvz-km-buy-go"),
  );

  // Cửa mua phải nằm SAU cú bấm xác nhận đoạt — bằng không "sau khi đoạt" chỉ là lời nói.
  const doatConfirmAt = steps.findIndex(
    (s) => s.action === "click" && whenOf(s) === ".jvz-km-doat" && String(s.selector ?? "").includes("swal2-confirm"),
  );
  check(
    `${quest.id}: mọi bước TIÊU TIỀN đòi cả cờ quyết định lẫn dấu trên nút`,
    steps.filter((s) => String(s.selector ?? "") === ".jvz-km-buy" || s.script?.includes(MARK_LINE))
      .every((s) => whenOf(s) === BUY_WHEN),
  );
  const firstBuyAt = steps.indexOf(buyNow[0]);
  check(
    `${quest.id}: mọi bước mua đứng SAU cú bấm xác nhận đoạt`,
    doatConfirmAt >= 0 && firstBuyAt > doatConfirmAt,
    `xác nhận đoạt=${doatConfirmAt} · mua đầu tiên=${firstBuyAt}`,
  );

  // Cờ mua là cờ THUẬN: đúng một script cắm nó, và script ấy đòi chính lời xác nhận của trang.
  const setters = steps.filter((s) => s.script?.includes("classList.add('jvz-km-buy-now')"));
  check(`${quest.id}: đúng MỘT script cắm cờ mua`, setters.length === 1, `thấy ${setters.length}`);
  const won = setters[0]?.script ?? "";
  check(
    `${quest.id}: script ấy đòi trang xác nhận「đoạt thành công」VÀ phù còn suất`,
    won.includes("doat thanh cong") && won.includes("jvz-km-buy-go"),
  );
  // Phép đọc văn bản toàn trang có thể ăn phải câu của lượt TRƯỚC — bộ chạy thử 15/08 đã dựng
  // đúng cảnh ấy. Nên trước khi mừng, phải hỏi một sự thật không thể cũ: lượt NÀY có bấm nút
  // Đoạt Mỏ nào không (jvz-km-host-go do KmHostScanScript cắm khi tìm thấy nút).
  check(
    `${quest.id}: …và đòi lượt NÀY thật sự có nút Đoạt Mỏ để bấm`,
    won.includes("jvz-km-host-go"),
  );
  check(
    `${quest.id}: script ấy tự gỡ cờ trước khi xét — không ăn theo cờ cũ còn sót`,
    won.includes("classList.remove('jvz-km-buy-now')"),
  );

  // Suất của ngày phải tiêu LÚC MUA, không tiêu ở cổng: đoạt trượt thì không được đốt suất.
  const gate = steps.find((s) => s.script?.includes("jvz-km-ripe") && s.script?.includes("{{hostMode}}"));
  check(
    `${quest.id}: cổng KHÔNG còn ghi localStorage — nó chỉ đọc suất, không tiêu`,
    gate != null && gate.script!.includes("localStorage.getItem") && !gate.script!.includes("localStorage.setItem"),
  );
  const markStep = steps.find((s) => s.script?.includes(MARK_LINE));
  check(
    `${quest.id}: bước ghi dấu tiêu CẢ HAI sổ — localStorage của máy và dấu ngày của đàn`,
    markStep != null && markStep.script!.includes("localStorage.setItem('__jvz_km_phu'"),
  );
}

console.log(`\n✔ Suất Linh Quang Phù: ${checks} khẳng định, tất cả đứng vững.`);
