import { redirect } from "next/navigation";
import { readSession } from "./session";
import { findById, type PublicUser } from "@/lib/services/users";

/**
 * The authorization ladder. proxy.ts only checks that a session cookie EXISTS (cheap, runs
 * on every matched request); these guards are the real thing — they re-read the user row,
 * so a status flipped by an admin bites on the very next request, not at cookie expiry.
 */

export async function currentUser(): Promise<PublicUser | null> {
  const session = await readSession();
  if (!session) {
    return null;
  }

  return findById(session.sub);
}

/** Any logged-in user — the waiting room included. */
export async function requireUser(): Promise<PublicUser> {
  const user = await currentUser();
  if (!user) {
    redirect("/login");
  }

  return user;
}

/** A user the tông môn has actually admitted. */
export async function requireActiveUser(): Promise<PublicUser> {
  const user = await requireUser();
  if (user.status !== "active") {
    redirect("/pending");
  }

  return user;
}

export async function requireAdmin(): Promise<PublicUser> {
  const user = await requireUser();
  if (user.role !== "admin") {
    redirect("/dashboard");
  }

  return user;
}
