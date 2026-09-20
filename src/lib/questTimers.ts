/**
 * Lịch hẹn quest của tab Auto. Mỗi quest logic có tối đa một mốc HH:MM:SS mỗi ngày.
 * Một mốc áp cho cả twin VIP/thường. Game reset ngày theo giờ Việt Nam nên lịch dùng UTC+7.
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
] as const;

export type QuestTimerKey = (typeof QUEST_TIMER_KEYS)[number];

export type QuestTimer = {
  questKey: QuestTimerKey;
  hour: number;
  minute: number;
  second: number;
};

export const QUEST_TIMER_OPTIONS: ReadonlyArray<{ key: QuestTimerKey; name: string }> = [
  { key: "meCung", name: "Mê Cung" },
  { key: "diemDanh", name: "Điểm Danh" },
  { key: "hoangVuc", name: "Hoang Vực" },
  { key: "phucLoiDuong", name: "Phúc Lợi Đường" },
  { key: "thiLuyen", name: "Thí Luyện Tông Môn" },
  { key: "biCanh", name: "Bí Cảnh Tông Môn" },
  { key: "teLe", name: "Tế Lễ Tông Môn" },
  { key: "phucLoiVip", name: "Phúc Lợi VIP" },
  { key: "vongQuay", name: "Vòng Quay Phúc Vận" },
  { key: "vanDap", name: "Vấn Đáp" },
  { key: "hySuDuong", name: "Hỷ Sự Đường" },
  { key: "phanThuongHoatDong", name: "Phần Thưởng Hoạt Động" },
  { key: "luyenDan", name: "Luyện Đan Đường" },
  { key: "khoangMach", name: "Khoáng Mạch" },
];

const VIETNAM_OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export function timerSecondOfDay(timer: Pick<QuestTimer, "hour" | "minute" | "second">): number {
  return timer.hour * 3600 + timer.minute * 60 + timer.second;
}

export function vietnamSecondOfDay(at: Date = new Date()): number {
  const shifted = new Date(at.getTime() + VIETNAM_OFFSET_MS);
  return shifted.getUTCHours() * 3600 + shifted.getUTCMinutes() * 60 + shifted.getUTCSeconds();
}

export function isQuestTimerActiveToday(timer: QuestTimer, at: Date = new Date()): boolean {
  return vietnamSecondOfDay(at) >= timerSecondOfDay(timer);
}

/** Lịch hẹn không tự bật một quest mà user đã tắt trong Ngọc Giản. */
export function isTimerQuestEnabled(
  config: { quests?: Record<string, { enabled?: boolean }>; questTimers?: QuestTimer[] },
  key: QuestTimerKey,
): boolean {
  const quests = config.quests ?? {};
  if (key === "luyenDan") {
    return quests.luyenDan?.enabled === true || quests.luyenDanThuong?.enabled === true;
  }
  if (key === "khoangMach") {
    return quests.khoangMach?.enabled === true || quests.khoangMachThuong?.enabled === true;
  }
  return quests[key]?.enabled === true;
}

export function enabledQuestTimers(
  config: { quests?: Record<string, { enabled?: boolean }>; questTimers?: QuestTimer[] },
): QuestTimer[] {
  return (config.questTimers ?? []).filter((timer) => isTimerQuestEnabled(config, timer.questKey));
}

/** Mốc kích hoạt kế tiếp; timer đã qua hôm nay trả mốc của ngày mai. */
export function nextQuestTimerActivationAt(timers: readonly QuestTimer[], at: Date = new Date()): Date | null {
  if (timers.length === 0) return null;

  const shifted = new Date(at.getTime() + VIETNAM_OFFSET_MS);
  const year = shifted.getUTCFullYear();
  const month = shifted.getUTCMonth();
  const day = shifted.getUTCDate();

  let best = Number.POSITIVE_INFINITY;
  for (const timer of timers) {
    let target = Date.UTC(year, month, day, timer.hour - 7, timer.minute, timer.second);
    if (target <= at.getTime()) target += DAY_MS;
    if (target < best) best = target;
  }
  return Number.isFinite(best) ? new Date(best) : null;
}

/** Sửa lịch giữa ngày: mốc đã qua nghĩa là cửa sổ chạy đang mở, nên đánh thức job ngay. */
export function questTimerWakeAfterEdit(timers: readonly QuestTimer[], at: Date = new Date()): Date | null {
  if (timers.length === 0) return null;
  if (timers.some((timer) => isQuestTimerActiveToday(timer, at))) return at;
  return nextQuestTimerActivationAt(timers, at);
}

export function formatQuestTimer(timer: Pick<QuestTimer, "hour" | "minute" | "second">): string {
  return [timer.hour, timer.minute, timer.second]
    .map((value) => String(value).padStart(2, "0"))
    .join(":");
}
