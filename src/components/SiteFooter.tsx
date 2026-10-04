"use client";

import Link from "next/link";
import { useLanguage } from "@/lib/i18n/context";

export function SiteFooter() {
  const { t } = useLanguage();

  return (
    <footer className="site-footer">
      <span>{t.footer.rights}</span>
      <span aria-hidden="true"> · </span>
      <Link href="/quyen-rieng-tu">{t.footer.privacy}</Link>
    </footer>
  );
}
