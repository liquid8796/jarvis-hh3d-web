import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { cache } from "react";

/**
 * Session = a signed, httpOnly JWT cookie. No session table: the payload is tiny (id, role,
 * status), seven days is short enough that role/status changes propagate on re-login, and
 * every page that ACTS re-reads the user row anyway — the cookie only says who is asking,
 * the database says what they may do. That split is what makes "admin un-approves a user
 * mid-session" take effect on the user's very next request.
 */
const COOKIE = "jarvis_session";
const MAX_AGE_S = 7 * 24 * 3600;

export type SessionClaims = {
  sub: string;
  username: string;
  role: "user" | "admin";
};

function secret(): Uint8Array {
  const value = process.env.AUTH_SECRET;
  if (!value || value === "change-me") {
    throw new Error("AUTH_SECRET is not set — see .env.example.");
  }

  return new TextEncoder().encode(value);
}

export async function createSession(claims: SessionClaims): Promise<void> {
  const token = await new SignJWT({ username: claims.username, role: claims.role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE_S}s`)
    .sign(secret());

  const jar = await cookies();
  jar.set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE_S,
  });
}

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  jar.delete(COOKIE);
}

/** Per-request memoised: many components ask, the JWT is verified once. */
export const readSession = cache(async (): Promise<SessionClaims | null> => {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (!token) {
    return null;
  }

  try {
    const { payload } = await jwtVerify(token, secret());
    if (typeof payload.sub !== "string") {
      return null;
    }

    return {
      sub: payload.sub,
      username: String(payload.username ?? ""),
      role: payload.role === "admin" ? "admin" : "user",
    };
  } catch {
    // Expired or tampered — either way, not a session.
    return null;
  }
});

export const sessionCookieName = COOKIE;
