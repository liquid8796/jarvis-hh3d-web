/**
 * Global daily quest availability. This file is shared by web and frozen workers.
 * IDs, never translated labels, bind VIP/free variants to the same admin policy.
 */
/** @typedef {{questKey:string, enabled:boolean, windows:Array<{start:string,end:string}>}} QuestScheduleRule */
/** @typedef {{allowed:boolean,nextOpenAt:number|null,closesAt:number|null,message:string,nowMs:number}} QuestScheduleState */
export const QUEST_SCHEDULE_OPTIONS = [
  { key: "meCung", name: "Mê Cung", questIds: ["me-cung", "me-cung-thuong"], configKeys: ["meCung"] },
  { key: "diemDanh", name: "Điểm Danh", questIds: ["diem-danh", "diem-danh-thuong"], configKeys: ["diemDanh"] },
  { key: "hoangVuc", name: "Hoang Vực", questIds: ["hoang-vuc", "hoang-vuc-thuong"], configKeys: ["hoangVuc"] },
  { key: "phucLoiDuong", name: "Phúc Lợi Đường", questIds: ["phuc-loi-duong", "phuc-loi-duong-thuong"], configKeys: ["phucLoiDuong"] },
  { key: "thiLuyen", name: "Thí Luyện Tông Môn", questIds: ["thi-luyen-tong-mon", "thi-luyen-tong-mon-thuong"], configKeys: ["thiLuyen"] },
  { key: "biCanh", name: "Bí Cảnh Tông Môn", questIds: ["bi-canh-tong-mon", "bi-canh-tong-mon-thuong"], configKeys: ["biCanh"] },
  { key: "teLe", name: "Tế Lễ Tông Môn", questIds: ["te-le-tong-mon", "te-le-tong-mon-thuong"], configKeys: ["teLe"] },
  { key: "phucLoiVip", name: "Phúc Lợi VIP — Khắc Trận Văn", questIds: ["phuc-loi-vip-khac-tran-van"], configKeys: ["phucLoiVip"] },
  { key: "vongQuay", name: "Vòng Quay Phúc Vận", questIds: ["vong-quay-phuc-van", "vong-quay-phuc-van-thuong"], configKeys: ["vongQuay"] },
  { key: "vanDap", name: "Vấn Đáp", questIds: ["van-dap", "van-dap-thuong"], configKeys: ["vanDap"] },
  { key: "hySuDuong", name: "Hỷ Sự Đường", questIds: ["hy-su-duong", "hy-su-duong-thuong"], configKeys: ["hySuDuong"] },
  { key: "phanThuongHoatDong", name: "Phần Thưởng Hoạt Động", questIds: ["phan-thuong-hoat-dong", "phan-thuong-hoat-dong-thuong"], configKeys: ["phanThuongHoatDong"] },
  { key: "luyenDan", name: "Luyện Đan Đường", questIds: ["luyen-dan-duong", "luyen-dan-duong-thuong"], configKeys: ["luyenDan", "luyenDanThuong"] },
  { key: "khoangMach", name: "Khoáng Mạch", questIds: ["khoang-mach", "khoang-mach-thuong"], configKeys: ["khoangMach", "khoangMachThuong"] },
  { key: "cauCa", name: "Câu Cá", questIds: ["cau-ca", "cau-ca-thuong"], configKeys: ["cauCa"] },
];
export const MAX_QUEST_SCHEDULE_WINDOWS = 8;
export const MAX_QUEST_SCHEDULE_RULES = QUEST_SCHEDULE_OPTIONS.length;
export const QUEST_SCHEDULE_TIME_ZONE = "Asia/Ho_Chi_Minh";
const KEYS = new Set(QUEST_SCHEDULE_OPTIONS.map(q => q.key));
const DAY_MS = 86_400_000;
const VN_OFFSET_MS = 25_200_000;
const clock = /^([01]\d|2[0-3]):[0-5]\d$/;
const clockMinute = value => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
const closedRule = key => ({ questKey: key, enabled: true, windows: [] });
const closedAll = () => QUEST_SCHEDULE_OPTIONS.map(q => closedRule(q.key));

