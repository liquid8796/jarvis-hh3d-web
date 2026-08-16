#!/usr/bin/env node
/**
 * Kiểm chứng VÒNG CANH SỔ ĐIỂM DANH (`scripts/rosterPurge.mts`) trên một database THẬT.
 *
 * VÌ SAO PHẢI CHẠM DATABASE, trong khi `verify:github-removal` đã bao từng nhánh của luật: hai tệp
 * ấy kiểm hai thứ khác nhau, và cái thứ hai mới là cái đã hỏng. Luật (`judgeRosterPurge`) là hàm
 * thuần, đã có đồng hồ giả lái qua từng nhánh. Thứ chưa ai chạy thử là ĐOẠN DÂY nối nó với
 * database: câu SQL, phép ghi sổ `lastBeat`, phép cộng một quãng do Postgres đo với một quãng đo
 * bằng `Date.now()`, và phép thi hành từng phán quyết. Một luật đúng nối bằng một sợi dây sai thì
 * vẫn đẻ ra đúng cái dòng ma của ngày 13/08/2026.
 *
 * RUNNER GIẢ, NHƯNG LƯỢT GHI THẬT. Ca quan trọng nhất dưới đây dựng lại đúng cảnh đã xảy ra: một
 * tiến trình gõ cửa đều đặn bằng `insert … on conflict do update` trong lúc vòng canh đang xoá.
 * Không mock — chính sự tranh chấp giữa hai lượt ghi mới là thứ phải kiểm.
 *
 * ĐỒNG HỒ RÚT GỌN, và đó KHÔNG phải chỗ hổng. Với 30 giây yên và 3 phút ngân sách thì bốn ca này
 * là hơn năm phút — một phép kiểm không ai chạy lần thứ hai. Bốn con số thật (và quan hệ giữa
 * chúng) đã được đóng đinh ở `verify:github-removal`; ở đây rút gọn để chạy cùng ĐOẠN DÂY ấy
 * trong mươi giây. Xem `PRODUCTION_TIMING`.
 *
 * DỌN SẠCH SAU LƯNG. Mọi dòng dựng ra mang tiền tố `__purge_` và bị xoá trong `finally`, kể cả khi
 * một phép kiểm ngã giữa chừng — cùng lối với tiền tố `__quota_` của `verify:daily-quota`. Chúng
 * sống vài giây với `user_id = null`, tức trong quãng ấy có lọt vào sổ điểm danh của tab Khôi Lỗi;
 * cái tên đã tự khai nó là gì, và không lượt phát việc nào đụng tới chúng (không kho, không token).
 *
 * KHÔNG `process.exit()` — cùng lý do ghi ở đầu `removeGithubKhoiloi.mts`: gọi nó sau một lượt
 * fetch (mà `neon` thì đi bằng fetch) làm libuv ném trên Windows. Mọi ngả kết thúc qua `exitCode`,
 * và ngả nào cũng phải đi qua bước dọn.
 */
import { sqlTag } from "./pgTag.mjs";
import { type PurgeTiming } from "./githubKhoiloi.mts";
import { loadEnv } from "./loadEnv.mjs";
import { purgeRosterRow } from "./rosterPurge.mts";

loadEnv();

/** Tiền tố tự khai: một dòng lọt lại sau lượt chạy đứt gánh phải tự nói được nó là rác của ai. */
const TEMP_PREFIX = "__purge_";
const FAKE_VERSION = "0.0.0-verify";

/** Đủ rộng để chịu độ trễ mạng tới Neon, đủ hẹp để cả tệp chạy trong mươi giây. */
const FAST: PurgeTiming = { settleMs: 3_000, pollMs: 400, gapMs: 100, budgetMs: 30_000 };
/**
 * Riêng ca xác nguội thì cửa sổ yên phải RỘNG hẳn — phép kiểm ở đó là「KHÔNG ngồi đợi hết cửa sổ」,
 * và một cửa sổ chỉ nhỉnh hơn vài lượt đi-về sẽ biến một mạng chậm thành một lời buộc tội sai.
 */
const COLD: PurgeTiming = { ...FAST, settleMs: 20_000 };
/** Riêng ca ngân sách thì ngân sách phải NGẮN — nó chính là thứ đang được đo. */
const TIGHT: PurgeTiming = { ...FAST, budgetMs: 5_000 };

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Một phép kiểm ngã. Ném chứ không `process.exit`, để bước dọn trong `finally` còn chạy được. */
class Failed extends Error {}

let passed = 0;
function ok(condition: boolean, label: string): void {
  if (!condition) throw new Failed(label);
  passed += 1;
  console.log(`  ✔ ${label}`);
}

