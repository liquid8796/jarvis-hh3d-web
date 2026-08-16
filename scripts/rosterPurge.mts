/**
 * VÒNG CANH SỔ ĐIỂM DANH — phần chạm database và đồng hồ. Luật thì ở `judgeRosterPurge`
 * (`githubKhoiloi.mts`, thuần); tệp này chỉ hỏi database, đếm giờ, và thi hành từng phán quyết.
 *
 * VÌ SAO TÁCH RA KHỎI `removeGithubKhoiloi.mts`: tệp bên ấy gọi `main()` ngay khi được nhập, nên
 * mọi thứ sống trong nó là thứ KHÔNG phép kiểm nào với tới được — nhập vào để thử một hàm là khởi
 * động luôn một công cụ xoá kho. Mà đúng cái đoạn dây này mới là chỗ chưa ai chạy thử: luật đã có
 * đồng hồ giả lái qua từng nhánh, còn phép ghi sổ `lastBeat` và phép cộng hai quãng đo bằng hai
 * đồng hồ thì chưa. `verify:roster-purge` nhập tệp này và chạy nó trên một database thật.
 *
 * `log`/`warn` truyền vào được vì cùng một lẽ: phép kiểm cần ĐỌC được lượt tường thuật, chứ không
 * chỉ đọc kết quả. Dòng「↺ nó vừa tự ghi lại tên」là thứ duy nhất kể cho người vận hành biết vòng
 * canh vừa cứu họ khỏi một dòng ma — nó im lặng thì tính năng này trở lại thành vô hình.
 */
import { sqlTag } from "./pgTag.mjs";
import { judgeRosterPurge, PRODUCTION_TIMING, type PurgeTiming } from "./githubKhoiloi.mts";

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export type PurgeReport = {
  /**
   * `settled` — sổ sạch và chịu nằm im. `giveup` — hết ngân sách mà dòng vẫn mọc lại.
   * `error` — database không trả lời; kho và sổ thì đã xong từ trước nên đây KHÔNG phải thất bại
   * của cả lượt dọn, chỉ là một dòng có thể còn sót.
   */
  outcome: "settled" | "giveup" | "error";
  /** Số câu DELETE đã chạy. 0 = chưa từng thấy dòng nào. */
  purges: number;
  /** Số lần dòng mọc lại SAU một lượt xoá — con số kể đúng chuyện ngày 13/08/2026. */
  resurrections: number;
  elapsedMs: number;
};

/**
 * Gỡ dòng điểm danh, rồi canh cho tới khi nó chịu nằm im.
 *
 * KHÔNG NÉM, DÙ HỎNG THẾ NÀO. Kho và sổ — hai thứ có hậu quả thật — đã xong trước khi tới đây, và
 * một dòng `workers` sót lại chỉ gây đúng hai phiền phức nhỏ: một dòng ma trong tab Khôi Lỗi, và
 * `github:new` từ chối dựng lại một khôi lỗi TRÙNG ID (mà id thì mang mốc thời gian, nên trùng gần
 * như không xảy ra). Nói ra rồi đi tiếp thì đúng hơn là ném ở dòng cuối cùng của một công cụ xoá —
 * người vận hành đọc một stack trace ở đó sẽ tưởng cả lượt dọn đã hỏng.
 *
 * `automation_jobs.worker_id` KHÔNG có khoá ngoại trỏ vào bảng này (cột text trơn), nên xoá ở đây
 * không đụng tới một dòng đàn nào — lịch sử vẫn giữ nguyên tên máy đã cày nó.
 */
