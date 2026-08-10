import type { Metadata } from "next";
import { PixelChatFrame } from "./PixelChatFrame";

export const metadata: Metadata = {
  title: "Khung Chat Nguyên Bản",
  description: "Phiên bản React của khung chat huyền ảo.",
};

export default function ChatFramePage() {
  return <PixelChatFrame />;
}
