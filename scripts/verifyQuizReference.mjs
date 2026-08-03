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

console.log(
  `✔ nguồn thật HTTP ${response.status}; đã đọc ${entries.size} câu và resolver khớp đáp án theo text.`,
);