export async function purgeRosterRow(input: {
  activePg: string;
  workerId: string;
  timing?: PurgeTiming;
  log?: (line: string) => void;
  warn?: (line: string) => void;
}): Promise<PurgeReport> {
  const { activePg, workerId } = input;
  const timing = input.timing ?? PRODUCTION_TIMING;
  const log = input.log ?? ((line: string) => console.log(line));
  const warn = input.warn ?? ((line: string) => console.warn(line));

  const sql = sqlTag(activePg);
  const startedAt = Date.now();
  /** Quãng im do CHÍNH database đo, kèm mốc cục bộ lúc đo. `null` = chưa lượt soi nào thấy dòng. */
  let lastBeat: { quietMs: number; measuredAt: number } | null = null;
  let purges = 0;
  let resurrections = 0;
  const done = (outcome: PurgeReport["outcome"]): PurgeReport => ({
    outcome,
    purges,
    resurrections,
    elapsedMs: Date.now() - startedAt,
  });

  log(
    `\n• Gỡ dòng điểm danh「${workerId}」rồi canh tới ${Math.round(timing.settleMs / 1000)} giây im lặng —\n` +
      "  một runner vừa mất kho còn thoi thóp được một lúc, và nó sẽ tự ghi lại tên nếu ta đi sớm.",
  );

  for (;;) {
    let seenQuietMs: number | null;
    try {
      /**
       * ĐO QUÃNG IM BẰNG ĐỒNG HỒ CỦA DATABASE. `last_seen` do `now()` bên ấy đặt, nên đem nó trừ
       * vào `Date.now()` của máy này là lệch đúng bằng độ lệch hai đồng hồ — một cái laptop chạy
       * nhanh 40 giây sẽ tuyên bố「đã im 30 giây」cho một dòng vừa gõ cửa xong.
       *
       * Trả về GIÂY chứ không phải mili: `::int` chỉ ôm được ~24 ngày nếu tính bằng mili, mà sổ
       * điểm danh thì giữ dòng vĩnh viễn — một dòng nằm đó ba tháng sẽ làm câu này ném
       *「integer out of range」ngay giữa lượt dọn. (Đo thật: mốc 400 ngày ra 34.560.000 giây.)
       */
      const rows = (await sql`
        select round(extract(epoch from (now() - last_seen)))::int as quiet_s
        from workers where id = ${workerId}
      `) as { quiet_s: number | null }[];
      seenQuietMs = rows.length > 0 ? (rows[0]?.quiet_s ?? 0) * 1000 : null;
    } catch (err) {
      warn(
        `⚠ Không soi được sổ điểm danh (${err instanceof Error ? err.message.slice(0, 120) : "lỗi lạ"}).\n` +
          `  Dừng canh. Nếu「${workerId}」còn hiện ở Hàng Đợi → tab Khôi Lỗi thì gỡ tay.`,
      );
      return done("error");
    }

    if (seenQuietMs !== null) {
      lastBeat = { quietMs: seenQuietMs, measuredAt: Date.now() };
      if (purges > 0) resurrections += 1;
    }

    const now = Date.now();
    // Cộng hai KHOẢNG thời gian thì không cần chung đồng hồ: quãng im database đo được, cộng
    // quãng đã trôi kể từ lượt đo ấy. Chưa từng thấy dòng nào thì tính từ lúc bắt đầu canh.
    const quietMs = lastBeat === null ? now - startedAt : lastBeat.quietMs + (now - lastBeat.measuredAt);
    const verdict = judgeRosterPurge({
      rowPresent: seenQuietMs !== null,
      quietMs,
      spentMs: now - startedAt,
      timing,
    });

    if (verdict.kind === "settled") {
      if (purges === 0) {
        log(`✔ sổ điểm danh không có dòng nào của「${workerId}」— không phải gỡ gì.`);
      } else if (resurrections === 0) {
        log(`✔ sổ điểm danh sạch —「${workerId}」không mọc lại.`);
      } else {
        log(
          `✔ sổ điểm danh sạch — đã phải gỡ ${purges} lần (${resurrections} lượt hồi sinh),` +
            ` runner tắt hẳn sau ~${Math.round((now - startedAt) / 1000)} giây.`,
        );
      }
      return done("settled");
    }

    if (verdict.kind === "giveup") {
      warn(`\n⚠ ${verdict.message}`);
      return done("giveup");
    }

    if (verdict.kind === "purge") {
      try {
        await sql`delete from workers where id = ${workerId}`;
      } catch (err) {
        warn(
          `⚠ Không gỡ được「${workerId}」khỏi bảng workers (${err instanceof Error ? err.message.slice(0, 120) : "lỗi lạ"}).\n` +
            "  Vô hại, trừ một chuyện: github:new sẽ từ chối dựng lại một khôi lỗi trùng id ấy.",
        );
        return done("error");
      }
      purges += 1;
      if (purges === 1) log(`✔ đã gỡ「${workerId}」khỏi sổ điểm danh`);
      else log(`  ↺ nó vừa tự ghi lại tên — gỡ lần ${purges}, runner còn thoi thóp.`);
      // Soi lại gần như ngay, nhưng qua một cái sàn — lý do ở `PURGE_GAP_MS`.
      await sleep(timing.gapMs);
      continue;
    }

    await sleep(verdict.ms);
  }
}
