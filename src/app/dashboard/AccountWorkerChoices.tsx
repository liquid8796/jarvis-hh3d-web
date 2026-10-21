"use client";

import { useEffect, useRef } from "react";
import type { DashboardAccount } from "@/lib/realtime/dashboardTypes";

export type AccountWorkerChoice = DashboardAccount["workerPrefOverride"];

const OPTIONS: ReadonlyArray<{value: AccountWorkerChoice; label: string; hint: string}> = [
  {value:"default", label:"Mặc định", hint:"Theo Tế đàn auto"},
  {value:"sect", label:"Khôi lỗi tông môn", hint:"Chỉ máy tông môn"},
  {value:"mine", label:"Máy nhà", hint:"Chỉ máy riêng"},
];

/**
 * Inline, mutually exclusive native checkboxes at the account that they affect.
 * Existing worker routing remains exclusive: one account = one selected location.
 */
export function AccountWorkerChoices({
  accountId, selected, disabled, saving, onSelect,
}: {
  accountId: string;
  selected: AccountWorkerChoice;
  disabled: boolean;
  saving?: boolean;
  onSelect: (value: AccountWorkerChoice) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // On narrow screens the three checkboxes cannot all fit beside the account
  // name and Sửa button. Keep the row intact but show the currently selected
  // option when the account loads or its worker changes.
  useEffect(() => {
    const rail = scrollRef.current;
    const checked = rail?.querySelector<HTMLInputElement>("input:checked");
    const chip = checked?.closest("label");
    if (!rail || !chip) return;
    const a = rail.getBoundingClientRect();
    const b = chip.getBoundingClientRect();
    if (b.left < a.left) rail.scrollLeft -= a.left - b.left;
    else if (b.right > a.right) rail.scrollLeft += b.right - a.right;
  }, [selected]);

  return (
    <fieldset disabled={disabled} aria-busy={saving ? true : undefined} className="min-w-0 flex-1 overflow-hidden">
      <legend className="sr-only">Giao khôi lỗi phụ trách tài khoản</legend>
      <div className="flex min-w-0 items-center gap-1.5">
        <div ref={scrollRef} className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto whitespace-nowrap" role="group" aria-label="Chọn một nơi chạy cho tài khoản" title="Vuốt ngang để xem các lựa chọn">
          {OPTIONS.map((option) => {
            const checked = selected === option.value;
            return (
              <label
                key={option.value}
                className={
                  "inline-flex min-h-11 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-2 text-xs leading-none transition-colors sm:min-h-8 sm:px-2 sm:py-1.5 sm:text-[11px] " +
                  "focus-within:ring-2 focus-within:ring-[var(--color-jade-400)]/60 " +
                  (checked
                    ? "border-[var(--color-jade-400)]/55 bg-[var(--color-jade-400)]/10 text-[var(--color-jade-300)]"
                    : "border-[var(--color-ink-600)]/70 text-[var(--color-mist)] hover:border-[var(--color-jade-400)]/35 hover:text-[var(--color-parchment)]") +
                  (disabled ? " cursor-wait opacity-65" : "")
                }
                title={option.hint}
              >
                <input
                  type="checkbox"
                  name={"account-worker-" + accountId}
                  value={option.value}
                  checked={checked}
                  disabled={disabled}
                  onChange={() => {
                    if (!checked) onSelect(option.value);
                  }}
                  aria-label={option.label}
                  className="h-3.5 w-3.5 shrink-0 accent-[var(--color-jade-400)]"
                />
                {option.label}
              </label>
            );
          })}
        </div>
        {saving && <span className="shrink-0 text-[11px] text-[var(--color-mist)]" role="status">Đang lưu…</span>}
      </div>
    </fieldset>
  );
}
