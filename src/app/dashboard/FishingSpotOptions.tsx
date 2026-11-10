"use client";

import { useId, useState } from "react";

const SPOTS = [
  ["nong", "Bờ nông"],
  ["sen", "Bãi sen"],
  ["giua", "Giữa hồ"],
  ["cau", "Dưới cầu đá"],
] as const;

export function FishingSpotOptions({ defaultValue, disabled }: {
  defaultValue: string[];
  disabled: boolean;
}) {
  const [selected, setSelected] = useState(defaultValue);
  const hintId = useId();
  return (
    <fieldset disabled={disabled} aria-describedby={hintId}
      className="space-y-2 text-xs text-[var(--color-mist)]">
      <legend>Điểm câu</legend>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {SPOTS.map(([value, label]) => (
          <label key={value} className="flex min-h-10 cursor-pointer items-center gap-2 rounded-lg border border-[var(--color-ink-500)] bg-[var(--color-ink-700)] p-2 text-[var(--color-parchment)]">
            <input type="checkbox" name="cauCaSpot" value={value} checked={selected.includes(value)} disabled={disabled}
              onChange={event => {
                const checked = event.currentTarget.checked;
                setSelected(current => checked ? [...current, value]
                  : current.length > 1 ? current.filter(spot => spot !== value) : current);
              }} />
            <span>{label}</span>
          </label>
        ))}
      </div>
      <p id={hintId}>Chọn ít nhất một điểm. Chọn từ 2 điểm trở lên sẽ ngẫu nhiên trong các điểm đã chọn mỗi lần ném. Không đổi chỗ ngồi. Trong đợt Cá Săn, giữ điểm hiện tại.</p>
    </fieldset>
  );
}
