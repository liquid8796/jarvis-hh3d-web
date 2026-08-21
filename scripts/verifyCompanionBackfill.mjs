#!/usr/bin/env node
/** Luật thuần cho lượt bù kho phụ — không mạng, không database, không `gh`. */
import {
  avoidNamesFor,
  deficitOf,
  emptyCompanionEntry,
  planStations,
  withCreatedCompanions,
} from "./companionBackfillPlan.mjs";

let count = 0;
const check = (condition, message) => {
  count += 1;
  if (!condition) throw new Error(message);
  console.log(`✔ ${message}`);
};

const companion = (repo) => ({ repo, lastNurtureDay: null, pushesToday: 0, lastPushAt: null, lastPushOk: null, lastPushNote: "" });
const station = (over = {}) => ({
  owner: "acct",
  repo: "cobalt-relay-0000000000000000",
  workflowFile: "linh-su.yml",
  workerId: "cobalt-relay-0000000000000000",
  pat: "v1.xxx",
  enabled: true,
  companionRepos: [],
  ...over,
});

// ---- deficitOf: 0/1/2, không bao giờ âm ---------------------------------------------------------
check(deficitOf(station({ companionRepos: [] })) === 2, "không kho phụ nào → thiếu 2");
check(deficitOf(station({ companionRepos: [companion("a")] })) === 1, "một kho phụ → thiếu 1");
check(deficitOf(station({ companionRepos: [companion("a"), companion("b")] })) === 0, "đủ hai → thiếu 0");
check(deficitOf(station({ companionRepos: [companion("a"), companion("b"), companion("c")] })) === 0, "ba kho phụ (rác) vẫn kẹp về 0, không âm");
check(deficitOf({ owner: "x", repo: "y" }) === 2, "vắng hẳn companionRepos → coi như thiếu 2");

// ---- emptyCompanionEntry: đúng hình dạng schema, mọi trường quan sát để trống -------------------
{
  const entry = emptyCompanionEntry("garnet-mill-1111111111111111");
  check(entry.repo === "garnet-mill-1111111111111111", "entry giữ đúng tên repo");
  check(
    entry.lastNurtureDay === null && entry.pushesToday === 0 && entry.lastPushAt === null &&
      entry.lastPushOk === null && entry.lastPushNote === "",
    "entry mới để trống mọi trường quan sát — vòng nuôi kế nhận là tới hạn",
  );
}

// ---- avoidNamesFor: gom repo chính + workerId + kho phụ đã có, hạ thường, không trùng ----------
{
  const avoid = avoidNamesFor(station({
    repo: "Cobalt-Relay-AAAA",
    workerId: "Cobalt-Relay-AAAA",
    companionRepos: [companion("Garnet-Mill-BBBB")],
  }));
  check(avoid.includes("cobalt-relay-aaaa"), "tránh tên kho chính (đã hạ thường)");
  check(avoid.includes("garnet-mill-bbbb"), "tránh tên kho phụ đã có");
  check(avoid.length === 2, "repo trùng workerId chỉ tính một lần trong danh sách tránh");
}

// ---- planStations: chia phải-bù / bỏ-qua đúng ---------------------------------------------------
{
  const stations = [
    station({ owner: "a", repo: "empty-one-0000000000000000", companionRepos: [] }),
    station({ owner: "b", repo: "half-two-1111111111111111", companionRepos: [companion("x")] }),
    station({ owner: "c", repo: "full-three-2222222222222222", companionRepos: [companion("x"), companion("y")] }),
  ];
  const plan = planStations(stations, null);
  check(plan.error === null, "sổ hợp lệ không có lỗi");
  check(plan.targets.length === 2, "hai kho thiếu vào danh sách phải bù");
  check(plan.targets.find((t) => t.slug === "a/empty-one-0000000000000000").need === 2, "kho rỗng cần 2");
  check(plan.targets.find((t) => t.slug === "b/half-two-1111111111111111").need === 1, "kho có một cần 1");
  check(
    plan.targets.find((t) => t.slug === "b/half-two-1111111111111111").avoid.includes("x"),
    "kho phụ đã có ('x') nằm trong danh sách tránh của kho cần bù",
  );
  check(
    plan.skipped.some((s) => s.slug === "c/full-three-2222222222222222" && s.reason === "đã đủ hai kho phụ"),
    "kho đủ hai bị bỏ qua với đúng lý do",
  );
}

// ---- planStations --repo: chỉ kho được nêu, và tên lạ là LỖI -----------------------------------
{
  const stations = [
    station({ owner: "a", repo: "empty-one-0000000000000000", companionRepos: [] }),
    station({ owner: "b", repo: "empty-two-1111111111111111", companionRepos: [] }),
  ];
  const one = planStations(stations, "empty-two-1111111111111111");
  check(
    one.error === null && one.targets.length === 1 && one.targets[0].slug === "b/empty-two-1111111111111111",
    "--repo giới hạn đúng một kho",
  );
  check(
    one.skipped.some((s) => s.slug === "a/empty-one-0000000000000000" && s.reason === "không nằm trong --repo"),
    "kho ngoài --repo bị bỏ qua với lý do riêng",
  );
  check(planStations(stations, "EMPTY-TWO-1111111111111111").targets.length === 1, "--repo khớp không phân biệt hoa thường");
  const missing = planStations(stations, "khong-co-trong-so");
  check(missing.error !== null && missing.targets.length === 0, "--repo trỏ tên lạ là lỗi, không phải im lặng");
}

// ---- withCreatedCompanions: giữ cái cũ, thêm cái mới, KẸP về hai --------------------------------
{
  const merged0 = withCreatedCompanions([], ["new-a-0000000000000000", "new-b-1111111111111111"]);
  check(merged0.length === 2 && merged0[0].repo === "new-a-0000000000000000", "0 + 2 → hai, đúng thứ tự");

  const merged1 = withCreatedCompanions([companion("old-x-2222222222222222")], ["new-y-3333333333333333"]);
  check(
    merged1.length === 2 && merged1[0].repo === "old-x-2222222222222222" && merged1[1].repo === "new-y-3333333333333333",
    "1 + 1 → hai, cái CŨ đứng trước và giữ nguyên trạng thái",
  );
  check(merged1[0].lastPushNote === "", "dòng cũ giữ nguyên mọi trường quan sát, không bị đặt lại");

  // Hàng rào cuối: người gọi lỡ đưa dư thì KẸP về hai, không ghi mảng ba (schema .catch([]) nuốt cả sổ).
  const clamped = withCreatedCompanions([companion("old-1")], ["new-2", "new-3"]);
  check(clamped.length === 2, "không bao giờ ghi quá hai kho phụ, kể cả khi bị gọi sai");
}

console.log(`\n✔ ${count} phép kiểm — luật bù kho phụ đứng vững.`);
