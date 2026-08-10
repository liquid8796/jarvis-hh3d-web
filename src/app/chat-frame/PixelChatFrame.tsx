"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ChangeEvent, KeyboardEvent as ReactKeyboardEvent } from "react";
import styles from "./PixelChatFrame.module.css";

type LocalMessage = {
  id: number;
  text: string;
};

const EMOJIS = ["😊", "🥰", "✨", "💛", "😄", "😎", "🫶", "🌸"] as const;

export function PixelChatFrame() {
  const [text, setText] = useState("");
  const [messages, setMessages] = useState<LocalMessage[]>([]);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const nextMessageId = useRef(1);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const emojiButtonRef = useRef<HTMLButtonElement>(null);
  const emojiPanelRef = useRef<HTMLDivElement>(null);

  const appendMessage = useCallback((messageText: string) => {
    const id = nextMessageId.current++;
    setMessages((current) => [
      ...current,
      { id, text: messageText },
    ]);
  }, []);

  const send = useCallback(() => {
    const messageText = text.trim();
    if (!messageText) return;

    appendMessage(messageText);
    setText("");
    setEmojiOpen(false);
  }, [appendMessage, text]);

  const handleInputKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      send();
    }
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.currentTarget.files ?? []);
    for (const file of files) appendMessage(`📎 ${file.name}`);
    event.currentTarget.value = "";
  };

  const insertEmoji = (emoji: string) => {
    const input = inputRef.current;
    const start = input?.selectionStart ?? text.length;
    const end = input?.selectionEnd ?? start;
    const caret = start + emoji.length;

    setText((current) => current.slice(0, start) + emoji + current.slice(end));
    setEmojiOpen(false);
    requestAnimationFrame(() => {
      input?.focus({ preventScroll: true });
      input?.setSelectionRange(caret, caret);
    });
  };

  useEffect(() => {
    if (!emojiOpen) return;

    const closeOnOutsidePress = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (emojiPanelRef.current?.contains(target)) return;
      if (emojiButtonRef.current?.contains(target)) return;
      setEmojiOpen(false);
    };

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setEmojiOpen(false);
    };

    document.addEventListener("pointerdown", closeOnOutsidePress);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePress);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [emojiOpen]);

  const hasText = text.length > 0;

  return (
    <main className={styles.viewport} data-backdrop="chat-frame">
      <section className={styles.stage} aria-label="Khung chat phong cách huyền ảo">
        <Image
          src="/chat-frame.png"
          alt=""
          width={1448}
          height={1086}
          preload
          unoptimized
          draggable={false}
          className={styles.frameImage}
        />

        <section className={styles.messageLog} aria-live="polite" aria-label="Tin nhắn">
          {messages.map((message) => (
            <div className={styles.message} key={message.id}>
              {message.text}
            </div>
          ))}
        </section>

        {hasText ? <div className={styles.inputCover} aria-hidden /> : null}
        <label className={styles.srOnly} htmlFor="pixel-chat-input">
          Nhập nội dung trò chuyện
        </label>
        <textarea
          ref={inputRef}
          id="pixel-chat-input"
          rows={1}
          value={text}
          onChange={(event) => setText(event.currentTarget.value)}
          onKeyDown={handleInputKeyDown}
          className={`${styles.input} ${hasText ? styles.inputActive : ""}`}
          aria-label="Nhập nội dung trò chuyện"
        />
        <input
          ref={fileRef}
          type="file"
          multiple
          hidden
          aria-label="Chọn tệp đính kèm"
          onChange={handleFileChange}
        />

        <button
          className={`${styles.hotspot} ${styles.attachButton}`}
          type="button"
          aria-label="Đính kèm tệp"
          onClick={() => fileRef.current?.click()}
        />
        <button
          ref={emojiButtonRef}
          className={`${styles.hotspot} ${styles.emojiButton}`}
          type="button"
          aria-label="Chọn biểu tượng cảm xúc"
          aria-expanded={emojiOpen}
          aria-controls="pixel-chat-emoji-panel"
          onClick={() => setEmojiOpen((current) => !current)}
        />
        <button
          className={`${styles.hotspot} ${styles.sendButton}`}
          type="button"
          aria-label="Gửi tin nhắn"
          onClick={send}
        />

        {emojiOpen ? (
          <div
            ref={emojiPanelRef}
            id="pixel-chat-emoji-panel"
            className={styles.emojiPanel}
            role="dialog"
            aria-label="Biểu tượng cảm xúc"
          >
            {EMOJIS.map((emoji) => (
              <button
                className={styles.emoji}
                type="button"
                key={emoji}
                aria-label={`Chèn ${emoji}`}
                onClick={() => insertEmoji(emoji)}
              >
                {emoji}
              </button>
            ))}
          </div>
        ) : null}
      </section>
    </main>
  );
}
