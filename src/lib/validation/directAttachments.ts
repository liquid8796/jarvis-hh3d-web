import { z } from "zod";

export const MAX_DIRECT_ATTACHMENT_BYTES = 8 * 1024 * 1024;
const directUrl = /^\/api\/direct-messages\/files\/([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;
export function isSafeDirectAttachmentUrl(raw: unknown): raw is string {
  return typeof raw === "string" && directUrl.test(raw);
}
export const directAttachmentSchema = z.object({
  url: z.string().refine(isSafeDirectAttachmentUrl, "Tệp riêng không hợp lệ."),
  name: z.string().trim().min(1).max(200),
  size: z.number().int().positive().max(MAX_DIRECT_ATTACHMENT_BYTES),
  type: z.string().max(120),
});
export type DirectAttachment = z.infer<typeof directAttachmentSchema>;
