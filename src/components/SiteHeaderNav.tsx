"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useLanguage } from "@/lib/i18n/context";
import { LanguageToggle } from "./LanguageToggle";
import { Avatar } from "./Avatar";

interface SiteHeaderNavProps {
  user: { displayName: string; avatarUrl: string | null; status: string } | null;
  isAdmin: boolean;
  logoutAction: () => Promise<void>;
}

export function SiteHeaderNav({ user, isAdmin, logoutAction }: SiteHeaderNavProps) {
  const { t } = useLanguage();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setOpen(false); }, [pathname]);
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !menuRef.current?.contains(event.target)) setOpen(false);
    };
    window.addEventListener("keydown", dismiss);
    document.addEventListener("pointerdown", outside);
    return () => {
      window.removeEventListener("keydown", dismiss);
      document.removeEventListener("pointerdown", outside);
    };
  }, [open]);

  const links = [
    ...(user ? [{ href: "/profile", label: t.nav.profile, avatar: true }] : []),
    ...(user && isAdmin ? [{ href: "/admin", label: t.nav.sectAdmin }] : []),
    { href: "/ten-mien", label: t.nav.domains },
    ...(user ? [{ href: user.status === "active" ? "/dashboard" : "/pending", label: t.nav.auto }] : []),
    ...(user?.status === "active" ? [
      { href: "/hang-doi", label: t.nav.queue },
      { href: "/chat", label: t.nav.chat },
    ] : []),
    ...(!user ? [{ href: "/login", label: t.nav.signIn }, { href: "/register", label: t.nav.register }] : []),
  ];

  return (
    <>
      {/* Desktop navigation retains the existing layout and visual identity. */}
      <nav aria-label="Điều hướng chính" className="hidden flex-wrap items-center justify-end gap-3 text-sm xl:flex">
        <LanguageToggle />
        {links.map((entry) => (
          <Link key={entry.href} href={entry.href}
            aria-current={pathname === entry.href ? "page" : undefined}
            className={"btn " + (entry.href === "/register" ? "btn-gold" : "btn-ghost")}>
            {"avatar" in entry && user && <Avatar name={user.displayName} url={user.avatarUrl} size={22} />}
            {entry.label}
          </Link>
        ))}
        {user && (
          <form action={logoutAction}>
            <button type="submit" className="btn btn-ghost" title={ "Active session: " + user.displayName }>
              {t.nav.signOut}
            </button>
          </form>
        )}
      </nav>

      {/* Mobile is a single compact row with a true disclosure, not 3 rows of buttons. */}
      <div className="relative flex shrink-0 items-center xl:hidden" ref={menuRef}>
        <button
          type="button"
          className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-[rgba(232,194,92,.4)] bg-[rgba(9,12,26,.78)] px-3 text-sm font-medium text-[var(--color-gold-300)] shadow-md backdrop-blur"
          aria-controls="mobile-site-navigation"
          aria-expanded={open}
          aria-label={open ? "Đóng menu điều hướng" : "Mở menu điều hướng"}
          onClick={() => setOpen((value) => !value)}
        >
          <span aria-hidden="true" className="flex w-4 flex-col gap-1">
            <span className="h-0.5 w-4 rounded-full bg-current" />
            <span className="h-0.5 w-4 rounded-full bg-current" />
            <span className="h-0.5 w-4 rounded-full bg-current" />
          </span>
          <span>{open ? "Đóng" : "Menu"}</span>
        </button>
        {open && (
          <nav
            id="mobile-site-navigation"
            aria-label="Điều hướng mobile"
            className="absolute right-0 top-[calc(100%+0.75rem)] z-50 max-h-[min(70dvh,650px)] w-[min(19rem,calc(100vw-2rem))] overflow-y-auto overscroll-contain rounded-2xl border border-[rgba(232,194,92,.3)] bg-[var(--color-ink-900)] p-3 shadow-[0_24px_65px_rgba(0,0,0,.75)]"
          >
            <div className="mb-3 flex items-center justify-between gap-3 border-b border-[var(--color-ink-600)] pb-3">
              <span className="text-xs text-[var(--color-mist)]">Ngôn ngữ / Language</span>
              <LanguageToggle />
            </div>
            <div className="grid grid-cols-2 gap-2">
              {links.map((entry) => (
                <Link key={entry.href} href={entry.href}
                  aria-current={pathname === entry.href ? "page" : undefined}
                  onClick={() => setOpen(false)}
                  className={
                    "flex min-h-11 min-w-0 items-center justify-center gap-2 rounded-lg border px-2.5 py-2 text-center text-sm leading-snug transition-colors " +
                    (pathname === entry.href
                      ? "border-[var(--color-jade-400)]/50 bg-[var(--color-jade-400)]/15 text-[var(--color-jade-300)]"
                      : "border-[var(--color-ink-600)] text-[var(--color-parchment)] hover:border-[var(--color-gold-300)]/50")
                  }>
                  {"avatar" in entry && user && <Avatar name={user.displayName} url={user.avatarUrl} size={20} />}
                  {entry.label}
                </Link>
              ))}
            </div>
            {user && (
              <form action={logoutAction} className="mt-3 border-t border-[var(--color-ink-600)] pt-3">
                <button type="submit" className="min-h-11 w-full rounded-lg border border-[var(--color-ink-600)] px-4 text-sm text-[var(--color-mist)]">
                  {t.nav.signOut}
                </button>
              </form>
            )}
          </nav>
        )}
      </div>
    </>
  );
}
