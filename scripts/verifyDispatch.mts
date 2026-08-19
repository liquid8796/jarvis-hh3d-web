#!/usr/bin/env node
/**
 * Kiểm chứng BỘ CÂN TẢI LUÂN PHIÊN — `pickDispatch` trong services/dispatch.ts.
 *
 * Vì sao đáng có lưới riêng: đây là luật PHÂN CÔNG, và cả hai hướng sai đều câm lặng. Sai một
 * nhánh về phía chặt thì đàn nằm chờ mà không dòng nhật ký nào giải thích; sai về phía lỏng thì
 * một khôi lỗi ôm hết việc còn những cái vừa lên ca đứng không — đúng cái bệnh luật cũ mắc phải,
 * và nó chỉ lộ ra khi có người ngồi đếm bảng Hàng Đợi.
 *
 * Hàm THUẦN nên lưới này không cần database, không cần mạng — cùng lẽ với `verify:queue-pools`
 * và `verify:deploy-targets`. Chạy được cả khi tông môn đang bận, và không giành đàn của ai.
 */
import {
  clampMaxJobs,
  DEFAULT_MAX_JOBS,
  MAX_JOBS_CEILING,
  ONLINE_WINDOW_MS,
  pickDispatch,
  TURN_GRACE_MS,
  type DispatchJob,
  type DispatchRunner,
} from "../src/lib/services/dispatch";

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};

let checks = 0;
const check = (label: string, condition: unknown, detail = "") => {
  assert(condition, `${label}${detail ? ` — ${detail}` : ""}`);
  checks++;
  console.log(`  ✓ ${label}`);
};

/** Mốc "bây giờ" cố định: mọi mốc khác trong tệp này đều tính lùi từ nó. */
const NOW = 1_800_000_000_000;

/** Khôi lỗi TÔNG MÔN mặc định: đang trực, còn ghế, chưa từng được giao việc. */
const runner = (over: Partial<DispatchRunner> & { id: string }): DispatchRunner => ({
  userId: null,
  lastSeen: NOW,
  lastAssignedAt: null,
  maxJobs: 2,
  running: 0,
  ...over,
});

/** Đàn vừa tới giờ của đạo hữu `u1`, chưa chọn「Giao đàn cho」, và CHƯA từng chạy ở đâu. */
const job = (over: Partial<DispatchJob> & { id: string }): DispatchJob => ({
  userId: "u1",
  ownerPref: "any",
  dueAt: NOW,
  lastRunner: null,
  ...over,
});

const pick = (askedBy: string, runners: DispatchRunner[], jobs: DispatchJob[]) =>
  pickDispatch({ askedBy, runners, jobs, now: NOW });

console.log("Bộ cân tải luân phiên — việc phải chia theo lượt, không theo nhịp gõ cửa\n");

// ---- 1. Luân phiên: ai lâu chưa được giao nhất thì tới lượt -----------------------------
{
  const runners = [
    runner({ id: "vm", lastAssignedAt: NOW - 10_000 }),
    runner({ id: "github", lastAssignedAt: NOW - 60_000 }),
  ];
  const jobs = [job({ id: "j1" })];

  check(
    "khôi lỗi lâu chưa được giao nhất nhận đàn",
    pick("github", runners, jobs).jobId === "j1",
  );
  const other = pick("vm", runners, jobs);
  check("khôi lỗi vừa được giao phải chờ lượt", other.jobId === null, other.reason);
  check("và lý do nói đúng là chờ lượt", other.reason === "waiting-turn", other.reason);
}

// ---- 2. Khôi lỗi vừa lên ca đứng ĐẦU hàng, không phải cuối ------------------------------
// `lastAssignedAt = null` là quá khứ xa nhất chứ không phải tương lai gần nhất. Đảo dấu ở đây
// nghĩa là một khôi lỗi mới cài phải đợi hết lượt của mọi cái đang chạy mới có việc — tức là
// thêm máy vào tông môn không đỡ được gì cho tới tận vòng sau.
{
  const runners = [
    runner({ id: "vm", lastAssignedAt: NOW - 60_000 }),
    runner({ id: "moi", lastAssignedAt: null }),
  ];
  check(
    "chưa từng được giao thì tới lượt trước",
    pick("moi", runners, [job({ id: "j1" })]).jobId === "j1",
  );
}