function validWindows(windows) {
  return Array.isArray(windows) && windows.length <= MAX_QUEST_SCHEDULE_WINDOWS &&
    windows.every(w => w && typeof w.start === "string" && typeof w.end === "string" &&
      clock.test(w.start) && clock.test(w.end) && w.start !== w.end);
}

/**
 * Legacy absence is unrestricted. Corrupt known entries close just that quest;
 * an unidentifiable/corrupt root closes all quests rather than discarding policy.
 * @param {unknown} value
 * @returns {QuestScheduleRule[]}
 */
export function normalizeQuestSchedules(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_QUEST_SCHEDULE_RULES ||
      value.some(rule => !rule || !KEYS.has(rule.questKey))) return closedAll();
  const counts = new Map();
  for (const rule of value) counts.set(rule.questKey, (counts.get(rule.questKey) ?? 0) + 1);
  const seen = new Set();
  return value.flatMap(rule => {
    if (seen.has(rule.questKey)) return [];
    seen.add(rule.questKey);
    if (counts.get(rule.questKey) !== 1 || typeof rule.enabled !== "boolean" ||
        !validWindows(rule.windows) || (rule.enabled && rule.windows.length === 0)) {
      return [closedRule(rule.questKey)];
    }
    return [{ questKey: rule.questKey, enabled: rule.enabled,
      windows: rule.windows.map(w => ({ start: w.start, end: w.end })) }];
  });
}

const unrestricted = nowMs => ({ allowed: true, nextOpenAt: null, closesAt: null, message: "", nowMs });
const denied = (nowMs, nextOpenAt = null, message = "Ngoài khung giờ Quest do admin cho phép (UTC+7).") =>
  ({ allowed: false, nextOpenAt, closesAt: null, message, nowMs });

/** @returns {QuestScheduleState} */
function evaluate(rules, questId, nowMs) {
  if (!Number.isFinite(nowMs)) return denied(nowMs, null, "Chưa xác định được giờ máy chủ để kiểm tra lịch Quest.");
  const option = QUEST_SCHEDULE_OPTIONS.find(q => q.key === questId || q.questIds.includes(questId));
  const rule = option && rules.find(r => r.questKey === option.key);
  if (!rule?.enabled) return unrestricted(nowMs);
  if (rule.windows.length === 0) return denied(nowMs, null, "Lịch Quest không hợp lệ; chờ admin cập nhật.");
  const dayStart = Math.floor((nowMs + VN_OFFSET_MS) / DAY_MS) * DAY_MS - VN_OFFSET_MS;
  const spans = [];
  const dailyCoverage = [];
  for (const window of rule.windows) {
    const start = clockMinute(window.start);
    const end = clockMinute(window.end);
    if (end > start) dailyCoverage.push([start, end]);
    else dailyCoverage.push([start, 1440], [0, end]);
    for (const shift of [-1, 0, 1, 2]) {
      const begin = dayStart + shift * DAY_MS + start * 60_000;
      spans.push([begin, dayStart + shift * DAY_MS + (end > start ? end : end + 1440) * 60_000]);
    }
  }
  const merge = ranges => {
    const out = [];
    for (const span of ranges.sort((a, b) => a[0] - b[0])) {
      const last = out.at(-1);
      if (last && span[0] <= last[1]) last[1] = Math.max(last[1], span[1]);
      else out.push([...span]);
    }
    return out;
  };
  const fullDay = merge(dailyCoverage).some(([start, end]) => start === 0 && end === 1440);
  if (fullDay) return unrestricted(nowMs);
  const merged = merge(spans);
  const current = merged.find(([start, end]) => start <= nowMs && nowMs < end);
  if (current) return { ...unrestricted(nowMs), closesAt: current[1] };
  const next = merged.find(([start]) => start > nowMs);
  return denied(nowMs, next?.[0] ?? null);
}

/** @returns {QuestScheduleState} */
export function questScheduleState(rules, questId, at = new Date()) {
  return evaluate(normalizeQuestSchedules(rules), questId, at.getTime());
}

