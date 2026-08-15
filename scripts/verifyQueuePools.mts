#!/usr/bin/env node
/**
 * Kiểm chứng bảng Hàng Đợi ở hai phép THUẦN của services/queue.ts, và chúng đi cùng nhau:
 * `assignQueueSlots` (đàn này đứng thứ mấy, trong hàng nào) và `orderQueueRows` (dòng này ngồi
 * chỗ nào trên bảng). Cùng một sự thật —「đàn máy nhà không đứng chung hàng với ai」— nói bằng
 * hai giọng, nên một lưới chung mới bắt được lúc chúng lệch nhau.
 *
 * Vì sao đáng có lưới riêng: bản trước chạy MỘT bộ đếm cho mọi dòng đang chờ, nên một đàn mà chủ
 * đã chọn「chỉ máy nhà」vẫn nhận số thứ tự trong hàng của khôi lỗi tông môn — cái hàng mà
 * `workerPrefFilter` cấm tông môn chạm vào. Lỗi ấy KHÔNG có cách nào lộ ra bằng mắt: con số vẫn
 * tăng đều, vẫn đẹp, chỉ là nó đếm một cuộc đua mà đàn ấy không tham gia. Người xem đọc「thứ 1」
 * rồi ngồi đợi, trong khi thứ duy nhất nhận được đàn ấy là máy ở nhà họ — và máy ấy đang tắt.
 * Đo trên đàn thật 13/08/2026: hai dòng của một đạo hữu hiện「Chờ tới lượt · thứ 1」và「thứ 2」
 * suốt 70 phút, với `workerPref = mine` và máy nhà im lặng từ đầu.
 *
 * Hàm THUẦN nên lưới này không cần database, không cần mạng — cùng lẽ với `verify:mirror-tables`
 * và `verify:deploy-targets`.
 */
import { assignQueueSlots, orderQueueRows, type QueueCandidate } from "../src/lib/services/queue";
import { describeAssignment, normalizeOwnerPref } from "../src/lib/validation/queueAssign";

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};

let checks = 0;
const check = (label: string, condition: unknown, detail = "") => {
  assert(condition, `${label}${detail ? ` — ${detail}` : ""}`);
  checks++;
  console.log(`  ✓ ${label}`);
};

/** Dựng một dòng đang chờ; mặc định là ca thường gặp nhất (chưa chọn gì, máy nhà không có). */
const row = (over: Partial<QueueCandidate> = {}): QueueCandidate => ({
  userId: "u1",
  ownerPref: "any",
  ownerWorkerOnline: false,
  queued: true,
  ...over,
});

console.log("Xếp chỗ hàng đợi — số thứ tự phải thuộc về đúng hàng sẽ phục vụ nó\n");

// ---- 1. Ca đã trả giá: đàn「chỉ máy nhà」không được chiếm chỗ trong hàng tông môn ------------
{
  const slots = assignQueueSlots(
    [
      row({ userId: "d2ksun", ownerPref: "mine" }),
      row({ userId: "d2ksun", ownerPref: "mine" }),
      row({ userId: "ai-do", ownerPref: "any" }),
    ],
    true,
  );
  check(
    "hai đàn「chỉ máy nhà」đếm riêng trong hàng của chủ, từ 1",
    slots[0].pool === "own" && slots[0].position === 1 && slots[1].pool === "own" && slots[1].position === 2,
    JSON.stringify(slots.slice(0, 2)),
  );
  check(
    "…và KHÔNG ăn mất số của hàng tông môn: đàn chung đứng sau chúng vẫn là thứ 1",
    slots[2].pool === "sect" && slots[2].position === 1,
    JSON.stringify(slots[2]),
  );
  check(
    "khôi lỗi tông môn đang trực KHÔNG cứu nổi đàn giao riêng cho máy nhà",
    slots[0].poolHasWorker === false && slots[2].poolHasWorker === true,
    JSON.stringify(slots.map((s) => s.poolHasWorker)),
  );
}

