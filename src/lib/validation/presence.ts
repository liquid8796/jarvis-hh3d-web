import { z } from "zod";

export const presenceStatusSchema = z.enum(["online", "busy", "offline"]);
export type PresenceStatus = z.infer<typeof presenceStatusSchema>;
export const PRESENCE_FRESH_MS = 90_000;
export const PRESENCE_LABEL: Record<PresenceStatus, string> = {
  online: "Online",
  busy: "Đang bận",
  offline: "Offline",
};
export function effectivePresence(selected: PresenceStatus, seenAt: Date | string | null | undefined, now = Date.now()): PresenceStatus {
  if (selected === "offline") return "offline";
  const seen = seenAt instanceof Date ? seenAt.getTime() : seenAt ? new Date(seenAt).getTime() : Number.NaN;
  if (!Number.isFinite(seen) || now - seen > PRESENCE_FRESH_MS) return "offline";
  return selected;
}