// ---- 3. Hết ghế: không nhận việc, và cũng KHÔNG giữ lượt của người khác -----------------
// Vế thứ hai mới là vế dễ quên: một khôi lỗi đầy ghế mà vẫn được tính vào hàng luân phiên sẽ
// giữ chỗ cho một lượt nó không thể nhận, và đàn ấy đứng im tới khi van chống đói mở.
{
  const full = runner({ id: "vm", lastAssignedAt: NOW - 60_000, running: 2, maxJobs: 2 });
  const free = runner({ id: "github", lastAssignedAt: NOW - 10_000 });
  const jobs = [job({ id: "j1" })];

  const mine = pick("vm", [full, free], jobs);
  check("khôi lỗi đầy ghế không nhận việc", mine.jobId === null, mine.reason);
  check("và lý do là hết ghế", mine.reason === "no-seat", mine.reason);
  check(
    "khôi lỗi đầy ghế không giữ lượt của cái còn chỗ",
    pick("github", [full, free], jobs).jobId === "j1",
  );
}

// ---- 4. Vắng mặt thì không được chia việc, và cũng không giữ lượt -----------------------
{
  const away = runner({ id: "vm", lastAssignedAt: null, lastSeen: NOW - ONLINE_WINDOW_MS - 1 });
  const here = runner({ id: "github", lastAssignedAt: NOW - 10_000 });
  const jobs = [job({ id: "j1" })];

  check("khôi lỗi đã vắng không nhận việc", pick("vm", [away, here], jobs).jobId === null);
  check(
    "khôi lỗi đã vắng không giữ lượt dù chưa từng được giao",
    pick("github", [away, here], jobs).jobId === "j1",
  );
  check(
    "vừa kịp cửa sổ điểm danh thì vẫn được tính",
    pick(
      "vm",
      [runner({ id: "vm", lastSeen: NOW - ONLINE_WINDOW_MS }), here],
      jobs,
    ).jobId === "j1",
  );
}

// ---- 5.「Giao đàn cho」— luật cũ của workerPrefFilter, nay sống trong hàm thuần ----------
{
  const sect = runner({ id: "vm" });
  const mine = runner({ id: "may-nha", userId: "u1" });
  const stranger = runner({ id: "may-nguoi-khac", userId: "u2" });

  const onlyMine = [job({ id: "j1", ownerPref: "mine" })];
  check("pref=mine: khôi lỗi tông môn không cầm được", pick("vm", [sect, mine], onlyMine).jobId === null);
  check("pref=mine: máy nhà của chính chủ cầm được", pick("may-nha", [sect, mine], onlyMine).jobId === "j1");

  const onlySect = [job({ id: "j1", ownerPref: "sect" })];
  check("pref=sect: máy nhà không cầm được", pick("may-nha", [sect, mine], onlySect).jobId === null);
  check("pref=sect: khôi lỗi tông môn cầm được", pick("vm", [sect, mine], onlySect).jobId === "j1");

  const anyPref = [job({ id: "j1", ownerPref: "any" })];
  check(
    "pref=any: máy nhà của NGƯỜI KHÁC vẫn không cầm được",
    pick("may-nguoi-khac", [stranger], anyPref).jobId === null,
  );

  // Giá trị rác chỉ có thể lọt vào JSONB bằng một lượt sửa tay database. Luật cũ dùng `<>` nên
  // nó rơi về "ai cũng được"; giữ nguyên hướng hỏng ấy — vẫn phục vụ, không nằm im.
  //
  // Hỏi TỪNG loại khôi lỗi một, mỗi lượt một mình trong sổ: câu hỏi ở đây là「có được phép cầm
  // không」, còn thả cả hai vào cùng lúc thì câu trả lời sẽ là「ai tới lượt」— một luật khác,
  // đã kiểm ở mục 1, và trộn hai câu ấy làm một là cách để phép thử này nói dối về sau.
  const junk = [job({ id: "j1", ownerPref: "sect-nhung-go-nham" })];
  check("pref rác đọc như any: tông môn cầm được", pick("vm", [sect], junk).jobId === "j1");
  check("pref rác đọc như any: máy nhà cũng cầm được", pick("may-nha", [mine], junk).jobId === "j1");
}

// ---- 6. Đàn không ai phục vụ được KHÔNG được chặn cả hàng ------------------------------
// Đây là điều câu SQL đời trước làm được nhờ lọc ngay trong truy vấn, và là chỗ một bản viết
// lại rất dễ đánh mất: dừng ở đàn đầu tiên thì một đàn「chỉ máy nhà」của người đang tắt máy sẽ
// treo toàn bộ hàng chờ của cả tông môn.
{
  const sect = runner({ id: "vm" });
  const jobs = [
    job({ id: "cho-may-nha", userId: "u9", ownerPref: "mine" }),
    job({ id: "cho-ai-cung-duoc", userId: "u1" }),
  ];
  check("đàn không ai cầm được bị bỏ qua, đàn sau vẫn chạy", pick("vm", [sect], jobs).jobId === "cho-ai-cung-duoc");
}

