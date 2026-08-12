#!/usr/bin/env node
/**
 * Kiểm chứng PHÉP XẾP CHỖ của bảng Hàng Đợi — `assignQueueSlots` trong services/queue.ts.
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
import { assignQueueSlots, type QueueCandidate } from "../src/lib/services/queue";

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

console.log(`\n✔ Xếp chỗ hàng đợi: ${checks} khẳng định, tất cả đứng vững.`);