// ---- 2. Mỗi chủ một hàng riêng, không chung bộ đếm -------------------------------------------
{
  const slots = assignQueueSlots(
    [
      row({ userId: "a", ownerPref: "mine", ownerWorkerOnline: true }),
      row({ userId: "b", ownerPref: "mine", ownerWorkerOnline: true }),
      row({ userId: "a", ownerPref: "mine", ownerWorkerOnline: true }),
    ],
    false,
  );
  check(
    "hai chủ khác nhau đều bắt đầu từ thứ 1; đàn thứ hai của cùng chủ mới là thứ 2",
    slots[0].position === 1 && slots[1].position === 1 && slots[2].position === 2,
    JSON.stringify(slots.map((s) => s.position)),
  );
  check("máy nhà đang trực thì hàng riêng có người", slots.every((s) => s.poolHasWorker));
}

// ---- 3. Dòng không xếp hàng: không số, không hàng --------------------------------------------
{
  const slots = assignQueueSlots(
    [
      row({ queued: false }),
      row(),
      row({ queued: false, ownerPref: "mine" }),
      row({ ownerPref: "mine", userId: "u2" }),
    ],
    true,
  );
  check(
    "đàn đang chạy/đang nghỉ không có số và không thuộc hàng nào",
    slots[0].position === null && slots[0].pool === null && slots[2].position === null && slots[2].pool === null,
    JSON.stringify(slots),
  );
  check(
    "…và chúng KHÔNG làm nhích bộ đếm của những dòng đang chờ",
    slots[1].position === 1 && slots[3].position === 1,
    JSON.stringify([slots[1].position, slots[3].position]),
  );
}

// ---- 4. Bảng chân trị của「hàng này có ai không」----------------------------------------------
// `any` là ca dễ sai nhất và là ca duy nhất hỏi CẢ HAI phía: đàn ấy đứng ở hàng chung nhưng máy
// nhà của chủ cũng nhặt được, nên báo nó vô vọng lúc máy nhà đang chạy là nói dối.
{
  const table: [string, boolean, boolean, boolean][] = [
    // pref, máy nhà trực, tông môn trực, kỳ vọng
    ["mine", true, false, true],
    ["mine", false, true, false],
    ["sect", false, true, true],
    ["sect", true, false, false],
    ["any", false, true, true],
    ["any", true, false, true],
    ["any", false, false, false],
  ];
  for (const [pref, ownerOnline, sectOnline, expected] of table) {
    const [slot] = assignQueueSlots([row({ ownerPref: pref, ownerWorkerOnline: ownerOnline })], sectOnline);
    check(
      `pref=${pref} · máy nhà ${ownerOnline ? "trực" : "vắng"} · tông môn ${sectOnline ? "trực" : "vắng"} → ${expected ? "có người" : "KHÔNG ai"}`,
      slot.poolHasWorker === expected,
      `nhận ${slot.poolHasWorker}`,
    );
  }
}

// ---- 5. Giá trị lạ trong JSONB đọc như `any` --------------------------------------------------
// Cùng lối fail-open với `workerPrefFilter`: sửa tay database ra một chuỗi lạ thì đàn vẫn được
// phục vụ, và bảng vẫn nói đúng về hàng chung — thay vì nằm im ở một hàng không ai đọc.
{
  const [slot] = assignQueueSlots([row({ ownerPref: "khong-phai-lua-chon" })], true);
  check("pref lạ → xử như `any`: vào hàng chung và có người", slot.pool === "sect" && slot.poolHasWorker === true);
}

// ---- 6. Thứ tự đầu vào được giữ nguyên --------------------------------------------------------
// Hàm này chỉ ĐÁNH SỐ, không sắp xếp: thứ tự nhặt việc do câu SQL quyết (next_run_at, created_at).
{
  const slots = assignQueueSlots([row(), row(), row(), row()], true);
  check(
    "hàng chung đánh số 1,2,3,4 theo đúng thứ tự đầu vào",
    slots.map((s) => s.position).join(",") === "1,2,3,4",
    slots.map((s) => s.position).join(","),
  );
}

