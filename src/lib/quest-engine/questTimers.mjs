/**
 * Bản worker của luật lịch hẹn. Danh sách key phải khớp src/lib/questTimers.ts.
 */
export const QUEST_TIMER_KEYS = [
  "meCung",
  "diemDanh",
  "hoangVuc",
  "phucLoiDuong",
  "thiLuyen",
  "biCanh",
  "teLe",
  "phucLoiVip",
  "vongQuay",
  "vanDap",
  "hySuDuong",
  "phanThuongHoatDong",
  "luyenDan",
  "khoangMach",
];

const QUEST_NAME_TO_TIMER_KEY = new Map([
  ["Mê Cung", "meCung"],
  ["Điểm Danh", "diemDanh"],
  ["Hoang Vực", "hoangVuc"],
  ["Phúc Lợi Đường", "phucLoiDuong"],
  ["Thí Luyện Tông Môn", "thiLuyen"],
  ["Bí Cảnh Tông Môn", "biCanh"],
  ["Tế Lễ Tông Môn", "teLe"],
  ["Phúc Lợi VIP — Khắc Trận Văn", "phucLoiVip"],
  ["Vòng Quay Phúc Vận", "vongQuay"],
  ["Vấn Đáp", "vanDap"],
  ["Hỷ Sự Đường", "hySuDuong"],
  ["Phần Thưởng Hoạt Động", "phanThuongHoatDong"],
  ["Luyện Đan Đường", "luyenDan"],
  ["Khoáng Mạch", "khoangMach"],
]);

const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const secondOfDay = (timer) =>
  Number(timer?.hour) * 3600 + Number(timer?.minute) * 60 + Number(timer?.second);

function vietnamSecondOfDay(at) {
  const shifted = new Date(at.getTime() + VN_OFFSET_MS);
  return shifted.getUTCHours() * 3600 + shifted.getUTCMinutes() * 60 + shifted.getUTCSeconds();
}

function timerQuestEnabled(config, key) {
  const quests = config?.quests ?? {};
  if (key === "luyenDan") return quests.luyenDan?.enabled === true || quests.luyenDanThuong?.enabled === true;
  if (key === "khoangMach") return quests.khoangMach?.enabled === true || quests.khoangMachThuong?.enabled === true;
  return quests[key]?.enabled === true;
}

function validTimers(config) {
  const timers = Array.isArray(config?.questTimers) ? config.questTimers : [];
  return timers.filter((timer) =>
    QUEST_TIMER_KEYS.includes(timer?.questKey) && timerQuestEnabled(config, timer.questKey));
}

/** Trước HH:MM:SS thì quest có lịch bị gác; từ mốc đó tới hết ngày thì chạy như flow cũ. */
export function applyQuestTimerGates(profile, config, at = new Date()) {
  const timers = validTimers(config);
  if (timers.length === 0) return profile;

  const scheduled = new Map(timers.map((timer) => [timer.questKey, timer]));
  const nowSecond = vietnamSecondOfDay(at);

  for (const quest of profile?.quests ?? []) {
    const key = QUEST_NAME_TO_TIMER_KEY.get(quest?.name);
    const timer = key ? scheduled.get(key) : null;
    if (timer && nowSecond < secondOfDay(timer)) quest.enabled = false;
  }
  return profile;
}

/** Số giây tới lần kích hoạt kế tiếp của một quest đang bật. */
export function secondsUntilNextQuestTimer(config, at = new Date()) {
  const timers = validTimers(config);
  if (timers.length === 0) return null;

  const shifted = new Date(at.getTime() + VN_OFFSET_MS);
  const y = shifted.getUTCFullYear();
  const m = shifted.getUTCMonth();
  const d = shifted.getUTCDate();
  let best = Number.POSITIVE_INFINITY;

  for (const timer of timers) {
    let target = Date.UTC(y, m, d, Number(timer.hour) - 7, Number(timer.minute), Number(timer.second));
    if (target <= at.getTime()) target += DAY_MS;
    if (target < best) best = target;
  }

  return Number.isFinite(best) ? Math.max(1, Math.ceil((best - at.getTime()) / 1000)) : null;
}
