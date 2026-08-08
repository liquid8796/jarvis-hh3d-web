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
    "ba nấc khớp đúng thứ tự và mơ hồ thì từ chối.",
);
