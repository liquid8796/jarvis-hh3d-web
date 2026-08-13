#!/usr/bin/env node
/**
 * Kiểm chứng NHỊP QUÉT nhật ký đàn — phép số học đứng giữa cái núm hạn lưu và lượt xoá thật.
 *
 * Vì sao một hàm mười dòng lại đáng có phép thử riêng: nó vừa được sinh ra để vá đúng một lỗi
 * KHÔNG hề ném ra ngoại lệ nào. Trước 13/08/2026 nhịp quét là một hằng số — cron mỗi ngày một
 * lần — trong khi cái núm cho đặt hạn lưu tới tận 1 GIỜ. Không có gì đỏ lên, không dòng log nào
 * lạ; chỉ là hạn lưu ngắn hơn một ngày chưa bao giờ được thi hành, và trang admin phải viết hai
 * đoạn xin lỗi để che chỗ đó. Một lỗi lặng như thế chỉ có một cách canh: đóng đinh tính chất mà
 * nó vi phạm, rồi bắt mọi hạn lưu hợp lệ đi qua.
 *
 * TÍNH CHẤT ĐÓNG ĐINH — nhịp quét phải MỊN HƠN cái mốc nó thi hành, ở MỌI hạn lưu từ 1 giờ tới
 * 365 ngày. Đó chính là câu mà bản cũ trả lời "sai" cho 23 trong 24 giờ đầu của thang.
 *
 * Thuần số học, không chạm database — chạy được ở mọi máy, và chạy trong một nháy.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  JOB_EVENT_SWEEP_CLOCK_MINUTES,
  JOB_EVENT_SWEEP_MAX_INTERVAL_MS,
  JOB_EVENT_SWEEP_MIN_INTERVAL_MS,
  RETENTION_MAX_HOURS,
  RETENTION_MIN_HOURS,
  formatSweepInterval,
  jobEventSweepInterval,
} from "../src/lib/validation/retention";

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

/** Mọi hạn lưu hợp lệ — cả thang, không phải vài điểm nhặt tay. */
const EVERY_RETENTION = Array.from(
  { length: RETENTION_MAX_HOURS - RETENTION_MIN_HOURS + 1 },
  (_, i) => RETENTION_MIN_HOURS + i,
);

// ---- 1. TÍNH CHẤT: nhịp quét luôn mịn hơn hạn lưu -----------------------------------
for (const hours of EVERY_RETENTION) {
  const interval = jobEventSweepInterval(hours);
  assert(
    interval < hours * HOUR,
    `hạn lưu ${hours} giờ: nhịp quét ${interval}ms KHÔNG mịn hơn chính hạn lưu — đây đúng là lỗi ` +
      `bản cũ mắc phải (nhịp 24 giờ cho một mốc 1 giờ).`,
  );
  // Trần vượt hạn: một dòng sống lâu nhất là hạn lưu + một nhịp, và phần thừa phải ≤ 1/6 mốc.
  assert(
    interval <= (hours * HOUR) / 6 + 1,
    `hạn lưu ${hours} giờ: nhịp ${interval}ms vượt một phần sáu mốc — phần quá hạn không còn bị ràng.`,
  );
}
console.log(
  `✔ Cả thang ${RETENTION_MIN_HOURS}–${RETENTION_MAX_HOURS} giờ: nhịp quét luôn mịn hơn hạn lưu, ` +
    `và phần vượt hạn không quá một phần sáu mốc.`,
);

// ---- 2. Ba nấc người ta thật sự gõ --------------------------------------------------
assert(jobEventSweepInterval(1) === 10 * MINUTE, "hạn lưu 1 giờ → nhịp 10 phút");
assert(jobEventSweepInterval(6) === 1 * HOUR, "hạn lưu 6 giờ → nhịp 1 giờ");
assert(jobEventSweepInterval(24) === 4 * HOUR, "hạn lưu 1 ngày → nhịp 4 giờ");
assert(jobEventSweepInterval(24 * 7) === JOB_EVENT_SWEEP_MAX_INTERVAL_MS, "hạn lưu 7 ngày → chạm trần 6 giờ");
console.log("✔ Bốn nấc quen: 1 giờ → 10 phút, 6 giờ → 1 giờ, 1 ngày → 4 giờ, 7 ngày → 6 giờ.");

