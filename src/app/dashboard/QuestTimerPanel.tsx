"use client";

import { useActionState, useRef, useState } from "react";
import { saveQuestTimersAction, type ActionResult } from "@/app/actions/automation";
import {
  QUEST_TIMER_OPTIONS,
  type QuestTimer,
  type QuestTimerKey,
} from "@/lib/questTimers";

type TimerRow = QuestTimer & { rowId: string };

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, Number.isFinite(value) ? Math.trunc(value) : min));

export function QuestTimerPanel({
  initialTimers,
  enabledQuestKeys,
}: {
  initialTimers: QuestTimer[];
  enabledQuestKeys: QuestTimerKey[];
}) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    saveQuestTimersAction,
    null,
  );
  const nextId = useRef(initialTimers.length);
  const [rows, setRows] = useState<TimerRow[]>(() =>
    initialTimers.map((timer, index) => ({ ...timer, rowId: "saved-" + index })),
  );
  const [collapsed, setCollapsed] = useState(false);
  const enabled = new Set(enabledQuestKeys);
  const used = new Set(rows.map((row) => row.questKey));
  const canAdd = rows.length < QUEST_TIMER_OPTIONS.length;

  const update = (rowId: string, patch: Partial<QuestTimer>) => {
    setRows((current) => current.map((row) => (row.rowId === rowId ? { ...row, ...patch } : row)));
  };

  const addTimer = () => {
    const option = QUEST_TIMER_OPTIONS.find((item) => !used.has(item.key));
    if (!option) return;
    const id = "new-" + nextId.current++;
    setRows((current) => [
      ...current,
      { rowId: id, questKey: option.key, hour: 0, minute: 0, second: 0 },
    ]);
  };

  return (
    <section className="card card-hairline overflow-hidden p-0">
      <button
        type="button"
        className="flex min-h-16 w-full items-center justify-between gap-4 px-6 py-5 text-left transition hover:bg-[rgba(232,194,92,0.04)]"
        onClick={() => setCollapsed((value) => !value)}
        aria-expanded={!collapsed}
        aria-controls="quest-timer-body"
      >
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="h-display text-lg font-bold text-gilded">Hẹn giờ quest</h2>
            <span className="rounded-full border border-[var(--color-ink-600)] px-2 py-0.5 text-[11px] text-[var(--color-mist)]">
              {rows.length} lịch
            </span>
          </div>
          <p className="mt-1 max-w-xl text-xs leading-relaxed text-[var(--color-mist)]">
            Mỗi quest có một mốc giờ Việt Nam mỗi ngày. Trước mốc này quest được gác lại; từ đúng
            mốc tới hết ngày nó chạy theo flow/cooldown bình thường. Khai Đàn vẫn là công tắc tổng.
          </p>
        </div>
        <span
          aria-hidden="true"
          className={`shrink-0 text-base text-[var(--color-gold-300)] transition-transform duration-200 ${
            collapsed ? "-rotate-90" : ""
          }`}
        >
          ▼
        </span>
      </button>

      <div id="quest-timer-body" hidden={collapsed} className="border-t border-[var(--color-ink-600)]/50 px-6 pb-6 pt-5">
        <div className="mb-4 flex justify-start">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={addTimer}
            disabled={!canAdd || pending}
          >
            + Thêm hẹn giờ
          </button>
        </div>

        <form action={action} className="space-y-3">
        <input
          type="hidden"
          name="questTimersJson"
          value={JSON.stringify(
            rows.map(({ questKey, hour, minute, second }) => ({ questKey, hour, minute, second })),
          )}
        />

        {rows.length === 0 ? (
          <p className="rounded-lg border border-dashed border-[var(--color-ink-600)]/70 px-4 py-5 text-center text-sm text-[var(--color-mist)]">
            Chưa có lịch hẹn. Quest đang bật sẽ chạy theo nhịp Auto liên tục như hiện tại.
          </p>
        ) : (
          rows.map((row) => {
            const baseEnabled = enabled.has(row.questKey);
            return (
              <div
                key={row.rowId}
                className="rounded-xl border border-[var(--color-ink-600)]/60 bg-[var(--color-ink-900)]/20 p-4"
              >
                <div className="grid items-end gap-3 sm:grid-cols-[minmax(0,1fr)_auto_auto_auto_auto]">
                  <div>
                    <label className="label" htmlFor={row.rowId + "-quest"}>Quest</label>
                    <select
                      id={row.rowId + "-quest"}
                      className="input"
                      value={row.questKey}
                      onChange={(event) =>
                        update(row.rowId, { questKey: event.target.value as QuestTimerKey })
                      }
                    >
                      {QUEST_TIMER_OPTIONS.map((option) => (
                        <option
                          key={option.key}
                          value={option.key}
                          disabled={option.key !== row.questKey && used.has(option.key)}
                        >
                          {option.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  {(
                    [
                      ["Giờ", "hour", row.hour, 23],
                      ["Phút", "minute", row.minute, 59],
                      ["Giây", "second", row.second, 59],
                    ] as const
                  ).map(([label, field, value, max]) => (
                    <div key={field} className="w-[5.2rem]">
                      <label className="label" htmlFor={row.rowId + "-" + field}>{label}</label>
                      <input
                        id={row.rowId + "-" + field}
                        className="input text-center tabular-nums"
                        type="number"
                        min={0}
                        max={max}
                        value={String(value).padStart(2, "0")}
                        onChange={(event) =>
                          update(row.rowId, {
                            [field]: clamp(Number(event.target.value), 0, max),
                          } as Partial<QuestTimer>)
                        }
                      />
                    </div>
                  ))}

                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => setRows((current) => current.filter((item) => item.rowId !== row.rowId))}
                    disabled={pending}
                  >
                    Xoá
                  </button>
                </div>

                {!baseEnabled && (
                  <p className="mt-2 text-xs text-[var(--color-gold-300)]">
                    Quest này đang tắt trong Ngọc Giản — lịch được giữ nhưng sẽ không tự bật quest.
                  </p>
                )}
              </div>
            );
          })
        )}

        <div className="flex flex-wrap items-center gap-3 pt-1">
          <button type="submit" className="btn btn-gold" disabled={pending}>
            {pending ? "Đang lưu…" : "Lưu lịch hẹn"}
          </button>
          <p className="text-xs text-[var(--color-mist)]">
            Hub quest vẫn dùng sổ đủ chỉ tiêu ngày như cũ; đủ lượt rồi thì lịch không chạy lại nó.
          </p>
        </div>

        {state?.message && (
          <p className={"text-sm " + (state.ok ? "text-[var(--color-jade-300)]" : "text-red-300")}>
            {state.message}
          </p>
        )}
        </form>
      </div>
    </section>
  );
}
