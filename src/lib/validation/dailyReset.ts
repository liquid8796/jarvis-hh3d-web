/**
 * LUẬT của lượt reset sang ngày mới — thuần, không chạm database, không đọc đồng hồ hệ thống.
 *
 * Tách ra khỏi `services/jobs.ts` vì cùng một lẽ với `dispatch.ts` và `queueAssign.ts`: đây là
 * một phép QUYẾT ĐỊNH, và sai một nhánh ở đây thì hoặc cả tông môn bị cắt ngang giữa lúc đang
 * cày (chạy khi không nên), hoặc mốc nửa đêm trôi qua trong im lặng suốt nhiều tuần mà không ai
 * nhận ra (không chạy khi nên). Cả hai kiểu hỏng đều KHÔNG kêu một tiếng nào — nên chúng cần một
 * lưới đọc thẳng được luật, chạy không cần database, không cần chờ tới nửa đêm để biết.
 *
 * Mốc là 00:00:00 giờ VIỆT NAM, không phải giờ máy chủ: máy chủ chạy UTC, và mốc reset lượt ngày
 * của trang game theo giờ Việt Nam. Một hằng số `TZ` trên VM là thứ có ngày ai đó đổi.
 */

/** Lệch giờ Việt Nam so với UTC. Cùng gốc với `vietnamDayKey` bên services/jobs.ts. */
const VIETNAM_UTC_OFFSET_MS = 7 * 60 * 60 * 1000;

/** Ngày theo giờ Việt Nam, dạng `YYYY-MM-DD`. */
export function vietnamDay(at: Date): string {
  return new Date(at.getTime() + VIETNAM_UTC_OFFSET_MS).toISOString().slice(0, 10);
}

export type DailyResetVerdict =
  | { run: true; day: string }
  | { run: false; why: string };

/**
 * Lượt cron này có phải chạy reset không.
 *
 * Ba cửa, theo đúng thứ tự rẻ-trước:
 *
 *   1. Công tắc TẮT → thôi. Đây là luật cắt ngang việc đang chạy; nó không được phép tự bật.
 *   2. Đã chạy cho ngày hôm nay rồi → thôi. Nhịp cron dày hơn nhịp ngày (lịch mỗi giờ vẫn gõ
 *      cửa), nên nếu không có cửa này thì đàn nào cũng bị cắt ngang mỗi giờ — biến một luật
 *      「mỗi ngày một lần」thành một cái máy nghiền.
 *   3. Còn lại: chạy, và đóng dấu NGÀY HÔM NAY.
 *
 * KHÔNG có cửa「phải đúng 00:00」. Đó là chủ ý, và là phần quan trọng nhất của hàm này: nếu đòi
 * lượt cron rơi trúng phút nửa đêm thì một lần máy chủ nằm im lúc ấy — trùng tu, mất điện, một
 * lượt phát hành dài — là mất trọn lượt reset của ngày hôm đó, im lặng. Đóng dấu theo NGÀY thì
 * lượt cron kế tiếp trong ngày tự làm nốt phần việc bị lỡ. Cái giá phải trả là lượt bù ấy tới
 * muộn hơn nửa đêm; đổi lại nó không bao giờ mất hẳn.
 *
 * @param at        thời điểm đang xét
 * @param enabled   công tắc trong trang Tông Môn
 * @param lastRunDay ngày (giờ VN) của lượt reset gần nhất, `null` nếu chưa từng chạy
 */
export function reviewDailyReset(
  at: Date,
  enabled: boolean,
  lastRunDay: string | null,
): DailyResetVerdict {
  if (!enabled) {
    return { run: false, why: "Tông môn chưa bật luật sang ngày mới thì chạy lại." };
  }
  const day = vietnamDay(at);
  if (lastRunDay === day) {
    return { run: false, why: `Hôm nay (${day}) đã chạy lượt sang ngày mới rồi.` };
  }
  return { run: true, day };
}