const url = (process.env.DATABASE_URL ?? "").trim();
if (!url) throw new Error("Thiếu DATABASE_URL — chạy `npm run env:pull` hoặc soi .env.local.");
const sql = sqlTag(url);

/**
 * Đúng hình dạng câu ghi của `recordWorkerSeen`: `insert … on conflict do update`. Chính câu ấy là
 * thứ làm dòng mọc lại sau lượt xoá, nên runner giả phải dùng nó chứ không phải một `insert` trơn
 * — `insert` trơn sẽ ném ở lượt thứ hai, và ca kiểm hoá ra dễ hơn đời thật.
 */
async function knock(id: string): Promise<void> {
  await sql`
    insert into workers (id, user_id, version) values (${id}, null, ${FAKE_VERSION})
    on conflict (id) do update set last_seen = now(), version = ${FAKE_VERSION}
  `;
}

async function rowExists(id: string): Promise<boolean> {
  const rows = (await sql`select 1 as x from workers where id = ${id}`) as unknown[];
  return rows.length > 0;
}

/**
 * Một tiến trình gõ cửa đều đặn. `maxBeats` là cách nó「chết」— dựng lại đúng cảnh runner của kho
 * vừa xoá: sống thêm một quãng rồi tắt hẳn. `null` = không bao giờ tắt (ca máy khác cài trùng id).
 */
function startFakeRunner(id: string, everyMs: number, maxBeats: number | null): { stop: () => Promise<void> } {
  let running = true;
  let beats = 0;
  /**
   * `.catch` gắn NGAY tại đây, không đợi tới `stop()`: một cú vấp mạng của runner giả sẽ làm lời
   * hứa này đổ vỡ trước khi ai kịp bắt, và Node hiện đại giết cả tiến trình vì một unhandled
   * rejection — tức một phép kiểm hạ tầng đổ vì mạng, mà lại đổ dưới hình dạng「mã hỏng」.
   * Runner chết sớm thì ca kiểm vẫn ngã, nhưng ngã bằng đúng câu「không bắt được lượt hồi sinh」.
   */
  const loop = (async () => {
    while (running && (maxBeats === null || beats < maxBeats)) {
      await knock(id);
      beats += 1;
      await sleep(everyMs);
    }
  })().catch(() => undefined);

  return {
    stop: async () => {
      running = false;
      // CHỜ vòng dừng hẳn trước khi trả về: một lượt ghi lọt ra sau bước dọn sẽ để lại đúng cái
      // dòng ma mà tệp này sinh ra để chứng minh là không còn.
      await loop;
    },
  };
}

type Recorder = { log: (line: string) => void; warn: (line: string) => void; lines: string[] };

/** Giữ lại lượt tường thuật để kiểm — thứ vòng canh NÓI cũng là một phần của tính năng. */
function recorder(): Recorder {
  const lines: string[] = [];
  const take = (line: string) => {
    lines.push(line);
    for (const one of line.split("\n")) if (one.trim().length > 0) console.log(`    │ ${one.trim()}`);
  };
  return { log: take, warn: take, lines };
}

async function sweepTempRows(): Promise<number> {
  const gone = (await sql`delete from workers where id like ${`${TEMP_PREFIX}%`} returning id`) as { id: string }[];
  return gone.length;
}

