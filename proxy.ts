import { NextResponse, type NextRequest } from "next/server";

/**
 * Next.js 16 proxy (né middleware): the FIRST gate only. It answers one cheap question —
 * "is there a session cookie at all?" — and bounces anonymous visitors off the protected
 * areas before any page code runs. Everything stateful (role, approval status) is decided
 * in the server-side guards, which read the database; a cookie's presence is never treated
 * as authorization.
 */
const PROTECTED_PREFIXES = ["/dashboard", "/admin", "/pending"];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isProtected = PROTECTED_PREFIXES.some((p) => pathname.startsWith(p));
  if (!isProtected) {
    return NextResponse.next();
  }

  const hasSession = request.cookies.has("jarvis_session");
  if (!hasSession) {
    const login = new URL("/login", request.url);
    login.searchParams.set("next", pathname);
    return NextResponse.redirect(login);
  }

  return NextResponse.next();
}

export const proxyConfig = {
  matcher: ["/dashboard/:path*", "/admin/:path*", "/pending"],
};