// ---- 3. Biên trên: trần cắt đúng chỗ, và cắt rồi vẫn giữ được tính chất -------------
assert(jobEventSweepInterval(36) === JOB_EVENT_SWEEP_MAX_INTERVAL_MS, "36 giờ là đúng điểm một phần sáu chạm trần");
assert(jobEventSweepInterval(35) < JOB_EVENT_SWEEP_MAX_INTERVAL_MS, "dưới 36 giờ thì trần chưa được phép cắt");
for (const hours of [36, 100, 24 * 365]) {
  assert(
    jobEventSweepInterval(hours) === JOB_EVENT_SWEEP_MAX_INTERVAL_MS,
    `hạn lưu ${hours} giờ phải bị trần giữ ở 6 giờ — nếu không, một hạn lưu 365 ngày kéo theo một ` +
      `câu xoá rỗng mỗi vài phút suốt năm`,
  );
}
console.log("✔ Trần 6 giờ: cắt từ đúng mốc 36 giờ trở lên, không sớm hơn một nấc nào.");

// ---- 4. Sàn: là hàng rào, KHÔNG phải một nấc gặp được ------------------------------
for (const hours of EVERY_RETENTION) {
  assert(
    jobEventSweepInterval(hours) > JOB_EVENT_SWEEP_MIN_INTERVAL_MS,
    `hạn lưu ${hours} giờ chạm tới sàn — sàn chỉ được dành cho con số hỏng, không cho đầu vào hợp lệ`,
  );
}
console.log("✔ Sàn 5 phút: không một hạn lưu hợp lệ nào chạm tới.");

// ---- 5. Đơn điệu: hạn lưu dài hơn không bao giờ cho nhịp dày hơn --------------------
let previous = 0;
for (const hours of EVERY_RETENTION) {
  const interval = jobEventSweepInterval(hours);
  assert(interval >= previous, `nhịp phải không giảm: ${hours} giờ cho ${interval}ms, sau ${previous}ms`);
  previous = interval;
}
console.log("✔ Đơn điệu: nới hạn lưu không bao giờ làm nhịp quét dày lên.");

// ---- 6. Con số hỏng: hàng rào chống VÒNG QUÉT KHÔNG NGHỈ ---------------------------
// NaN làm mọi phép so mốc thành false, tức cửa nhịp mở toang và mỗi lượt hỏi việc (5 giây một
// lần) kéo theo một câu xoá. Hỏng thì phải hỏng về phía THƯA NHẤT.
for (const bad of [NaN, Infinity, -Infinity]) {
  assert(
    jobEventSweepInterval(bad) === JOB_EVENT_SWEEP_MAX_INTERVAL_MS,
    `${bad} phải rơi về nhịp thưa nhất, không phải một nhịp NaN mở cửa cho vòng quét liên miên`,
  );
}
assert(jobEventSweepInterval(0) === JOB_EVENT_SWEEP_MIN_INTERVAL_MS, "0 giờ kẹp về sàn, không ra 0");
assert(jobEventSweepInterval(-5) === JOB_EVENT_SWEEP_MIN_INTERVAL_MS, "số âm kẹp về sàn, không ra số âm");
console.log("✔ Con số hỏng (NaN, vô cực, 0, âm): kẹp về biên, không nhịp nào ra số vô nghĩa.");

