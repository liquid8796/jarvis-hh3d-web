"use client";

import { startTransition, useActionState, useState } from "react";
import { saveQuestSchedulesAction } from "@/app/actions/questSchedules";
import { TimeOfDayInput } from "@/components/TimeOfDayInput";
import {
  MAX_QUEST_SCHEDULE_WINDOWS,
  QUEST_SCHEDULE_OPTIONS,
} from "@/lib/quest-engine/questSchedules.mjs";
import type { QuestScheduleRule } from "@/lib/validation/questSchedules";

const defaultWindow = { start: "08:00", end: "09:00" };

export function QuestScheduleForm({ initialRules }: { initialRules: QuestScheduleRule[] }) {
  const [rules, setRules] = useState(initialRules);
  const [questKey, setQuestKey] = useState("");
  const [editedSinceSubmit, setEditedSinceSubmit] = useState(false);
  const [result, action, pending] = useActionState(saveQuestSchedulesAction, null);

  const availableQuests = QUEST_SCHEDULE_OPTIONS.filter((quest) => !rules.some((rule) => rule.questKey === quest.key));

  function updateRule(key: string, changes: Partial<Pick<QuestScheduleRule, "enabled" | "windows">>) {
    setEditedSinceSubmit(true);
    setRules((current) => current.map((rule) => rule.questKey === key ? { ...rule, ...changes } : rule));
  }

  function addRule() {
    const quest = availableQuests.find((option) => option.key === questKey);
    if (!quest) return;
    setEditedSinceSubmit(true);
    setRules((current) => [...current, { questKey: quest.key, enabled: true, windows: [defaultWindow] }]);
    setQuestKey("");
  }

  return (
    <form
      action={action}
      onSubmit={(event) => {
        // Dispatch manually so React's native form reset leaves the selected times intact.
        event.preventDefault();
        const values = new FormData(event.currentTarget);
        setEditedSinceSubmit(false);
        startTransition(() => action(values));
      }}
      className="card card-hairline max-w-3xl p-4 sm:p-6"
    >
      <h2 className="h-display text-lg font-semibold text-gilded">Lịch Chạy Nhiệm Vụ</h2>
      <p className="mt-2 text-sm text-[var(--color-mist)]">
        Lịch lặp lại hằng ngày theo giờ Việt Nam (UTC+7) và chỉ áp dụng cho môn đồ thường chạy
        Auto trên Khôi Lỗi tông môn. Tài khoản quản trị và các lượt chạy trên Khôi Lỗi cá nhân
        (máy nhà) được miễn giới hạn này.
      </p>
      <p className="mt-1 text-sm text-[var(--color-mist)]">
        Cho phép từ giờ bắt đầu đến trước giờ kết thúc. Giờ kết thúc sớm hơn giờ bắt đầu
        nghĩa là khung giờ kéo dài sang ngày hôm sau. Quest chưa có lịch hoặc đã bỏ chọn
        “Áp dụng lịch” không bị giới hạn giờ ở đây.
      </p>

      <input type="hidden" name="questSchedules" value={JSON.stringify(rules)} />
      <fieldset disabled={pending} className="mt-5 min-w-0 space-y-5">
        {rules.map((rule) => {
          const quest = QUEST_SCHEDULE_OPTIONS.find((option) => option.key === rule.questKey);
          return (
            <fieldset key={rule.questKey} className="min-w-0 rounded-lg border border-white/15 p-3 sm:p-4">
              <legend className="px-1 text-sm font-semibold text-[var(--color-parchment)]">
                {quest?.name ?? rule.questKey}
              </legend>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-[var(--color-parchment)]">
                  <input
                    type="checkbox"
                    checked={rule.enabled}
                    onChange={(event) => updateRule(rule.questKey, { enabled: event.target.checked })}
                    className="h-4 w-4 accent-[var(--color-gold-400)]"
                  />
                  Áp dụng lịch
                </label>
                <button
                  type="button"
                  className="btn btn-ghost text-sm"
                  onClick={() => {
                    setEditedSinceSubmit(true);
                    setRules((current) => current.filter((item) => item.questKey !== rule.questKey));
                  }}
                >
                  Xóa lịch nhiệm vụ
                </button>
              </div>

              <div className="mt-2 space-y-2">
                {rule.windows.map((window, index) => (
                  <div key={index} className="flex flex-wrap items-end gap-2">
                    <TimeOfDayInput
                      className="min-w-0 flex-1"
                      label={`Bắt đầu ${index + 1}`}
                      value={window.start}
                      onChange={(start) => updateRule(rule.questKey, {
                        windows: rule.windows.map((item, itemIndex) => itemIndex === index ? { ...item, start } : item),
                      })}
                    />
                    <TimeOfDayInput
                      className="min-w-0 flex-1"
                      label={`Kết thúc ${index + 1}`}
                      value={window.end}
                      onChange={(end) => updateRule(rule.questKey, {
                        windows: rule.windows.map((item, itemIndex) => itemIndex === index ? { ...item, end } : item),
                      })}
                    />
                    <button
                      type="button"
                      aria-label={`Xóa khung giờ ${index + 1}`}
                      className="btn btn-ghost min-h-11 text-xs"
                      style={{ paddingInline: "0.625rem" }}
                      disabled={rule.windows.length === 1}
                      onClick={() => updateRule(rule.questKey, {
                        windows: rule.windows.filter((_, itemIndex) => itemIndex !== index),
                      })}
                    >
                      Xóa
                    </button>
                  </div>
                ))}
              </div>
              <button
                type="button"
                className="btn btn-ghost mt-3 text-sm"
                disabled={rule.windows.length >= MAX_QUEST_SCHEDULE_WINDOWS}
                onClick={() => updateRule(rule.questKey, { windows: [...rule.windows, defaultWindow] })}
              >
                Thêm khung giờ
              </button>
            </fieldset>
          );
        })}

        {availableQuests.length > 0 && (
          <div className="flex flex-wrap items-end gap-3">
            <label className="min-w-0 flex-1 text-sm text-[var(--color-parchment)]">
              Chọn nhiệm vụ
              <select
                value={questKey}
                onChange={(event) => setQuestKey(event.target.value)}
                className="input mt-1 min-h-11 w-full"
              >
                <option value="">Chọn nhiệm vụ</option>
                {availableQuests.map((quest) => <option key={quest.key} value={quest.key}>{quest.name}</option>)}
              </select>
            </label>
            <button type="button" className="btn btn-ghost" disabled={!questKey} onClick={addRule}>
              Thêm nhiệm vụ
            </button>
          </div>
        )}

        <button type="submit" className="btn btn-gold" disabled={pending}>
          {pending ? "Đang lưu…" : "Lưu lịch"}
        </button>
      </fieldset>
      {!pending && editedSinceSubmit && <p className="mt-3 text-sm text-[var(--color-mist)]">Có thay đổi chưa lưu.</p>}
      {!pending && !editedSinceSubmit && result && (
        <p role="status" className={`mt-3 text-sm ${result.ok ? "text-[var(--color-jade-300)]" : "text-[#f2a0a0]"}`}>
          {result.message}
        </p>
      )}
    </form>
  );
}
