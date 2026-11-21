import { z } from "zod";
import { MAX_QUEST_SCHEDULE_RULES, MAX_QUEST_SCHEDULE_WINDOWS, QUEST_SCHEDULE_OPTIONS,
  normalizeQuestSchedules } from "@/lib/quest-engine/questSchedules.mjs";

const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Giờ phải có dạng HH:MM từ 00:00 đến 23:59.");
const windowSchema = z.object({ start: clock, end: clock }).strict().refine(
  value => value.start !== value.end,
  { message: "Giờ bắt đầu và kết thúc phải khác nhau. Tắt giới hạn nếu muốn cho phép cả ngày.", path: ["end"] },
);
export const questScheduleRuleSchema = z.object({
  questKey: z.enum(QUEST_SCHEDULE_OPTIONS.map(option => option.key), { error: "Quest không hợp lệ." }),
  enabled: z.boolean(),
  windows: z.array(windowSchema).max(MAX_QUEST_SCHEDULE_WINDOWS, "Mỗi quest có tối đa 8 khung giờ."),
}).strict().superRefine((rule, ctx) => {
  if (rule.enabled && rule.windows.length === 0) ctx.addIssue({
    code: "custom", path: ["windows"], message: "Thêm ít nhất một khung giờ cho quest đang giới hạn.",
  });
});
export const questSchedulesSchema = z.array(questScheduleRuleSchema)
  .max(MAX_QUEST_SCHEDULE_RULES, "Danh sách lịch Quest vượt giới hạn.")
  .superRefine((rules, ctx) => {
    const seen = new Set<string>();
    rules.forEach((rule, index) => {
      if (seen.has(rule.questKey)) ctx.addIssue({
        code: "custom", path: [index, "questKey"], message: "Mỗi quest chỉ có một mục hẹn giờ; thêm khung giờ trong mục đã có.",
      });
      seen.add(rule.questKey);
    });
  });
export type QuestScheduleRule = z.infer<typeof questScheduleRuleSchema>;

/** Persisted corruption must never silently open restricted quests. */
export const storedQuestSchedulesSchema = z.unknown().transform(normalizeQuestSchedules).default([]);

export function parseQuestSchedules(input: unknown):
  { ok: true; value: QuestScheduleRule[] } | { ok: false; message: string } {
  const parsed = questSchedulesSchema.safeParse(input);
  return parsed.success
    ? { ok: true, value: parsed.data }
    : { ok: false, message: parsed.error.issues[0]?.message ?? "Lịch Quest không hợp lệ." };
}

/** Safe administrator-facing rollout error; never expose a database exception. */
export class QuestScheduleLegacyJobsError extends Error {
  constructor() {
    super("Còn lượt auto đang chạy trên worker phiên bản cũ. Hãy chờ các lượt đó hoàn tất và cập nhật worker rồi lưu lại lịch Quest; hệ thống không tự dừng lượt đang chạy.");
    this.name = "QuestScheduleLegacyJobsError";
  }
}
