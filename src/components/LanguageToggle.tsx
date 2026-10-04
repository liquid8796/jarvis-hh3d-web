"use client";

import { useLanguage } from "@/lib/i18n/context";

export function LanguageToggle() {
  const { language, setLanguage } = useLanguage();

  return (
    <div
      role="group"
      aria-label="Language selector"
      className="inline-flex items-center rounded-lg border border-[rgba(155,150,190,.16)] bg-[rgba(12,10,26,.65)] p-0.5 text-xs backdrop-blur-sm"
    >
      <button
        type="button"
        onClick={() => setLanguage("en")}
        className={`px-2 py-1 font-semibold rounded-md transition-all ${
          language === "en"
            ? "bg-[rgba(232,194,92,.22)] text-[var(--color-gold-300)] shadow-sm"
            : "text-[var(--color-mist)] hover:text-[var(--color-parchment)]"
        }`}
        title="Switch to English"
        aria-pressed={language === "en"}
      >
        EN
      </button>
      <span className="text-[rgba(155,150,190,.3)] text-[10px]" aria-hidden="true">
        /
      </span>
      <button
        type="button"
        onClick={() => setLanguage("vi")}
        className={`px-2 py-1 font-semibold rounded-md transition-all ${
          language === "vi"
            ? "bg-[rgba(232,194,92,.22)] text-[var(--color-gold-300)] shadow-sm"
            : "text-[var(--color-mist)] hover:text-[var(--color-parchment)]"
        }`}
        title="Chuyển sang Tiếng Việt"
        aria-pressed={language === "vi"}
      >
        VI
      </button>
    </div>
  );
}