/** Return a transport copy; never persist admin gates into user preferences. */
export function applyQuestScheduleGates(config, rules, at = new Date()) {
  const copy = structuredClone(config);
  const normalized = normalizeQuestSchedules(rules);
  for (const option of QUEST_SCHEDULE_OPTIONS) {
    if (evaluate(normalized, option.questIds[0], at.getTime()).allowed) continue;
    for (const key of option.configKeys) {
      if (copy?.quests?.[key]) copy.quests[key].enabled = false;
    }
  }
  return copy;
}

/** Earliest upcoming opening among blocked, user-enabled quests; seconds from now. */
export function secondsUntilNextQuestSchedule(config, rules, at = new Date()) {
  const normalized = normalizeQuestSchedules(rules);
  let next = Infinity;
  for (const option of QUEST_SCHEDULE_OPTIONS) {
    if (!option.configKeys.some(key => config?.quests?.[key]?.enabled === true)) continue;
    const state = evaluate(normalized, option.questIds[0], at.getTime());
    if (!state.allowed && state.nextOpenAt !== null) next = Math.min(next, state.nextOpenAt);
  }
  return Number.isFinite(next) ? Math.max(1, Math.ceil((next - at.getTime()) / 1000)) : null;
}

/**
 * A live worker uses server time advanced by a monotonic clock. Wall-clock changes
 * cannot reopen a window, expired snapshots deny all quests until refreshed.
 * @param {unknown} rules
 * @param {{now?:()=>number,monotonicNow?:()=>number,maxStaleMs?:number,serverTimeMs?:number,uncertaintyMs?:number}} [options]
 */
export function createQuestScheduleGate(rules, options = {}) {
  const now = options.now ?? Date.now;
  const monotonicNow = options.monotonicNow ?? (() => performance.now());
  const maxStaleMs = options.maxStaleMs ?? Infinity;
  let current = normalizeQuestSchedules(rules);
  let receivedTick = monotonicNow();
  let serverTime = Number.isFinite(options.serverTimeMs) ? options.serverTimeMs : null;
  let newestServerTime = serverTime;
  const uncertaintyOf = value => value === undefined ? 0 :
    Number.isFinite(value) && value >= 0 ? value : Infinity;
  let uncertaintyMs = uncertaintyOf(options.uncertaintyMs);
  const clockNow = () => serverTime === null ? now() : serverTime + Math.max(0, monotonicNow() - receivedTick);
  return {
    /** @param {unknown} nextRules @param {{serverTimeMs?:number,uncertaintyMs?:number}} [snapshot] */
    update(nextRules, snapshot = {}) {
      const incoming = Number.isFinite(snapshot.serverTimeMs) ? snapshot.serverTimeMs : null;
      if (incoming !== null && newestServerTime !== null && incoming < newestServerTime) return false;
      // A live server-calibrated gate cannot be refreshed by an unversioned reply.
      if (serverTime !== null && incoming === null) return false;
      current = normalizeQuestSchedules(nextRules);
      uncertaintyMs = uncertaintyOf(snapshot.uncertaintyMs);
      receivedTick = monotonicNow();
      if (incoming !== null) serverTime = newestServerTime = incoming;
      return true;
    },
    /** @returns {QuestScheduleState} */
    state(questId) {
      const elapsed = monotonicNow() - receivedTick;
      const nowMs = clockNow();
      if (!Number.isFinite(elapsed) || !Number.isFinite(uncertaintyMs) || elapsed < 0 || elapsed + uncertaintyMs > maxStaleMs) {
        return denied(nowMs, null, "Chưa nhận được lịch Quest mới từ máy chủ; tạm chờ đồng bộ.");
      }
      const state = evaluate(current, questId, nowMs);
      if (!state.allowed) return state;
      // RTT bounds the server's possible progress while the response travelled.
      // Open with the lower clock bound; close with its conservative upper bound.
      if (state.closesAt !== null && nowMs + uncertaintyMs >= state.closesAt) {
        return denied(nowMs, evaluate(current, questId, state.closesAt).nextOpenAt);
      }
      const windowDeadline = state.closesAt === null ? Infinity : state.closesAt - uncertaintyMs;
      const freshnessDeadline = nowMs + Math.max(0, maxStaleMs - elapsed - uncertaintyMs);
      const deadline = Math.min(windowDeadline, freshnessDeadline);
      state.closesAt = Number.isFinite(deadline) ? deadline : null;
      return state;
    },
  };
}
