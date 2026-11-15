"use client";

import { useLanguage } from "@/lib/i18n/context";

export function SiteFooter() {
  const { t } = useLanguage();

  return (
    <footer className="site-footer">
      <span>{t.footer.rights}</span>
    </footer>
  );
}