// ---- 7. Kể bằng chữ ----------------------------------------------------------------
assert(formatSweepInterval(10 * MINUTE) === "10 phút", "600000ms →「10 phút」");
assert(formatSweepInterval(4 * HOUR) === "4 giờ", "14400000ms →「4 giờ」");
assert(formatSweepInterval(90 * MINUTE) === "1 giờ 30 phút", "5400000ms →「1 giờ 30 phút」");
// Làm tròn phải xảy ra TRƯỚC khi tách giờ/phút, nếu không 59 phút 40 giây ra「0 giờ 60 phút」.
assert(formatSweepInterval(59 * MINUTE + 40 * 1000) === "1 giờ", "59 phút 40 giây phải tròn thành「1 giờ」");
assert(formatSweepInterval(0) === "1 phút", "0 không được kể thành「0 phút」— nhịp nhỏ nhất kể được là 1 phút");
for (const hours of EVERY_RETENTION) {
  const text = formatSweepInterval(jobEventSweepInterval(hours));
  assert(!text.startsWith("0 "), `hạn lưu ${hours} giờ kể ra một nhịp bắt đầu bằng số 0: "${text}"`);
}
console.log("✔ Kể bằng chữ: tròn trước rồi mới tách, không nhịp nào ra「0 giờ 60 phút」.");

// ---- 8. ĐỒNG HỒ NGOÀI: hằng số TypeScript phải khớp dòng cron trong YAML --------------
//
// Trang admin HỨA con số `JOB_EVENT_SWEEP_CLOCK_MINUTES` với trưởng môn, nhưng thứ thật sự gõ cửa
// là dòng `cron:` trong workflow. Hai bên không có cách nào tự ràng nhau — nên chỗ ràng là đây.
// Không có phép kiểm này thì đổi nhịp một bên là giao diện lặng lẽ nói dối, đúng loại lỗi mà cả
// bản vá 0.81.3 sinh ra để chấm dứt.
const repoRoot = path.join(import.meta.dirname, "..");
const workflowPath = path.join(repoRoot, ".github", "workflows", "quet-nhat-ky.yml");
assert(existsSync(workflowPath), `không thấy workflow đồng hồ quét: ${workflowPath}`);
const workflow = readFileSync(workflowPath, "utf8");

const cronLine = workflow.match(/-\s*cron:\s*"([^"]+)"/);
assert(cronLine, "workflow không có dòng `- cron: \"…\"` nào — đồng hồ đã bị gỡ mất?");
const expectedCron = `*/${JOB_EVENT_SWEEP_CLOCK_MINUTES} * * * *`;
assert(
  cronLine![1] === expectedCron,
  `lệch nhịp: YAML chạy「${cronLine![1]}」còn giao diện hứa「${expectedCron}」` +
    `(JOB_EVENT_SWEEP_CLOCK_MINUTES = ${JOB_EVENT_SWEEP_CLOCK_MINUTES}). Sửa cả hai nơi.`,
);
console.log(`✔ Đồng hồ ngoài: YAML và hằng số cùng nói「${expectedCron}」.`);

// Đường mà workflow gõ phải có một route thật đứng sau — đổi tên thư mục route mà quên YAML thì
// mỗi 10 phút một lượt 404, và không ai được báo vì cửa quét vốn im lặng khi thuận.
const sweepPath = workflow.match(/SWEEP_PATH="([^"]+)"/);
assert(sweepPath, "workflow không khai `SWEEP_PATH` — không biết nó đang gõ cửa nào");
const routeFile = path.join(repoRoot, "src", "app", ...sweepPath![1].split("/").filter(Boolean), "route.ts");
assert(
  existsSync(routeFile),
  `workflow gõ cửa「${sweepPath![1]}」nhưng không có route nào ở đó (${routeFile})`,
);
console.log(`✔ Cửa quét「${sweepPath![1]}」có route thật đứng sau.`);

console.log("");
console.log("TẤT CẢ XANH — nhịp quét mịn hơn hạn lưu ở mọi nấc, và hỏng thì hỏng về phía thưa.");