// ---- 7. CHỖ NGỒI trên bảng: đàn máy nhà luôn nằm dưới hàng chung ------------------------------
// Ca đã trả giá 14/08/2026: hai đàn `mine` của một đạo hữu tới giờ sớm nhất nên chiếm đúng hai
// dòng đầu bảng —「Chờ máy nhà — chưa máy nào trực」— trong khi cả hàng chung nằm phía dưới. Hai
// dòng ấy không đi đâu cho tới khi máy ở nhà chủ nó lên ca, mà chúng lại ngồi đúng chỗ người ta
// nhìn vào để đoán「bao giờ tới lượt mình」.
{
  type Row = { id: string; ownerPref: string; status: string };
  const at = (rows: readonly Row[]) =>
    orderQueueRows(rows, (row) => ({
      finished: row.status === "stopped" || row.status === "failed",
      ownerPref: row.ownerPref,
    }));
  const ids = (rows: readonly Row[]) => rows.map((r) => r.id).join(",");

  const sorted = at([
    { id: "nha-1", ownerPref: "mine", status: "queued" },
    { id: "nha-2", ownerPref: "mine", status: "queued" },
    { id: "chung-1", ownerPref: "any", status: "queued" },
    { id: "tat-1", ownerPref: "sect", status: "stopped" },
    { id: "chung-2", ownerPref: "sect", status: "running" },
  ]);
  check(
    "đàn máy nhà VÀO TRƯỚC vẫn tụt xuống dưới cả hàng chung",
    ids(sorted) === "chung-1,chung-2,nha-1,nha-2,tat-1",
    ids(sorted),
  );
  check(
    "…và thứ tự TRONG mỗi nhóm giữ nguyên như câu SQL trả về",
    sorted.findIndex((r) => r.id === "nha-1") < sorted.findIndex((r) => r.id === "nha-2") &&
      sorted.findIndex((r) => r.id === "chung-1") < sorted.findIndex((r) => r.id === "chung-2"),
    ids(sorted),
  );
  check(
    "đàn đã tắt vẫn nằm dưới cùng — kể cả dưới đàn máy nhà",
    sorted.at(-1)?.id === "tat-1",
    ids(sorted),
  );

  // `sect` và pref lạ đều thuộc hàng CHUNG, nên không dòng nào bị đẩy xuống oan.
  const mixed = at([
    { id: "la", ownerPref: "khong-phai-lua-chon", status: "queued" },
    { id: "nha", ownerPref: "mine", status: "queued" },
    { id: "sect", ownerPref: "sect", status: "queued" },
  ]);
  check("chỉ `mine` mới xuống dưới; `sect` và pref lạ ở lại hàng chung", ids(mixed) === "la,sect,nha", ids(mixed));

  // Mảng rỗng: bảng lúc cả tông môn đang rảnh. Không được ngã, và không được đẻ ra dòng nào.
  check("mảng rỗng ra mảng rỗng", at([]).length === 0);
}

// ---- 8. Đổi chỗ KHÔNG được đổi số --------------------------------------------------------------
// Hai phép này dùng chung một mảng, và đó là chỗ dễ hỏng nhất của bản 14/08: `assignQueueSlots`
// đếm theo THỨ TỰ đầu vào, nên nếu việc bày bàn làm xáo trộn bên trong một hàng thì số thứ tự sẽ
// đổi theo — một lỗi chỉ hiện ra ở con số trên màn hình, không có ngoại lệ nào để lần.
{
  type Row = QueueCandidate & { id: string; status: string };
  const rows: Row[] = [
    { id: "nha-a1", userId: "a", ownerPref: "mine", ownerWorkerOnline: true, queued: true, status: "queued" },
    { id: "chung-b", userId: "b", ownerPref: "any", ownerWorkerOnline: false, queued: true, status: "queued" },
    { id: "nha-a2", userId: "a", ownerPref: "mine", ownerWorkerOnline: true, queued: true, status: "queued" },
    { id: "chung-c", userId: "c", ownerPref: "sect", ownerWorkerOnline: false, queued: true, status: "queued" },
    { id: "nha-d", userId: "d", ownerPref: "mine", ownerWorkerOnline: false, queued: true, status: "queued" },
  ];
  const slotOf = (list: readonly Row[]) => {
    const slots = assignQueueSlots(list, true);
    return new Map(list.map((row, index) => [row.id, `${slots[index].pool}#${slots[index].position}`]));
  };

  const before = slotOf(rows);
  const after = slotOf(
    orderQueueRows(rows, (row) => ({
      finished: row.status === "stopped" || row.status === "failed",
      ownerPref: row.ownerPref,
    })),
  );
  check(
    "xếp lại bảng rồi đánh số vẫn ra ĐÚNG từng con số cũ",
    [...before].every(([id, slot]) => after.get(id) === slot),
    JSON.stringify({ before: [...before], after: [...after] }),
  );
  check(
    "…cụ thể: hàng chung 1,2 và mỗi chủ máy nhà đếm riêng từ 1",
    after.get("chung-b") === "sect#1" &&
      after.get("chung-c") === "sect#2" &&
      after.get("nha-a1") === "own#1" &&
      after.get("nha-a2") === "own#2" &&
      after.get("nha-d") === "own#1",
    JSON.stringify([...after]),
  );
}

