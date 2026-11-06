"use client";

import { useEffect, useRef, useState, type DragEvent, type FormEvent, type ReactNode } from "react";
import { isSafeAttachmentUrl } from "@/lib/validation/chat";
import { isSafeDirectAttachmentUrl } from "@/lib/validation/directAttachments";
import { SendIcon } from "./Icons";
import type { RoomAttachment } from "./types";

const MAX_FILES = 6;
const MAX_BYTES = 8 * 1024 * 1024;
type DraftFile = {
  id: number;
  file: File;
  attachment?: RoomAttachment;
  error?: string;
  controller?: AbortController;
};

export function fileSize(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.ceil(bytes / 1024))} KB`;
}

/** One draft per mounted conversation. Uploading never sends a message automatically. */
export function AttachmentComposer({ children, placeholder, sendLabel, peerId, onSend }: {
  children: ReactNode;
  placeholder: string;
  sendLabel: string;
  peerId?: string;
  onSend: (text: string, attachments: RoomAttachment[]) => Promise<void>;
}) {
  const [text, setText] = useState("");
  const [files, setFiles] = useState<DraftFile[]>([]);
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const [dragging, setDragging] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const draft = useRef<DraftFile[]>([]);
  const sequence = useRef(0);
  const dragDepth = useRef(0);
  const busy = useRef(false);
  const mounted = useRef(true);

  function update(next: DraftFile[]) {
    draft.current = next;
    if (mounted.current) setFiles(next);
  }

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      draft.current.forEach((item) => item.controller?.abort());
    };
  }, []);

  async function upload(item: DraftFile) {
    if (draft.current.find((current) => current.id === item.id)?.controller) return;
    const controller = new AbortController();
    update(draft.current.map((current) => current.id === item.id ? { ...current, error: undefined, controller } : current));
    try {
      const form = new FormData();
      form.append("file", item.file);
      if (peerId) form.append("peer", peerId);
      const response = await fetch(peerId ? "/api/direct-messages/files" : "/api/chat/upload", { method: "POST", body: form, signal: controller.signal });
      const data = await response.json().catch(() => null) as (RoomAttachment & { error?: string }) | null;
      if (!response.ok) throw new Error(data?.error ?? "Không tải được file. Hãy thử lại.");
      if (!data || !(peerId ? isSafeDirectAttachmentUrl(data.url) : isSafeAttachmentUrl(data.url)) || typeof data.name !== "string" || !data.name.trim() ||
        data.name.length > 200 || typeof data.type !== "string" || data.type.length > 120 ||
        !Number.isInteger(data.size) || data.size <= 0 || data.size > MAX_BYTES) {
        throw new Error("Phản hồi tải file không hợp lệ. Hãy thử lại.");
      }
      if (!mounted.current || controller.signal.aborted) return;
      const attachment = { url: data.url, name: data.name, size: data.size, type: data.type };
      update(draft.current.map((current) => current.id === item.id ? { ...current, attachment, controller: undefined } : current));
    } catch (reason) {
      if (!mounted.current || controller.signal.aborted) return;
      update(draft.current.map((current) => current.id === item.id ? {
        ...current, controller: undefined, error: reason instanceof Error ? reason.message : "Không tải được file.",
      } : current));
    }
  }

  function addFiles(incoming: FileList | File[]) {
    if (busy.current) return;
    const additions: DraftFile[] = [];
    const rejected: string[] = [];
    for (const file of Array.from(incoming)) {
      if (file.size === 0 || file.size > MAX_BYTES) {
        rejected.push(`${file.name}: file phải lớn hơn 0 và không quá 8 MB.`);
      } else if (!file.name.trim() || file.name.trim().length > 200) {
        rejected.push("Tên file không được quá 200 ký tự.");
      } else if (draft.current.length + additions.length >= MAX_FILES) {
        rejected.push("Mỗi tin nhắn được đính kèm tối đa 6 file.");
      } else {
        additions.push({ id: ++sequence.current, file });
      }
    }
    setError([...new Set(rejected)].join(" "));
    // Reserve slots synchronously so repeated picker/drop events cannot exceed the limit.
    update([...draft.current, ...additions]);
    additions.forEach((item) => void upload(item));
  }

  function remove(id: number) {
    if (busy.current) return;
    draft.current.find((item) => item.id === id)?.controller?.abort();
    update(draft.current.filter((item) => item.id !== id));
  }

  const isFileDrag = (event: DragEvent) => Array.from(event.dataTransfer.types).includes("Files");
  const pending = files.some((item) => !item.attachment);
  async function send(event: FormEvent) {
    event.preventDefault();
    if (busy.current || draft.current.some((item) => !item.attachment) || (!text.trim() && !draft.current.length)) return;
    busy.current = true;
    setSending(true);
    setError("");
    try {
      await onSend(text.trim(), draft.current.map((item) => item.attachment!));
      if (!mounted.current) return;
      setText("");
      update([]);
    } catch (reason) {
      if (mounted.current) setError(reason instanceof Error ? reason.message : "Mất kết nối khi gửi tin.");
    } finally {
      busy.current = false;
      if (mounted.current) setSending(false);
    }
  }

  return (
    <div className="communication-conversation"
      onDragEnter={(event) => { if (isFileDrag(event)) { event.preventDefault(); dragDepth.current++; setDragging(true); } }}
      onDragOver={(event) => { if (isFileDrag(event)) { event.preventDefault(); event.dataTransfer.dropEffect = sending ? "none" : "copy"; } }}
      onDragLeave={(event) => { if (isFileDrag(event)) { event.preventDefault(); dragDepth.current = Math.max(0, dragDepth.current - 1); if (!dragDepth.current) setDragging(false); } }}
      onDrop={(event) => {
        if (!isFileDrag(event)) return;
        event.preventDefault();
        dragDepth.current = 0;
        setDragging(false);
        addFiles(event.dataTransfer.files);
      }}
    >
      {children}
      {dragging && <div className="communication-drop-overlay" role="status">Thả file vào đây để đính kèm<br /><small>Tối đa 6 file · 8 MB/file</small></div>}
      <div className="communication-draft">
        {files.length > 0 && <ul className="communication-draft-files" aria-label="File đính kèm">
          {files.map((item) => <li key={item.id}>
            {item.attachment?.type.startsWith("image/") ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={item.attachment.url} alt="" />
            ) : <span className="communication-file-icon" aria-hidden="true">📎</span>}
            <span className="communication-draft-name"><strong title={item.file.name}>{item.file.name}</strong>
              <small>{item.error ?? (item.attachment ? fileSize(item.file.size) : "Đang tải…")}</small>
            </span>
            {item.error && <button type="button" disabled={sending} onClick={() => void upload(item)} aria-label={`Thử lại ${item.file.name}`}>Thử lại</button>}
            <button type="button" disabled={sending} onClick={() => remove(item.id)} aria-label={`Bỏ file ${item.file.name}`}>×</button>
          </li>)}
        </ul>}
        {error && <p className="communication-error" role="alert">{error}</p>}
        <form className="communication-composer" onSubmit={send}>
          <input ref={picker} type="file" multiple hidden onChange={(event) => {
            if (event.target.files) addFiles(event.target.files);
            event.target.value = "";
          }} />
          <button type="button" className="communication-attach" disabled={sending || files.length >= MAX_FILES}
            onClick={() => picker.current?.click()} aria-label="Đính kèm file" title="Đính kèm file (tối đa 6 file, 8 MB/file)">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
              <path d="m8 12 6-6a3 3 0 0 1 4 4l-8 8a5 5 0 0 1-7-7l9-9M6 14l8-8" />
            </svg>
          </button>
          <input value={text} disabled={sending} onChange={(event) => setText(event.target.value)}
            placeholder={placeholder} maxLength={4000} aria-label={placeholder.replace(/…$/, "")} />
          <button type="submit" disabled={sending || pending || (!text.trim() && !files.length)} aria-label={sendLabel}>
            <SendIcon />
          </button>
        </form>
      </div>
    </div>
  );
}
