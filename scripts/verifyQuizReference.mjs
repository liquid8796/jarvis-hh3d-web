#!/usr/bin/env node
/**
 * Kiểm nguồn Vấn Đáp thật mà PC và web cùng dùng.
 *
 * Smoke dùng HTML cố định để hồi quy không phụ thuộc Internet; script này bổ sung nửa còn lại:
 * URL cộng đồng hôm nay vẫn tải được, vẫn có hình bảng mà parser hiểu, và resolver chọn được
 * đáp án từ chính dữ liệu vừa tải. Không gửi một câu hỏi game nào lên trang — chỉ tải cả bảng.
 */

import {
  createQuizReferenceDirectory,
  DEFAULT_QUIZ_REFERENCE_URL,
  parseQuizReferenceHtml,
} from "../src/lib/quest-engine/quizReference.mjs";

/** Resolver kể lý do ở mức warning; phép thử này cố ý bịt lại để bản kê sạch. */
const SILENT_LOG = { debug() {}, info() {}, warning() {} };

const response = await fetch(DEFAULT_QUIZ_REFERENCE_URL, {
  signal: AbortSignal.timeout(20_000),
  headers: { "user-agent": "JarvisHH3D-Worker/quiz-reference-verifier" },
});
if (!response.ok) throw new Error(`Nguồn tham khảo trả HTTP ${response.status}.`);

const html = await response.text();
const entries = parseQuizReferenceHtml(html);
if (entries.size < 200) {
  throw new Error(`Parser chỉ đọc được ${entries.size} câu — cấu trúc nguồn có thể đã đổi.`);
}

// Hình dạng làm regex cũ đọc 0 dòng: thẻ có thuộc tính và ô câu hỏi thiếu `</td>`. Trang thật
// hiện cũng có vài hàng thiếu thẻ đóng, nên đây không phải HTML bịa để thử một khả năng xa xôi.
const malformed = parseQuizReferenceHtml(`
  <table><tbody>
    <tr class="qa-row" data-id="129">
      <td class="id">129</td>
      <td data-field="question">Vũ hồn thứ hai của Đường Tam là gì?
      <td data-field="answer">2. Hạo Thiên Chùy</td>
    </tr>
  </tbody></table>
`);
if (malformed.size !== 1 || malformed.values().next().value?.[0] !== "Hạo Thiên Chùy") {
  throw new Error(`Parser không chịu được hàng HTML thiếu thẻ đóng/có thuộc tính: ${JSON.stringify([...malformed])}.`);
}

const candidate = [...entries].find(([, answers]) => answers.length === 1 && answers[0]?.trim());
if (!candidate) throw new Error("Không tìm được một câu có đúng một đáp án để kiểm resolver.");

const [questionKey, answers] = candidate;
const expected = answers[0];
const directory = createQuizReferenceDirectory({
  fetchImpl: async () => ({ ok: true, status: 200, text: async () => html }),
});
const resolved = await directory.find(
  {
    text: questionKey,
    options: ["__nhiễu_a__", expected, "__nhiễu_b__", "__nhiễu_c__"],
  },
  { url: DEFAULT_QUIZ_REFERENCE_URL },
);

if (resolved?.option !== expected || resolved.index !== 1) {
  throw new Error(`Resolver không chọn lại được đáp án từ nguồn thật: ${JSON.stringify(resolved)}.`);
}

// Đóng đinh đúng câu trong ảnh báo lỗi, trên chính nguồn đang sống.
const reportedQuestion = await directory.find(
  {
    text: "Vũ hồn thứ hai của Đường Tam là gì?",
    options: ["Lam Ngân Thảo", "Nhu Cốt Thỏ", "Hạo Thiên Chùy", "Thất Bảo Lưu Ly Tháp"],
  },
  { url: DEFAULT_QUIZ_REFERENCE_URL, log: SILENT_LOG },
);
if (reportedQuestion?.option !== "Hạo Thiên Chùy") {
  throw new Error(`Câu trong ảnh chưa được giải đúng từ nguồn thật: ${JSON.stringify(reportedQuestion)}.`);
}

