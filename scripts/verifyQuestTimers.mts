import assert from "node:assert/strict";
import {
  QUEST_TIMER_KEYS as WEB_KEYS,
  nextQuestTimerActivationAt,
  questTimerWakeAfterEdit,
} from "../src/lib/questTimers";
import {
  QUEST_TIMER_KEYS as WORKER_KEYS,
  applyQuestTimerGates,
  secondsUntilNextQuestTimer,
} from "../src/lib/quest-engine/questTimers.mjs";
import { isDailyQuotaQuest } from "../src/lib/quest-engine/dailyQuota.mjs";

let passed = 0;
const check = (name: string, fn: () => void) => {
  fn();
  passed += 1;
  console.log("✓", name);
};

const timer = { questKey: "hoangVuc" as const, hour: 12, minute: 34, second: 56 };
const baseConfig = {
  questTimers: [timer],
  quests: {
    hoangVuc: { enabled: true },
  },
};

check("Web và worker biết cùng đúng bộ quest có thể hẹn", () => {
  assert.deepEqual(WORKER_KEYS, WEB_KEYS);
});

check("12:34:56 giờ Việt Nam đổi thành đúng 05:34:56Z", () => {
  const next = nextQuestTimerActivationAt([timer], new Date("2026-09-20T05:34:00.000Z"));
  assert.equal(next?.toISOString(), "2026-09-20T05:34:56.000Z");
});

check("worker tính đúng 56 giây tới mốc hẹn", () => {
  assert.equal(
    secondsUntilNextQuestTimer(baseConfig, new Date("2026-09-20T05:34:00.000Z")),
    56,
  );
});

check("trước giờ hẹn, cả twin Hoang Vực VIP + thường đều bị gác", () => {
  const profile = {
    quests: [
      { id: "hoang-vuc", name: "Hoang Vực", enabled: true, requiresVip: true },
      { id: "hoang-vuc-thuong", name: "Hoang Vực", enabled: true, requiresVip: false },
      { id: "van-dap", name: "Vấn Đáp", enabled: true, requiresVip: true },
    ],
  };
  applyQuestTimerGates(profile, baseConfig, new Date("2026-09-20T05:34:55.000Z"));
  assert.equal(profile.quests[0].enabled, false);
  assert.equal(profile.quests[1].enabled, false);
  assert.equal(profile.quests[2].enabled, true);
});

check("đúng giây hẹn, cả twin mở lại flow cũ", () => {
  const profile = {
    quests: [
      { id: "hoang-vuc", name: "Hoang Vực", enabled: true, requiresVip: true },
      { id: "hoang-vuc-thuong", name: "Hoang Vực", enabled: true, requiresVip: false },
    ],
  };
  applyQuestTimerGates(profile, baseConfig, new Date("2026-09-20T05:34:56.000Z"));
  assert.equal(profile.quests[0].enabled, true);
  assert.equal(profile.quests[1].enabled, true);
  assert.equal(isDailyQuotaQuest(profile.quests[0]), true);
  assert.equal(isDailyQuotaQuest(profile.quests[1]), true);
});

check("hub daily-cap không bị lịch đổi ID/phạm vi", () => {
  assert.equal(isDailyQuotaQuest({ id: "hoang-vuc" }), true);
  assert.equal(isDailyQuotaQuest({ id: "hoang-vuc-thuong" }), true);
});

check("quest đang tắt thì lịch không tự bật và không đánh thức worker", () => {
  const disabled = {
    ...baseConfig,
    quests: { hoangVuc: { enabled: false } },
  };
  const profile = { quests: [{ id: "hoang-vuc", name: "Hoang Vực", enabled: false }] };
  applyQuestTimerGates(profile, disabled, new Date("2026-09-20T05:34:56.000Z"));
  assert.equal(profile.quests[0].enabled, false);
  assert.equal(secondsUntilNextQuestTimer(disabled, new Date("2026-09-20T05:34:00.000Z")), null);
});

check("mốc đã qua hôm nay thì lần kích hoạt kế là ngày mai", () => {
  const next = nextQuestTimerActivationAt([timer], new Date("2026-09-20T05:35:00.000Z"));
  assert.equal(next?.toISOString(), "2026-09-21T05:34:56.000Z");
});

check("sửa lịch sau mốc hôm nay đánh thức đàn queued ngay", () => {
  const at = new Date("2026-09-20T06:00:00.000Z");
  assert.equal(questTimerWakeAfterEdit([timer], at)?.toISOString(), at.toISOString());
});

console.log(`✔ Hẹn giờ quest: ${passed} phép kiểm đều đứng vững.`);
