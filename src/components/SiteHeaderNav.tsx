"use client";

import Link from "next/link";
import { useLanguage } from "@/lib/i18n/context";
import { LanguageToggle } from "./LanguageToggle";
import { Avatar } from "./Avatar";

interface SiteHeaderNavProps {
  user: {
    displayName: string;
    avatarUrl: string | null;
    status: string;
  } | null;
  isAdmin: boolean;
  logoutAction: () => Promise<void>;
}

export function SiteHeaderNav({ user, isAdmin, logoutAction }: SiteHeaderNavProps) {
  const { t } = useLanguage();

  return (
    <nav className="flex flex-wrap items-center justify-end gap-3 text-sm">
      <LanguageToggle />

      {user ? (
        <>
          <Link href="/profile" className="btn btn-ghost">
            <Avatar name={user.displayName} url={user.avatarUrl} size={22} />
            {t.nav.profile}
          </Link>
          {isAdmin && (
            <Link href="/admin" className="btn btn-ghost">
              {t.nav.sectAdmin}
            </Link>
          )}
          <Link href="/ten-mien" className="btn btn-ghost">
            {t.nav.domains}
          </Link>
          <Link
            href={user.status === "active" ? "/dashboard" : "/pending"}
            className="btn btn-ghost"
          >
            {t.nav.auto}
          </Link>
          {user.status === "active" && (
            <>
              <Link href="/hang-doi" className="btn btn-ghost">
                {t.nav.queue}
              </Link>
              <Link href="/chat" className="btn btn-ghost">
                {t.nav.chat}
              </Link>
            </>
          )}
          <form action={logoutAction}>
            <button
              type="submit"
              className="btn btn-ghost"
              title={`Active session: ${user.displayName}`}
            >
              {t.nav.signOut}
            </button>
          </form>
        </>
      ) : (
        <>
          <Link href="/ten-mien" className="btn btn-ghost">
            {t.nav.domains}
          </Link>
          <Link href="/login" className="btn btn-ghost">
            {t.nav.signIn}
          </Link>
          <Link href="/register" className="btn btn-gold">
            {t.nav.register}
          </Link>
        </>
      )}
    </nav>
  );
}