// ---- 7. Thứ tự hàng chờ được tôn trọng --------------------------------------------------
{
  const sect = runner({ id: "vm" });
  const jobs = [job({ id: "truoc" }), job({ id: "sau" })];
  check("hai đàn cùng đủ tư cách thì nhận cái đứng trước", pick("vm", [sect], jobs).jobId === "truoc");
}

// ---- 8. VAN CHỐNG ĐÓI ------------------------------------------------------------------
{
  const turnHolder = runner({ id: "vm", lastAssignedAt: null });
  const other = runner({ id: "github", lastAssignedAt: NOW - 10_000 });

  const fresh = [job({ id: "j1", dueAt: NOW - 5_000 })];
  check(
    "quá hạn 5 giây thì luân phiên vẫn cầm quyền",
    pick("github", [turnHolder, other], fresh).jobId === null,
  );

  const stale = [job({ id: "j1", dueAt: NOW - TURN_GRACE_MS })];
  const opened = pick("github", [turnHolder, other], stale);
  check("quá hạn chờ lượt thì ai đủ tư cách cũng nhận được", opened.jobId === "j1", opened.reason);
  check("và lý do phân biệt được với lượt thường", opened.reason === "granted-overdue", opened.reason);

  // Van chống ĐÓI, không phải van chống LUẬT: nó chỉ bỏ qua phép tính lượt, không bỏ qua tư
  // cách. Một đàn「chỉ máy nhà」quá hạn ba ngày vẫn không rơi vào tay khôi lỗi tông môn.
  const staleMine = [job({ id: "j1", ownerPref: "mine", dueAt: NOW - 3 * 86_400_000 })];
  check(
    "van chống đói KHÔNG phá lệ Giao đàn cho",
    pick("vm", [turnHolder], staleMine).jobId === null,
  );
}

// ---- 9. Tất định: hai khôi lỗi ngang lượt không được cùng tưởng mình thắng ---------------
// Phép xét chạy độc lập trên mỗi request, nên hoà phải được phá bằng một quy tắc cố định.
// Không có nó thì hai khôi lỗi cùng lao vào một đàn: câu UPDATE có điều kiện vẫn chặn được,
// nhưng một trong hai mất trắng một nhịp mà không ai biết vì sao.
{
  const a = runner({ id: "aaa", lastAssignedAt: NOW - 30_000 });
  const b = runner({ id: "bbb", lastAssignedAt: NOW - 30_000 });
  const jobs = [job({ id: "j1" })];
  const winners = [pick("aaa", [a, b], jobs), pick("bbb", [a, b], jobs)].filter((d) => d.jobId);
  check("ngang lượt thì đúng MỘT bên thắng", winners.length === 1, `${winners.length} bên nhận việc`);
  check("và bên thắng là id nhỏ hơn", pick("aaa", [a, b], jobs).jobId === "j1");
  check("thứ tự truyền vào không đổi kết quả", pick("aaa", [b, a], jobs).jobId === "j1");
}

// ---- 10. Những câu trả lời rỗng phải nói đúng vì sao ------------------------------------
{
  const sect = runner({ id: "vm" });
  check("không có đàn nào tới giờ", pick("vm", [sect], []).reason === "no-due-job");
  check(
    "hỏi việc mà không có tên trong sổ",
    pick("la-mat", [sect], [job({ id: "j1" })]).reason === "not-eligible",
  );
  check(
    "có đàn nhưng không đàn nào mình cầm được",
    pick("vm", [sect], [job({ id: "j1", ownerPref: "mine" })]).reason === "not-eligible",
  );
}

// ---- 11. Kẹp lời khai trần ghế ----------------------------------------------------------
{
  check("không khai thì nhận trần chuẩn", clampMaxJobs(null) === DEFAULT_MAX_JOBS);
  check("khai rác cũng nhận trần chuẩn", clampMaxJobs(Number.NaN) === DEFAULT_MAX_JOBS);
  check("khai 0 bị nâng lên 1", clampMaxJobs(0) === 1);
  check("khai âm bị nâng lên 1", clampMaxJobs(-5) === 1);
  check("khai quá cao bị hạ về trần", clampMaxJobs(999) === MAX_JOBS_CEILING);
  check("số lẻ bị cắt xuống", clampMaxJobs(3.9) === 3);
}