// HTTP 200 nhưng không có bảng từng xảy ra trong production. Directory phải thử tải lại ngay,
// thay vì cache thất bại rồi bỏ trắng cả bài Vấn Đáp của lượt ấy.
let retryCalls = 0;
const retryDirectory = createQuizReferenceDirectory({
  fetchImpl: async () => ({
    ok: true,
    status: 200,
    text: async () => (++retryCalls === 1 ? "<html><body>tạm thời chưa có bảng</body></html>" : html),
  }),
});
const retried = await retryDirectory.find(
  {
    text: "Vũ hồn thứ hai của Đường Tam là gì?",
    options: ["Lam Ngân Thảo", "Hạo Thiên Chùy"],
  },
  { url: DEFAULT_QUIZ_REFERENCE_URL, log: SILENT_LOG },
);
if (retryCalls !== 2 || retried?.option !== "Hạo Thiên Chùy") {
  throw new Error(`Nguồn rỗng tạm thời chưa được thử lại đúng: calls=${retryCalls}, result=${JSON.stringify(retried)}.`);
}

// ---------------------------------------------------------------------------
// Ba nấc khớp đáp án — đóng đinh trên nguồn THẬT.
//
// Nấc 3 (một bên chứa trọn bên kia) sinh ra từ một ca có thật ngày 09/08/2026: trang bày
// “Tất cả đáp án”, danh sách ghi “Tất cả đáp án trên (…)”. Nó là câu SỐ MỘT của bài, nên
// hai nấc đầu trượt là cả bài vấn đáp của tài khoản VIP chết đứng ở mọi lượt.
//
// Ba phép dưới đây gác đúng ranh giới giữa "nới đủ để khớp" và "đoán bừa" — trả lời sai
// tiêu một lượt trong ngày, nên mơ hồ thì phải TỪ CHỐI.
// ---------------------------------------------------------------------------
const NOISE = ["Vũ Động Càn Khôn", "Đại Chúa Tể", "Đấu Phá Thương Khung"];
const lookup = (text, options) =>
  directory.find({ text, options }, { url: DEFAULT_QUIZ_REFERENCE_URL, log: SILENT_LOG });

const nestedKey = [...entries].find(
  ([, answers]) => answers.length === 1 && / \([^)]*\)\s*$/.test(answers[0] ?? ""),
)?.[0];
if (!nestedKey) throw new Error("Nguồn không còn câu nào có đáp án kèm ghi chú để kiểm nấc 2/3.");

const published = entries.get(nestedKey)[0];
const trimmed = published.replace(/\s*\([^)]*\)\s*$/, "").trim();
const shortened = trimmed.split(" ").slice(0, -1).join(" "); // bỏ chữ cuối, đúng hình dạng ca thật

const cases = [
  ["nấc 1 — khớp tuyệt đối", published, published],
  ["nấc 2 — bỏ ghi chú cuối", trimmed, trimmed],
  ["nấc 3 — trang viết ngắn hơn danh sách", shortened, shortened],
];
for (const [label, option, want] of cases) {
  const got = await lookup(nestedKey, [...NOISE, option]);
  if (got?.option !== want) {
    throw new Error(`${label}: đáng lẽ chọn ${JSON.stringify(want)}, nhận ${JSON.stringify(got)}.`);
  }
}

// Mơ hồ ở nấc 3 (hai lựa chọn cùng nằm trong đáp án, không cái nào khớp tuyệt đối) → TỪ CHỐI.
const ambiguous = await lookup(nestedKey, [...NOISE.slice(0, 2), shortened, trimmed.split(" ").slice(1).join(" ")]);
if (ambiguous !== null) {
  throw new Error(`Hai lựa chọn cùng khớp thì phải từ chối, nhận ${JSON.stringify(ambiguous)}.`);
}

// Lựa chọn trơ trọi một ký tự KHÔNG được chui vào giữa từ.
if ((await lookup(nestedKey, ["A", "B", "C", "D"])) !== null) {
  throw new Error("Lựa chọn một ký tự không được khớp bừa vào giữa từ.");
}

console.log(
  `✔ nguồn thật HTTP ${response.status}; đã đọc ${entries.size} câu, resolver khớp đáp án theo text, ` +
    "hàng HTML lỗi vẫn đọc được, phản hồi rỗng được thử lại, và câu trong ảnh ra Hạo Thiên Chùy.",
);
