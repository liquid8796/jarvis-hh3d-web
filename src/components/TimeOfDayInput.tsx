"use client";

const minutes = Array.from({ length: 60 }, (_, value) => String(value).padStart(2, "0"));
const hours = minutes.slice(0, 24);
const partClass = "input min-h-11 min-w-0 tabular-nums";

export function TimeOfDayInput({
  label,
  value,
  onChange,
  disabled,
  className,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
}) {
  const [hour, minute] = value.split(":");

  return (
    <div role="group" aria-label={label} className={className}>
      <span className="label">{label}</span>
      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-1">
        <select
          aria-label="Giờ"
          className={partClass}
          style={{ paddingInline: "0.375rem" }}
          value={hour}
          onChange={(event) => onChange(`${event.target.value}:${minute}`)}
          disabled={disabled}
        >
          {hours.map((part) => <option key={part} value={part}>{part}</option>)}
        </select>
        <span aria-hidden="true" className="text-[var(--color-mist)]">:</span>
        <select
          aria-label="Phút"
          className={partClass}
          style={{ paddingInline: "0.375rem" }}
          value={minute}
          onChange={(event) => onChange(`${hour}:${event.target.value}`)}
          disabled={disabled}
        >
          {minutes.map((part) => <option key={part} value={part}>{part}</option>)}
        </select>
      </div>
    </div>
  );
}