// ---- 9. DÍNH CHÂN: đàn ở lại với khôi lỗi đã chạy nó ------------------------------------
//
// Vì sao có luật này, đo trên sổ thật 19/08/2026: tài khoản `fptshop` chạy 39 vòng trong sáu giờ
// trên MƯỜI khôi lỗi khác nhau, `long01` 41 vòng cũng trên mười. Mỗi khôi lỗi là một IP khác, và
// `cf_clearance` của Cloudflare gắn chặt với IP đã giải nó — nên với cổng kiểm tra thì đó là một
// phiên đăng nhập nhảy qua mười địa chỉ trong một buổi sáng, và mỗi cú nhảy là một màn Turnstile.
{
  const runners = [
    runner({ id: "w1", lastAssignedAt: NOW - 60_000 }),
    runner({ id: "w2", lastAssignedAt: NOW - 10_000 }),
  ];
  const stuck = [job({ id: "j1", lastRunner: "w2" })];

  // w1 đang tới lượt theo luân phiên — và vẫn KHÔNG được, vì đàn có chủ cũ còn trực.
  const outsider = pick("w1", runners, stuck);
  check("đàn đã có chủ cũ còn trực → khôi lỗi khác KHÔNG cướp, dù đang tới lượt", outsider.jobId === null, outsider.reason);
  check("…và lý do nói đúng là dính chân", outsider.reason === "waiting-affinity", outsider.reason);
  check("chủ cũ nhận lại đàn, bất kể vừa được giao việc xong", pick("w2", runners, stuck).jobId === "j1");

  // Chủ cũ VẮNG thì đàn đi tiếp NGAY — dính chân không được phép thành một sợi xích.
  const gone = [runner({ id: "w1", lastAssignedAt: NOW - 60_000 }), runner({ id: "w2", lastSeen: NOW - 120_000 })];
  check("chủ cũ vắng mặt → đàn về luân phiên ngay, không chờ ai", pick("w1", gone, stuck).jobId === "j1");

  // Chủ cũ HẾT GHẾ cũng vậy, và đây là đánh đổi có chủ ý: chờ một cái ghế trống có thể mất vài
  // phút (một vòng chạy), đắt hơn hẳn cái lợi của việc ở lại đúng IP.
  const busy = [
    runner({ id: "w1", lastAssignedAt: NOW - 60_000 }),
    runner({ id: "w2", running: 2, maxJobs: 2 }),
  ];
  check("chủ cũ hết ghế → đàn về luân phiên ngay", pick("w1", busy, stuck).jobId === "j1");

  // Chủ cũ đã bị gỡ khỏi sổ điểm danh: `lastRunner` trỏ vào hư không, không được làm treo đàn.
  const orphan = [runner({ id: "w1", lastAssignedAt: NOW - 60_000 })];
  check("chủ cũ không còn trong sổ → đàn về luân phiên", pick("w1", orphan, stuck).jobId === "j1");

  // Chủ cũ hết TƯ CÁCH: chủ đàn đổi sang「chỉ máy nhà」thì khôi lỗi tông môn cũ không giữ chỗ nữa.
  const mineOnly = [job({ id: "j1", ownerPref: "mine", lastRunner: "w2" })];
  const home = [
    runner({ id: "nha", userId: "u1", lastAssignedAt: NOW - 60_000 }),
    runner({ id: "w2", lastAssignedAt: NOW - 10_000 }),
  ];
  check("chủ cũ không còn đủ tư cách → máy nhà nhận đàn", pick("nha", home, mineOnly).jobId === "j1");

  // VAN CHỐNG ĐÓI thắng dính chân — đây là thứ giữ cho luật này không bao giờ khoá cứng một đàn.
  const overdue = [job({ id: "j1", lastRunner: "w2", dueAt: NOW - TURN_GRACE_MS })];
  const late = pick("w1", runners, overdue);
  check("quá hạn chờ → van mở, dính chân thôi giữ chỗ", late.jobId === "j1", late.reason);
  check("…và lý do nói đúng là van chống đói", late.reason === "granted-overdue", late.reason);

  // Dính chân của đàn NÀY không được chặn đàn KHÁC: một hàng chờ có một đàn dính chân vẫn phải
  // chảy tiếp cho những đàn còn lại.
  const mixed = [job({ id: "j1", lastRunner: "w2" }), job({ id: "j2" })];
  check("đàn dính chân không chặn đàn phía sau", pick("w1", runners, mixed).jobId === "j2");

  // Và dính chân ĐI TRƯỚC luân phiên cho chính mình: chủ cũ không phải chờ tới lượt để nhận lại
  // đàn của nó — nếu phải chờ thì mỗi vòng lại là một cuộc đua mới, tức lại nhảy IP.
  const justServed = [
    runner({ id: "w1", lastAssignedAt: NOW - 60_000 }),
    runner({ id: "w2", lastAssignedAt: NOW }),
  ];
  check("chủ cũ vừa được giao việc vẫn nhận lại đàn của mình ngay", pick("w2", justServed, stuck).jobId === "j1");
}

console.log(`\n${checks} phép kiểm — bộ cân tải chia việc đúng luật.`);