async function main(): Promise<void> {
  const stamp = Date.now();

  // ---- CA 1: xác nguội — xong ngay ở lượt soi đầu, không bắt ai đợi hết cửa sổ -----------------
  {
    console.log("\n── CA 1: dòng đã chết từ lâu ──");
    const id = `${TEMP_PREFIX}nguoi_${stamp}`;
    await sql`
      insert into workers (id, user_id, version, first_seen, last_seen)
      values (${id}, null, ${FAKE_VERSION}, now() - interval '10 minutes', now() - interval '10 minutes')
    `;

    const rec = recorder();
    const report = await purgeRosterRow({ activePg: url, workerId: id, timing: COLD, ...rec });

    ok(report.outcome === "settled", "xác nguội → settled");
    ok(report.purges === 1, `xoá đúng MỘT lần (đo: ${report.purges})`);
    ok(report.resurrections === 0, "không lượt hồi sinh nào");
    ok(
      report.elapsedMs < COLD.settleMs,
      `KHÔNG ngồi đợi hết cửa sổ yên — xong sau ${report.elapsedMs}ms, cửa sổ là ${COLD.settleMs}ms`,
    );
    ok(!(await rowExists(id)), "dòng đã biến khỏi bảng workers");
  }

  // ---- CA 2: HỒI SINH — chính chuyện đã xảy ra ngày 13/08/2026 ---------------------------------
  {
    console.log("\n── CA 2: runner còn thoi thóp, tự ghi lại tên sau mỗi lượt xoá ──");
    const id = `${TEMP_PREFIX}hoisinh_${stamp}`;
    await knock(id);

    // Gõ mỗi 300ms rồi tắt sau 8 nhịp (~2,4 giây) — cái runner thật sống thêm 52 giây sau khi kho
    // đã 404, rút theo cùng tỉ lệ với đồng hồ rút gọn.
    const runner = startFakeRunner(id, 300, 8);
    const rec = recorder();
    const report = await purgeRosterRow({ activePg: url, workerId: id, timing: FAST, ...rec });
    await runner.stop();

    ok(report.outcome === "settled", "cuối cùng vẫn settled, không bỏ cuộc");
    ok(report.resurrections >= 1, `BẮT ĐƯỢC lượt hồi sinh (đo: ${report.resurrections} lượt)`);
    ok(report.purges >= 2, `và xoá lại chứ không xoá một lần rồi đi (đo: ${report.purges} lượt xoá)`);
    ok(
      rec.lines.some((line) => line.includes("↺")),
      "có kể cho người vận hành biết nó vừa mọc lại, không âm thầm dọn",
    );
    ok(!(await rowExists(id)), "và dòng THẬT SỰ biến mất — đúng thứ bản 0.82.2 không làm được");
    ok(
      report.elapsedMs >= FAST.settleMs,
      `chỉ kết luận sau khi đã im trọn cửa sổ (đo: ${report.elapsedMs}ms ≥ ${FAST.settleMs}ms)`,
    );
  }

  // ---- CA 3: chưa có dòng nào — vẫn canh, vì runner có thể điểm danh muộn ----------------------
  {
    console.log("\n── CA 3: sổ chưa có dòng nào của id ấy ──");
    const id = `${TEMP_PREFIX}vang_${stamp}`;
    const rec = recorder();
    const report = await purgeRosterRow({ activePg: url, workerId: id, timing: FAST, ...rec });

    ok(report.outcome === "settled", "không có gì để gỡ → settled");
    ok(report.purges === 0, "không chạy câu DELETE nào");
    ok(
      report.elapsedMs >= FAST.settleMs,
      `nhưng VẪN canh trọn cửa sổ (${report.elapsedMs}ms) — runner vừa khởi động có thể điểm danh muộn`,
    );
  }

  // ---- CA 4: gõ cửa mãi không thôi — dừng đúng hạn, không treo ---------------------------------
  {
    console.log("\n── CA 4: một máy KHÁC cài trùng WORKER_ID (gõ cửa không bao giờ ngừng) ──");
    const id = `${TEMP_PREFIX}trungid_${stamp}`;
    const runner = startFakeRunner(id, 300, null);
    const rec = recorder();
    const report = await purgeRosterRow({ activePg: url, workerId: id, timing: TIGHT, ...rec });
    await runner.stop();

    ok(report.outcome === "giveup", "hết ngân sách → giveup, không xoá tới vô tận");
    ok(
      report.elapsedMs >= TIGHT.budgetMs && report.elapsedMs < TIGHT.budgetMs * 3,
      `dừng quanh đúng hạn (đo: ${report.elapsedMs}ms, hạn ${TIGHT.budgetMs}ms) — không treo`,
    );
    ok(report.resurrections >= 1, "và có ghi nhận nó mọc lại nhiều lần trước khi bỏ cuộc");
    ok(
      rec.lines.some((line) => line.includes("WORKER_ID")),
      "câu cảnh báo gọi tên nghi phạm thật cho người vận hành",
    );
  }
}

try {
  await main();
  console.log(`\n✔ ${passed} phép kiểm — vòng canh sổ điểm danh chạy đúng trên database thật.`);
} catch (err) {
  console.error(err instanceof Failed ? `\n✗ ${err.message}` : `\n✖ ${err instanceof Error ? err.stack : err}`);
  process.exitCode = 1;
} finally {
  const left = await sweepTempRows().catch((err: unknown) => {
    console.error(`\n✖ KHÔNG DỌN ĐƯỢC dòng tạm mang tiền tố「${TEMP_PREFIX}」: ${err instanceof Error ? err.message : err}`);
    console.error("  Gỡ tay: delete from workers where id like '__purge_%';");
    process.exitCode = 1;
    return -1;
  });
  if (left > 0) console.log(`• dọn ${left} dòng tạm còn sót.`);
}
