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
  return (
    <fieldset disabled={disabled} aria-busy={saving ? true : undefined} className="mt-3 border-t border-[var(--color-ink-600)]/40 pt-2.5">
      <legend className="sr-only">Giao khôi lỗi phụ trách tài khoản</legend>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="shrink-0 text-[11px] font-medium text-[var(--color-mist)]">
          Khôi lỗi phụ trách
        </span>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Chọn một nơi chạy cho tài khoản">
          {OPTIONS.map((option) => {
            const checked = selected === option.value;
            return (
              <label
                key={option.value}
                className={
                  "inline-flex min-h-8 cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs leading-none transition-colors " +
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
        {saving && <span className="text-[11px] text-[var(--color-mist)]" role="status">Đang lưu…</span>}
      </div>
    </fieldset>
  );
}