// ---- AI ĐANG ĐẢM NHẬN MỘT DÒNG (describeAssignment) ----------------------------------------
//
// Nhãn này đứng ở đuôi MỌI dòng còn sống, nên nó là câu trả lời người ta đọc nhiều nhất trên
// bảng. Cái sai của nó không kêu: một dòng đang nghỉ mà đeo nhãn như thể đã có máy cầm thì
// người đọc tưởng đàn đã được đặt chỗ — đúng cái bản 0.83.0 phải đi vá.
{
  const held = (workerKind: "sect" | "personal", workerId: string | null) =>
    describeAssignment({ workerKind, workerId, ownerPref: "any", finished: false });
  const waiting = (ownerPref: string) =>
    describeAssignment({ workerKind: null, workerId: null, ownerPref, finished: false });

  // ĐANG CẦM — sự kiện. Không bao giờ mang cờ `planned`.
  check("tông môn kèm tên máy khi được phép biết", held("sect", "tong-mon-khoiloi")?.label === "tông môn · tong-mon-khoiloi");
  check("giấu tên máy thì vẫn nói được HẠNG", held("sect", null)?.label === "tông môn");
  check("máy nhà có tên thì hiện tên", held("personal", "may-nha-cua-ai-do")?.label === "may-nha-cua-ai-do");
  check("máy nhà của người khác: chỉ hiện hạng", held("personal", null)?.label === "máy nhà");
  check("đang cầm KHÔNG phải dự định", held("sect", null)?.planned === false);
  check("…cả hai hạng đều vậy", held("personal", null)?.planned === false);

  // CHƯA AI CẦM — dự định, suy từ lựa chọn của chủ đàn.
  check("đàn chỉ giao tông môn", waiting("sect")?.label === "chờ tông môn");
  check("đàn chỉ giao máy nhà", waiting("mine")?.label === "chờ máy nhà");
  check("đàn ai rảnh cũng được", waiting("any")?.label === "chờ máy nào rảnh");
  check("chưa ai cầm thì phải mang cờ dự định", waiting("mine")?.planned === true);
  check("…và luôn mở đầu bằng chữ『chờ』", waiting("sect")!.label.startsWith("chờ"));

  // FAIL-OPEN: chuỗi lạ đọc như `any` — cùng lối `queuePoolOf` và `mayServe`. Đọc theo chiều
  // ngược lại là nhốt đàn vào một hàng riêng không máy nào của chủ nó trực.
  check("giá trị lạ đọc như『ai rảnh cũng được』", waiting("khong-ai-biet")?.label === "chờ máy nào rảnh");
  check("thiếu hẳn lựa chọn cũng vậy", normalizeOwnerPref(null) === "any");
  check("hai giá trị biết trước giữ nguyên", normalizeOwnerPref("mine") === "mine" && normalizeOwnerPref("sect") === "sect");

  // ĐÀN ĐÃ TẮT — không ai đảm nhận NỮA. Gán cho nó một câu『chờ …』là hứa một lượt chạy sẽ
  // không bao giờ tới; dòng ấy chỉ đang nán lại để có chỗ bấm Bắt Đầu.
  check("dòng đã tắt: KHÔNG nhãn nào cả", describeAssignment({ workerKind: null, workerId: null, ownerPref: "sect", finished: true }) === null);
  check("…kể cả khi cột worker của nó còn sót tên một cái máy", describeAssignment({ workerKind: "sect", workerId: "x", ownerPref: "any", finished: true }) === null);

  // Mỗi nhãn phải có câu đầy đủ đi kèm: chỗ duy nhất còn nói dài được là `title`.
  check("mọi nhãn đều kèm một câu đầy đủ cho title", [held("sect", null), held("personal", null), waiting("sect"), waiting("mine"), waiting("any")].every(
      (view) => (view?.title.length ?? 0) > 20,
    ));
}
console.log(`\n✔ Xếp chỗ hàng đợi: ${checks} khẳng định, tất cả đứng vững.`);
