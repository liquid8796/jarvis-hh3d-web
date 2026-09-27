import { NextResponse, type NextRequest } from "next/server";
import { decideRequest } from "@/lib/control/doc";
import { readControlDoc } from "@/lib/control/read";
import { OFFICIAL_ORIGIN, isRetiredDomainHost } from "@/lib/domains/catalog";
import { renderRetiredDomainPage } from "@/lib/domains/retiredDomainPage";
import { backendIsStation } from "@/lib/mirror/switchGuard";

const PROTECTED_PREFIXES = ["/dashboard", "/admin", "/pending", "/profile"];

/**
 * One request gate for Next.js 16.
 *
 * Order matters:
 * 1. The retired Vercel hostname is always a tombstone, even while the database is unavailable.
 * 2. Anonymous users are bounced from protected areas before page code runs.
 * 3. Mirror/station traffic follows the signed control document.
 */
export async function proxy(request: NextRequest): Promise<NextResponse> {
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",", 1)[0]?.trim();
  const requestedHost = forwardedHost || request.headers.get("host");

  if (isRetiredDomainHost(requestedHost)) {
    if (request.method === "GET" || request.method === "HEAD") {
      const html = request.method === "HEAD"
        ? null
        : renderRetiredDomainPage(request.nextUrl.pathname, request.nextUrl.search);
      return new NextResponse(html, {
        status: 410,
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "public, max-age=300, s-maxage=300",
          "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
          "X-Robots-Tag": "noindex, nofollow, noarchive",
        },
      });
    }

    return NextResponse.json(
      {
        error: "domain_retired",
        message: "Tên miền này đã đóng. Vui lòng truy cập auto-hh3d.online.",
        activeUrl: OFFICIAL_ORIGIN,
      },
      { status: 410, headers: { "Cache-Control": "no-store" } },
    );
  }

  const { pathname, search } = request.nextUrl;
  const isProtected = PROTECTED_PREFIXES.some((prefix) => pathname.startsWith(prefix));
  if (isProtected && !request.cookies.has("jarvis_session")) {
    const login = new URL("/login", request.url);
    login.searchParams.set("next", `${pathname}${search}`);
    return NextResponse.redirect(login);
  }

  const siteId = process.env.SITE_ID?.trim() || undefined;
  if (!backendIsStation(siteId)) return NextResponse.next();

  const decision = decideRequest({
    siteId,
    doc: await readControlDoc(),
    pathname,
    search,
  });

  switch (decision.kind) {
    case "serve":
      return NextResponse.next();
    case "redirect":
      // Temporary on purpose: control can move back to this station later.
      return NextResponse.redirect(decision.location, 307);
    case "worker-conflict":
      return NextResponse.json(
        { error: "Trạm này không còn hoạt động — đọc lại bảng điều phối.", activeUrl: decision.activeUrl },
        { status: 409 },
      );
    case "cron-skip":
      return new NextResponse(null, { status: 204 });
  }
}

export const config = {
  matcher: ["/((?!_next/|favicon\\.ico|.*\\.(?:png|webp|jpg|jpeg|gif|svg|ico|txt|xml|webmanifest)$).*)"],
};
