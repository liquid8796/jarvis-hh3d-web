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
    // Khoá đối xứng nên jose vốn đã chỉ nhận HS*, và `alg: none` thì không bao giờ qua được.
    // Ghi thẳng danh sách cho phép vẫn đáng: nó biến một bảo đảm của thư viện thành một dòng
    // đọc được ngay tại chỗ, và khoá luôn cửa nếu sau này có ai đổi `secret()` sang khoá bất
    // đối xứng mà quên rằng phép xác minh đang mở cho mọi thuật toán khoá ấy hỗ trợ.
    const { payload } = await jwtVerify(token, secret(), { algorithms: ["HS256"] });
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
