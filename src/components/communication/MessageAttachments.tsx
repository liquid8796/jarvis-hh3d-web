"use client";

import { isSafeAttachmentUrl } from "@/lib/validation/chat";
import { isSafeDirectAttachmentUrl } from "@/lib/validation/directAttachments";
import { fileSize } from "./AttachmentComposer";
import type { RoomAttachment } from "./types";

export function MessageAttachments({ attachments = [] }: { attachments?: RoomAttachment[] }) {
  return <div className="communication-attachments">{attachments.filter((item) => (isSafeAttachmentUrl(item.url) || isSafeDirectAttachmentUrl(item.url))).map((item, index) => (
    <a key={`${item.url}:${index}`} href={item.url} target="_blank" rel="noopener noreferrer">
      {item.type.startsWith("image/") && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={item.url} alt={item.name} loading="lazy" />
      )}
      <span>📎 {item.name}</span><small>{fileSize(item.size)}</small>
    </a>
  ))}</div>;
}
