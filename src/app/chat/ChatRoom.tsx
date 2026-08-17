"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ChatPicker, type PickerTab } from "./ChatPicker";
import { Avatar } from "@/components/Avatar";
import { isSafeAttachmentUrl } from "@/lib/validation/chat";
import { framesForTags, normalizeTagLabel, type TagFrame } from "@/lib/validation/tags";
import type { Gif } from "@/lib/services/gif";

/**
 * Phòng Chat — client của sảnh đàm đạo.
 *
 * Realtime bằng POLLING, và đó là lựa chọn có chủ ý: mỗi nhịp ~2.5s client xin lại NGUYÊN
 * TRANG tin mới nhất rồi hoà vào kho theo id. Xin nguyên trang thay vì chỉ "tin sau mốc X"
 * vì tin cũ cũng biến động — sửa, thu hồi, thả cảm xúc — và một cursor chỉ-tiến sẽ mù hết
 * những chuyện đó. Ở quy mô một tông môn, một trang 50 tin mỗi 2.5 giây là cái giá rẻ cho
 * việc không bao giờ phải đồng bộ trạng thái từng phần.
 *
 * Cuộn ngược lấy trang cũ hơn qua cursor `before`; các trang cũ đã tải nằm yên trong kho.
 *
 * KHO và THỨ ĐƯỢC VẼ là hai chuyện khác nhau. Kho chỉ phình: mỗi trang cũ lật về đều nằm lại
 * đó, và nhịp poll ở trên hoà nguyên trang mới nhất vào nó. Nếu vẽ thẳng cả kho thì sau khi
 * đọc ngược năm trang, sảnh dựng 250 thẻ tin và MỖI 2,5 giây React đi so lại từng cái một —
 * đó mới là thứ làm sảnh giật, không phải mạng. Nên phần vẽ chỉ lấy một CỬA SỔ ở đuôi kho
 * (`RENDER_WINDOW`), nới ra khi người ta cuộn ngược và co lại khi họ về đáy.
 */

type Attachment = { url: string; name: string; size: number; type: string };
type Message = {
  id: string;
  userId: string;
  author: string;
  isAdmin: boolean;
  tags: string[];
  text: string;
  sticker: string | null;
  attachments: Attachment[];
  replyTo: { id: string; author: string; excerpt: string } | null;
  reactions: Array<{ emoji: string; count: number; mine: boolean }>;
  createdAt: string;
  editedAt: string | null;
  deleted: boolean;
};

const POLL_MS = 2500;
const QUICK_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🔥"];

/**
 * CỬA SỔ VẼ — bao nhiêu tin ở cuối kho được dựng thành thẻ thật.
 *
 * 60 chứ không phải 50 (một trang feed) là có chủ ý: lượt tải đầu về đúng 50 tin, nên cửa sổ
 * phải RỘNG HƠN một trang để lần vẽ đầu tiên không cắt mất gì và không kích một lượt nới ngay
 * lúc mở trang. Phần dôi ra cũng là chỗ cho các tin mới đến trong lúc người ta đang đọc.
 *
 * Nới thêm 40 mỗi lượt cuộn tới đỉnh — lấy từ KHO, không phải từ mạng: những tin ấy đã nằm sẵn
 * trong bộ nhớ từ lần lật trang trước, nên nới cửa sổ là việc tức thì. Chỉ khi cửa sổ đã trùm
 * hết kho mới đi xin trang cũ hơn.
 */
const RENDER_WINDOW = 60;
const RENDER_WINDOW_STEP = 40;

/** Cách đỉnh bao nhiêu thì coi là "người ta muốn đọc ngược" — nới cửa sổ hoặc lật trang cũ. */
const NEAR_TOP_PX = 80;

/** Hai tin cùng một người cách nhau dưới ngần này thì gộp chung một khoảnh. */
const GROUP_WINDOW_MS = 5 * 60 * 1000;

/**
 * Đường kính chân dung trong sảnh, và cũng là bề rộng LÀN mà tin nối tiếp phải chừa ra
 * (`.chat-avatar-gap`) — một con số cho cả hai, vì hai lane lệch nhau một pixel là cả cột bong
 * bóng của một người gãy hàng lề.
 *
 * Đo bằng MẮT trên ảnh chụp thật, không suy từ con số. Từng là 78px; hạ còn 62px ngày
 * 09/08/2026 vì đạo hữu thấy cả hàng danh tính quá khổ. Phải đi CÙNG LƯỢT với `.chat-tagframe`
 * (92→74px) và `.chat-author` (1.2→1.05rem) trong globals.css: chân dung giữ đúng tỉ lệ 0,77 so
 * với chiều cao dùng thật của bài vị (74 − 2×13 = 48px), vẫn nhỉnh hơn nó một bậc vì đây là mặt
 * người còn bài vị chỉ là danh xưng đi kèm. Đổi lẻ một trong ba số là lệch thế cân ấy.
 *
 * Lượt thu nhỏ 17/08/2026 KHÔNG đụng tới ba số đó — nó chỉ lấy lại đệm, khe và chiều cao chết
 * của làn chân dung, tức những chỗ không có gì để đọc.
 */
const AVATAR_SIZE = 62;

/**
 * `useLayoutEffect` ở trình duyệt, `useEffect` khi dựng phía server.
 *
 * Phép bù chỗ cuộn BẮT BUỘC phải xong trước khi trình duyệt vẽ: nới cửa sổ là chèn 40 thẻ vào
 * PHÍA TRÊN tầm nhìn, để tới `useEffect` thì người đọc thấy đúng một khung hình nội dung nhảy
 * vọt xuống. Nhưng gọi thẳng `useLayoutEffect` thì React kêu warn ở lượt render phía server —
 * component client vẫn được dựng ra HTML. Chọn theo môi trường, một lần, ở cấp module.
 */
const useBeforePaint = typeof window === "undefined" ? useEffect : useLayoutEffect;

/** GIF của GIPHY gửi đi dưới dạng đính kèm — bong bóng đã biết vẽ mọi `image/*` thành ảnh. */
const GIF_MIME = "image/gif";

/**
 * Hai dấu này gác phép "bấm ra ngoài thì đóng": thân khay mang `data-chat-popup`, nút mở khay
 * mang `data-chat-popup-trigger`.
 *
 * Đánh dấu bằng thuộc tính chứ không phải bằng một rừng ref: khay cảm xúc mọc TRONG từng bong
 * bóng tin, nên số popup bằng số tin đang hiển thị — giữ ref cho từng cái là giữ một Map phải
 * dọn tay mỗi lần danh sách tin đổi. Một câu `closest()` thì không quan tâm có bao nhiêu cái.
 *
 * Nút mở cũng phải được tha: không thì bấm nút lúc khay đang mở sẽ bị đóng bởi tay này rồi
 * mở lại ngay bởi `onClick` — khay không bao giờ tắt được bằng chính nút đã mở nó.
 */
const POPUP_ATTR = "data-chat-popup";
const TRIGGER_ATTR = "data-chat-popup-trigger";

/**
 * Toạ độ các vùng bấm trên tấm khung, tính theo PHẦN TRĂM của ảnh gốc 1448×1086.
 *
 * Vì sao phần trăm chứ không phải pixel: khung co giãn theo màn hình nhưng LUÔN giữ tỉ lệ 4:3
 * (xem `.chat-frame` trong globals.css), nên một toạ độ theo % thì bám đúng chỗ ở mọi cỡ. Đây
 * là những con số của bản mẫu chia cho 1448 (ngang) và 1086 (dọc) — đừng làm tròn thêm, lệch
 * nửa phần trăm là hotspot trượt khỏi vòng tròn vẽ trong ảnh.
 *
 * Ba nút và ô nhập KHÔNG được vẽ bằng CSS: chúng đã nằm sẵn trong ảnh, kể cả dòng chữ mời
 * "Nhập nội dung trò chuyện…". Phần tử thật chỉ là vùng bấm TRONG SUỐT đặt trùng lên. Đó là
 * điều làm khung giống bản mẫu tuyệt đối — mọi lần trước vẽ lại bằng SVG/CSS đều trượt, vì
 * không tay nào chép lại được quầng sáng và vân mây của một tấm ảnh.
 */
const FRAME_HOTSPOTS = {
  attach: { left: "3.8629%", top: "91.2181%", width: "4.6647%", height: "6.0435%" },
  picker: { left: "82.7260%", top: "91.4070%", width: "4.3731%", height: "5.6658%" },
  send: { left: "89.7959%", top: "91.1237%", width: "4.9562%", height: "6.4211%" },
} as const;

const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });

const fmtDay = (iso: string) =>
  new Date(iso).toLocaleDateString("vi-VN", { weekday: "long", day: "numeric", month: "numeric", year: "numeric" });

const fmtSize = (n: number) =>
  n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)}MB` : `${Math.max(1, Math.round(n / 1024))}KB`;

/**
 * Ảnh đại diện của những người có mặt trong trang tin, tra theo userId — server gửi kèm mỗi
 * lượt trả feed. Không đóng băng vào tin nhắn: đổi ảnh là xoá object cũ, nên một URL nằm sẵn
 * trong tin cũ sẽ thành ảnh vỡ. Xem `avatarsByUserId` bên services/users.ts.
 */
type AvatarMap = Record<string, string>;

/**
 * Hoà bản đồ ảnh mới vào bản đang giữ, và điều quan trọng nằm ở phép XOÁ.
 *
 * Server chỉ kể những người CÓ ảnh, nên một người vừa bỏ ảnh sẽ đơn giản là vắng mặt trong
 * bản đồ mới. Hoà theo kiểu `{...cũ, ...mới}` thì URL cũ của họ sống mãi trong tab này — trỏ
 * vào một object đã bị xoá, tức một ô ảnh vỡ. Nên với MỌI người có mặt trong trang tin vừa
 * nhận, ta lấy giá trị mới hoặc bỏ hẳn khoá; người không có mặt trong trang này (tác giả của
 * các trang cũ đã cuộn lên) thì giữ nguyên, vì trang ấy không nói gì về họ.
 */
function mergeAvatars(current: AvatarMap, messages: Message[], incoming: AvatarMap): AvatarMap {
  const next = { ...current };
  for (const message of messages) {
    const url = incoming[message.userId];
    if (url) next[message.userId] = url;
    else delete next[message.userId];
  }
  return next;
}

export function ChatRoom({
  me,
  tagFrames,
}: {
  me: { id: string; name: string };
  /** Sổ khung tag từ app_settings — server đưa lúc render, xem ghi chú bên page.tsx. */
  tagFrames: TagFrame[];
}) {
  const [store, setStore] = useState<Map<string, Message>>(new Map());
  const [avatars, setAvatars] = useState<AvatarMap>({});
  const [typing, setTyping] = useState<string[]>([]);
  const [text, setText] = useState("");
  const [staged, setStaged] = useState<Attachment[]>([]);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [panel, setPanel] = useState<PickerTab | "none">("none");
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [notice, setNotice] = useState("");
  const [stuck, setStuck] = useState(true);
  const [unseen, setUnseen] = useState(0);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [reachedTop, setReachedTop] = useState(false);
  /** Bao nhiêu tin ở cuối kho đang được dựng thẻ — xem RENDER_WINDOW. */
  const [windowSize, setWindowSize] = useState(RENDER_WINDOW);
  /** Kho MongoDB chưa được tông chủ tạo — sảnh treo biển thay vì giả vờ trống. */
  const [storeClosed, setStoreClosed] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const lastTypingSent = useRef(0);
  const stuckRef = useRef(true);
  stuckRef.current = stuck;
  /**
   * Chiều cao vùng cuộn đo NGAY TRƯỚC một lượt nới cửa sổ, để bù lại đúng phần vừa mọc thêm
   * phía trên. Khác `null` cũng là cờ「đang có một lượt nới chưa bù xong」— một cú cuộn nữa
   * trong khoảnh khắc ấy phải đứng chờ, không thì hai lượt nới chồng nhau và mốc đo thứ hai
   * đo nhầm cái chiều cao đã mọc rồi.
   */
  const growAnchorHeight = useRef<number | null>(null);

  /**
   * Đặt chỗ cuộn TỨC THÌ, không bao giờ để nó trượt mượt.
   *
   * `.chat-scroll` mang `scroll-behavior: smooth` — đúng cho một cú bấm「về cuối」của con
   * người, nhưng SAI cho mọi lượt đặt chỗ của mã. Đo được ngày 11/08/2026: lượt ghim-xuống-đáy
   * lúc mở sảnh chạy thành một animation BẮT ĐẦU TỪ scrollTop 0, và mỗi nhịp của animation ấy
   * bắn ra một sự kiện `scroll`. Mấy nhịp đầu mang scrollTop ≈ 0, nên `onScroll` đọc thành
   *「người ta đang cuộn lên đọc quá khứ」: hạ cờ dính đáy, rồi nới cửa sổ (bản cũ thì bắn hẳn
   * một `loadOlder()` — một request thừa mỗi lần ai đó mở Phòng Chat).
   *
   * Hậu quả thấy được: mở sảnh ra mà không đứng ở tin mới nhất, lệch hẳn hơn nghìn pixel.
   * `behavior: "instant"` cắt đứt chuyện đó — một lần đặt, một sự kiện, ở đúng chỗ cuối cùng.
   */
  const jumpScrollTo = (el: HTMLElement, top: number) => {
    el.scrollTo({ top, behavior: "instant" });
  };

  const messages = useMemo(
    () =>
      [...store.values()].sort(
        (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
      ),
    [store],
  );

  /**
   * Phần kho ĐƯỢC VẼ, kèm hai phán quyết về hình thức của từng tin.
   *
   * `showDay` và `grouped` được tính so với tin liền trước TRONG KHO, không phải trong cửa sổ.
   * Khác biệt ấy quan trọng: tính theo cửa sổ thì tin đầu cửa sổ luôn tự mọc một mốc ngày (vì
   * nó không có tin nào đứng trước), rồi mốc ấy BIẾN MẤT ngay khi cửa sổ nới ra thêm 40 tin —
   * một dòng chữ nhấp nháy mỗi lần cuộn. Đọc ngược ra kho thì thứ vẽ ra luôn bằng đúng thứ mà
   * một lượt vẽ toàn bộ sẽ cho, bất kể cửa sổ đang rộng bao nhiêu.
   */
  const visible = useMemo(() => {
    const start = Math.max(0, messages.length - windowSize);
    return messages.slice(start).map((msg, offset) => {
      // `undefined` ở đúng một chỗ: tin cổ nhất của cả kho. Nó luôn được mốc ngày, như cũ.
      const prev = messages[start + offset - 1];
      const showDay =
        !prev || new Date(prev.createdAt).toDateString() !== new Date(msg.createdAt).toDateString();
      const grouped =
        !showDay &&
        prev != null &&
        prev.author === msg.author &&
        new Date(msg.createdAt).getTime() - new Date(prev.createdAt).getTime() < GROUP_WINDOW_MS;
      return { msg, showDay, grouped };
    });
  }, [messages, windowSize]);

  /** Cửa sổ đã trùm hết kho chưa — quyết định cuộn lên nữa thì nới cửa sổ hay đi xin trang cũ. */
  const windowCoversStore = visible.length >= messages.length;

  const merge = useCallback((incoming: Message[], incomingAvatars: AvatarMap = {}) => {
    // Bản đồ ảnh vẫn phải được hoà kể cả khi trang tin RỖNG? Không — trang rỗng thì không có
    // ai để nói về, và `mergeAvatars` sẽ không đụng tới khoá nào. Ra sớm cho khỏi vẽ lại.
    if (incoming.length === 0) return;
    setStore((prev) => {
      const next = new Map(prev);
      for (const msg of incoming) next.set(msg.id, msg);
      return next;
    });
    setAvatars((prev) => mergeAvatars(prev, incoming, incomingAvatars));
  }, []);

  // ---- Nhịp poll -----------------------------------------------------------------------
  const knownIds = useRef(new Set<string>());

  useEffect(() => {
    let alive = true;

    const tick = async () => {
      try {
        const res = await fetch("/api/chat", { cache: "no-store" });
        if (!alive) return;
        if (res.status === 503) {
          const data = await res.json().catch(() => ({}));
          setStoreClosed(String(data.error ?? "Tàng thư đàm đạo chưa khai mở."));
          return;
        }
        if (!res.ok) return;
        setStoreClosed(null);
        const data: { messages: Message[]; typing: string[]; avatars?: AvatarMap } = await res.json();

        const fresh = data.messages.filter((m) => !knownIds.current.has(m.id));
        for (const m of data.messages) knownIds.current.add(m.id);

        merge(data.messages, data.avatars ?? {});
        setTyping(data.typing);

        // Người đang đọc lại quá khứ thì đừng giật họ xuống đáy — chỉ đếm tin mới cho cái
        // nút "về cuối" kể.
        if (!stuckRef.current && fresh.length > 0) {
          setUnseen((u) => u + fresh.length);
          /**
           * …và NỚI cửa sổ đúng bằng số tin vừa tới. Cửa sổ cắt ở ĐUÔI kho, nên mỗi tin mới
           * đẩy mép dưới xuống một nấc thì mép trên cũng tụt theo một nấc — tức vài thẻ ở
           * phía trên tầm nhìn bị gỡ, vùng cuộn thấp xuống, và đoạn người ta đang đọc nhảy
           * mất chỗ. Cộng thêm ngần ấy là ghim mép trên đứng yên: người đọc quá khứ không hề
           * hay biết có tin mới nào vừa nối vào đáy.
           *
           * Chỉ làm khi KHÔNG dính đáy. Dính đáy thì mép trên tụt là đúng — đó chính là phép
           * thu cửa sổ, và mắt đang nhìn ở đáy chứ không nhìn lên trên.
           */
          setWindowSize((n) => n + fresh.length);
        }
      } catch {
        /* mạng chớp — nhịp sau gặp lại */
      }
    };

    tick();
    const timer = setInterval(tick, POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [merge]);

  // ---- Bấm ra ngoài thì đóng khay ------------------------------------------------------
  const popupOpen = panel !== "none" || pickerFor !== null;

  /** Mở khay này thì đóng khay kia — hai cái cùng bung ra một lúc là rối, không phải tính năng. */
  const openPanel = (tab: PickerTab) => {
    setPickerFor(null);
    setPanel((current) => (current === tab ? "none" : tab));
  };

  const openReactionPicker = (id: string) => {
    setPanel("none");
    setPickerFor((current) => (current === id ? null : id));
  };

  useEffect(() => {
    if (!popupOpen) return;

    const closeAll = () => {
      setPanel("none");
      setPickerFor(null);
    };

    // `pointerdown` chứ không phải `click`: chuột nhấn xuống là đã có ý rời khay, và một cú
    // kéo bắt đầu ngoài khay sẽ không bao giờ sinh ra `click` để mà đóng. Nó cũng bao luôn
    // màn cảm ứng, khỏi phải nghe thêm `touchstart`.
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest(`[${POPUP_ATTR}], [${TRIGGER_ATTR}]`)) return;
      closeAll();
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeAll();
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [popupOpen]);

  // Dính đáy: mỗi khi có tin mới và người xem đang ở đáy, cuộn theo.
  useEffect(() => {
    if (stuck && scrollRef.current) {
      jumpScrollTo(scrollRef.current, scrollRef.current.scrollHeight);
      setUnseen(0);
      // Về tới đáy là thôi cần đống quá khứ vừa đọc — thu cửa sổ lại để sảnh khỏi mang theo
      // vài trăm thẻ tin suốt phiên. An toàn vì mọi thẻ bị gỡ đều nằm PHÍA TRÊN tầm nhìn:
      // vùng cuộn thấp xuống, trình duyệt tự kẹp `scrollTop` và ta vẫn đứng ở đáy. Cuộn ngược
      // lại thì cửa sổ nở ra từ kho, không tốn một request nào.
      setWindowSize(RENDER_WINDOW);
    }
  }, [messages, typing, stuck]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    setStuck(atBottom);
    if (atBottom) setUnseen(0);

    if (el.scrollTop >= NEAR_TOP_PX || messages.length === 0) return;

    // Còn tin ĐÃ NẰM SẴN trong kho mà chưa dựng thẻ thì nới cửa sổ trước — tức thì, không một
    // request nào. Chỉ khi cửa sổ đã trùm hết kho mới phải đi hỏi server trang cũ hơn.
    if (!windowCoversStore) {
      if (growAnchorHeight.current != null) return;
      growAnchorHeight.current = el.scrollHeight;
      setWindowSize((n) => Math.min(messages.length, n + RENDER_WINDOW_STEP));
      return;
    }

    if (!loadingOlder && !reachedTop) void loadOlder();
  };

  /**
   * Bù chỗ cuộn ngay sau một lượt nới cửa sổ, TRƯỚC khi trình duyệt vẽ.
   *
   * Cùng phép tính với `loadOlder` (đo chiều cao trước/sau rồi cộng phần chênh), nhưng khác
   * thời điểm: `loadOlder` là async nên nó tự bù trong một `requestAnimationFrame` sau khi
   * `await` xong, còn nới cửa sổ là một lượt đặt state ĐỒNG BỘ — chỗ để bù là ngay sau khi
   * React gắn thẻ mới vào DOM và trước lượt vẽ kế tiếp.
   */
  useBeforePaint(() => {
    const el = scrollRef.current;
    const before = growAnchorHeight.current;
    if (!el || before == null) return;
    jumpScrollTo(el, el.scrollTop + (el.scrollHeight - before));
    growAnchorHeight.current = null;
  }, [windowSize]);

  const loadOlder = async () => {
    const oldest = messages[0];
    if (!oldest) return;
    setLoadingOlder(true);
    try {
      const el = scrollRef.current;
      const prevHeight = el?.scrollHeight ?? 0;
      const res = await fetch(
        `/api/chat?beforeAt=${encodeURIComponent(oldest.createdAt)}&beforeId=${oldest.id}`,
        { cache: "no-store" },
      );
      if (!res.ok) return;
      const data: { messages: Message[]; avatars?: AvatarMap } = await res.json();
      if (data.messages.length === 0) setReachedTop(true);
      // Trang cũ không phải "tin mới" — ghi danh trước khi merge để nút về-cuối không đếm nhầm.
      for (const m of data.messages) knownIds.current.add(m.id);
      merge(data.messages, data.avatars ?? {});
      // Nới cửa sổ ĐỦ để trang vừa xin về được vẽ ra. Thiếu dòng này thì lượt lật trang tốn
      // một request rồi chẳng ai thấy gì: cửa sổ vẫn cắt ở đuôi kho, còn tin mới về thì nằm ở
      // đầu. Cộng dôi vài tin (hai tin trùng mili-giây có thể về hai lần) là vô hại — phép cắt
      // tự kẹp ở đầu mảng.
      setWindowSize((n) => n + data.messages.length);
      // Giữ nguyên chỗ đang đọc: bù đúng phần chiều cao vừa mọc thêm phía trên. TỨC THÌ —
      // một phép bù chỗ mà trượt mượt thì chính nó là cú trôi nó sinh ra để chặn (xem
      // `jumpScrollTo`).
      requestAnimationFrame(() => {
        if (el) jumpScrollTo(el, el.scrollTop + (el.scrollHeight - prevHeight));
      });
    } finally {
      setLoadingOlder(false);
    }
  };

  // ---- Thao tác ------------------------------------------------------------------------
  const post = async (payload: Record<string, unknown>) => {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setNotice(String(data.error ?? "Có trắc trở — thử lại."));
      setTimeout(() => setNotice(""), 3500);
    }
    return res.ok;
  };

  const refresh = async () => {
    const res = await fetch("/api/chat", { cache: "no-store" });
    if (res.ok) {
      const data = await res.json();
      merge(data.messages, data.avatars ?? {});
      setTyping(data.typing);
    }
  };

  const send = async () => {
    const clean = text.trim();
    if (!clean && staged.length === 0) return;
    const ok = await post({
      op: "send",
      body: { text: clean, attachments: staged, replyTo: replyTo?.id ?? null },
    });
    if (ok) {
      setText("");
      setStaged([]);
      setReplyTo(null);
      setPanel("none");
      setStuck(true);
      void post({ op: "typing", typing: false });
      await refresh();
      inputRef.current?.focus();
    }
  };

  const sendSticker = async (emoji: string) => {
    setPanel("none");
    if (await post({ op: "send", body: { text: "", sticker: emoji, replyTo: replyTo?.id ?? null } })) {
      setReplyTo(null);
      setStuck(true);
      await refresh();
    }
  };

  /**
   * GIF đi đường ĐÍNH KÈM, không phải đường sticker: bytes ở lại CDN của GIPHY và tin chỉ giữ
   * URL, nên bong bóng vẽ nó bằng đúng nhánh `image/*` đã có sẵn — không thêm một hình dạng
   * tin nào để mọi chỗ khác phải học.
   */
  const sendGif = async (gif: Gif) => {
    setPanel("none");
    const ok = await post({
      op: "send",
      body: {
        text: "",
        attachments: [{ url: gif.url, name: gif.name, size: gif.size, type: GIF_MIME }],
        replyTo: replyTo?.id ?? null,
      },
    });
    if (ok) {
      setReplyTo(null);
      setStuck(true);
      await refresh();
    }
  };

  const onType = (value: string) => {
    setText(value);
    const now = Date.now();
    if (now - lastTypingSent.current > 2000) {
      lastTypingSent.current = now;
      void post({ op: "typing", typing: true });
    }
  };

  const upload = async (files: FileList | File[]) => {
    setUploading(true);
    try {
      for (const file of [...files].slice(0, 6 - staged.length)) {
        const form = new FormData();
        form.append("file", file);
        const res = await fetch("/api/chat/upload", { method: "POST", body: form });
        const data = await res.json().catch(() => ({}));
        if (res.ok) {
          setStaged((prev) => [...prev, data as Attachment]);
        } else {
          setNotice(String(data.error ?? "Không gửi được file."));
          setTimeout(() => setNotice(""), 5000);
          break;
        }
      }
    } finally {
      setUploading(false);
    }
  };

  const react = async (id: string, emoji: string) => {
    setPickerFor(null);
    // Lạc quan: đảo tại chỗ cho tay bấm thấy liền; nhịp poll kế sẽ nói sự thật.
    setStore((prev) => {
      const next = new Map(prev);
      const msg = next.get(id);
      if (!msg) return prev;
      const existing = msg.reactions.find((r) => r.emoji === emoji);
      const reactions = existing
        ? msg.reactions
            .map((r) =>
              r.emoji === emoji ? { ...r, mine: !r.mine, count: r.count + (r.mine ? -1 : 1) } : r,
            )
            .filter((r) => r.count > 0)
        : [...msg.reactions, { emoji, count: 1, mine: true }];
      next.set(id, { ...msg, reactions });
      return next;
    });
    await post({ op: "react", id, emoji });
  };

  const saveEdit = async () => {
    if (!editing) return;
    if (await post({ op: "edit", id: editing.id, text: editing.text })) {
      setEditing(null);
      await refresh();
    }
  };

  const remove = async (id: string) => {
    if (await post({ op: "delete", id })) await refresh();
  };

  // ---- Vẽ ------------------------------------------------------------------------------

  return (
    <div className="chat-frame">
    {/* Tấm khung. `alt=""` + aria-hidden: nó là TRANG TRÍ, mọi thứ đọc được đã nằm ở chữ thật
        bên trên nó. Dùng <img> thường chứ không phải next/image — ảnh này luôn phủ trọn khung
        với kích thước do CSS quyết (`background-size` không dùng được vì cần `priority` cho
        thứ nằm ngay màn hình đầu), và bản .webp 38KB đã nhỏ hơn mọi biến thể mà bộ tối ưu
        sinh ra. eslint-disable vì cùng lý do đó. */}
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img className="chat-frame-img" src="/chat-frame.webp" alt="" aria-hidden draggable={false} />
    <div
      className="chat-shell"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        if (e.dataTransfer.files.length) void upload(e.dataTransfer.files);
      }}
    >

      {/* Dải trên đường kẻ của tấm khung vốn để trống — đặt danh xưng sảnh vào đúng chỗ ấy. */}
      <header className="chat-head">
        <h1 className="h-display text-gilded">Phòng Chat</h1>
        <p>Sảnh đàm đạo chung — mọi môn đồ đã nhập môn đều nghe thấy nhau.</p>
      </header>

      <div ref={scrollRef} onScroll={onScroll} className="chat-scroll">
        {/* CHỈ khi cửa sổ đã trùm hết kho. Thiếu vế ấy thì dòng này thành một lời nói dối:
            server đã hết trang cũ để đưa (`reachedTop`) không có nghĩa là thứ đang hiện ra bắt
            đầu từ tin cổ nhất — cửa sổ vẫn có thể đang cắt ở giữa kho, và người đọc được bảo
            rằng phía trên chẳng còn gì trong khi cuộn thêm một nhịp là ra cả trăm tin. */}
        {reachedTop && windowCoversStore && messages.length > 0 && (
          <p className="chat-top-note">— Khởi nguồn của sảnh —</p>
        )}
        {loadingOlder && <p className="chat-top-note">Đang lật trang cũ…</p>}
        {storeClosed && (
          <div className="chat-closed">
            <span>🏮</span>
            <p>{storeClosed}</p>
          </div>
        )}
        {!storeClosed && messages.length === 0 && (
          <p className="chat-top-note">Sảnh còn tĩnh lặng — hãy là người khai bút.</p>
        )}

        {visible.map(({ msg, showDay, grouped }) => {
          /**
           * CHỈ dùng cho quyền Sửa/Thu hồi, KHÔNG dùng cho cách vẽ.
           *
           * Sảnh này cố ý dựng tin của mình y hệt tin của người khác — cùng lề trái, cùng chân
           * dung, cùng tên, cùng màu bong bóng (yêu cầu 11/08/2026). Đây là sảnh đàm đạo đông
           * người chứ không phải hộp tin nhắn hai người: lối chat-app quen thuộc (mình bên
           * phải, người khác bên trái) chia đôi màn hình theo một trục vô nghĩa khi có sáu
           * người nói, và bong bóng của mình thì mất luôn tên lẫn bài vị. Một hàng lề duy nhất
           * đọc như một biên bản: ai nói, nói gì, theo thứ tự.
           *
           * Nên đừng buộc lại cách vẽ vào biến này. Muốn tìm tin của mình thì chân dung và tên
           * đã ở đó — như của mọi người.
           */
          const own = msg.userId === me.id;

          return (
            <div key={msg.id}>
              {showDay && <div className="chat-day"><span>{fmtDay(msg.createdAt)}</span></div>}

              <div className={`chat-row ${grouped ? "grouped" : ""}`}>
                {grouped ? (
                  // Tin nối tiếp cùng người: chừa đúng LÀN của chân dung để mọi bong bóng của
                  // một người thẳng một hàng lề — và chỉ có thế. Trước 17/08/2026 chỗ này là
                  // chính vòng tròn ấy đeo lớp `.invisible`: ẩn mà vẫn chiếm 62px chiều cao,
                  // tức mỗi tin nối tiếp gánh ~24px trống không ai đọc được. Xem
                  // `.chat-avatar-gap` trong globals.css.
                  <span className="chat-avatar-gap" style={{ width: AVATAR_SIZE }} aria-hidden="true" />
                ) : (
                  <Avatar name={msg.author} url={avatars[msg.userId]} size={AVATAR_SIZE} />
                )}

                <div className="chat-bubble-col">
                  {!grouped && (() => {
                    // Tag nào có khung thì đeo khung nấy — một người mang hai danh xưng đều
                    // có bài vị thì hiện CẢ HAI. Tag không có khung mới rớt xuống làm huy
                    // hiệu chữ; không tag nào có khung thì đeo khung mặc định (bài vị
                    //「Đệ tử」). Sổ trống là sảnh vẽ y như trước.
                    const frames = framesForTags(msg.tags, tagFrames);
                    // So bằng nhãn ĐÃ CHUẨN HOÁ, và lọc theo TẬP khung đã chọn chứ không chỉ
                    // một cái: thiếu bước này thì tag thứ hai vừa được vẽ thành bài vị lại
                    // hiện thêm một viên chữ trùng tên ngay cạnh nó.
                    const framed = new Set(frames.map((f) => normalizeTagLabel(f.label)));
                    const plainTags = msg.tags.filter((t) => !framed.has(normalizeTagLabel(t)));
                    return (
                      <span className="chat-author">
                        {msg.author}
                        {/* Vương miện chỉ hiện khi KHÔNG có bài vị nào — bài vị đã nói đủ về
                            thân phận rồi, thêm một dấu ✦ nữa là thừa. */}
                        {msg.isAdmin && frames.length === 0 && (
                          <em className="chat-crown" title="Tông chủ">✦</em>
                        )}
                        {frames.map((f) => (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img key={f.label} className="chat-tagframe" src={f.url} alt={f.label} title={f.label} loading="lazy" decoding="async" />
                        ))}
                        {plainTags.map((t) => (
                          <i key={t} className="chat-tag">{t}</i>
                        ))}
                      </span>
                    );
                  })()}

                  <div className={`chat-bubble ${msg.sticker ? "sticker" : ""}`}>
                    {msg.replyTo && (
                      <div className="chat-quote">
                        <b>{msg.replyTo.author}</b>
                        <span>{msg.replyTo.excerpt || "…"}</span>
                      </div>
                    )}

                    {msg.deleted ? (
                      <span className="chat-deleted">tin đã được thu hồi</span>
                    ) : editing?.id === msg.id ? (
                      <span className="chat-editbox">
                        <textarea
                          value={editing.text}
                          onChange={(e) => setEditing({ id: msg.id, text: e.target.value })}
                          rows={2}
                          autoFocus
                        />
                        <span className="chat-editbtns">
                          <button type="button" onClick={saveEdit}>Lưu</button>
                          <button type="button" onClick={() => setEditing(null)}>Thôi</button>
                        </span>
                      </span>
                    ) : (
                      <>
                        {msg.sticker && <span className="chat-sticker">{msg.sticker}</span>}
                        {msg.text && <span className="chat-text">{msg.text}</span>}
                        {msg.attachments.map((a) =>
                          // LỚP THỨ HAI của phép gác lược đồ URL (lớp thứ nhất chặn lúc ghi,
                          // xem `isSafeAttachmentUrl`). Không thừa: nó phủ cả những tin đã nằm
                          // trong kho từ trước khi có lớp kia. Không an toàn thì vẽ thành CHỮ
                          // chết — người xem vẫn biết có tệp đính kèm, mà không có gì để bấm.
                          !isSafeAttachmentUrl(a.url) ? (
                            <span key={a.name} className="chat-file" title="Đính kèm bị chặn vì địa chỉ không hợp lệ">
                              ⚠ <span>{a.name}</span> <small>đính kèm không hợp lệ</small>
                            </span>
                          ) : a.type.startsWith("image/") ? (
                            <a key={a.url} href={a.url} target="_blank" rel="noreferrer" className="chat-img">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={a.url} alt={a.name} loading="lazy" />
                            </a>
                          ) : (
                            <a key={a.url} href={a.url} target="_blank" rel="noreferrer" className="chat-file">
                              📎 <span>{a.name}</span> <small>{fmtSize(a.size)}</small>
                            </a>
                          ),
                        )}
                      </>
                    )}

                    <span className="chat-meta">
                      {fmtTime(msg.createdAt)}
                      {msg.editedAt && !msg.deleted && <i> · đã sửa</i>}
                    </span>

                    {!msg.deleted && (
                      <span className="chat-actions">
                        <button type="button" title="Thả cảm xúc" data-chat-popup-trigger onClick={() => openReactionPicker(msg.id)}>😊</button>
                        <button type="button" title="Trả lời" onClick={() => { setReplyTo(msg); inputRef.current?.focus(); }}>↩</button>
                        {own && !msg.sticker && (
                          <button type="button" title="Sửa" onClick={() => setEditing({ id: msg.id, text: msg.text })}>✎</button>
                        )}
                        {own && (
                          <button type="button" title="Thu hồi" onClick={() => void remove(msg.id)}>🗑</button>
                        )}
                      </span>
                    )}

                    {pickerFor === msg.id && (
                      <span className="chat-quickpick" data-chat-popup>
                        {QUICK_REACTIONS.map((e) => (
                          <button key={e} type="button" onClick={() => void react(msg.id, e)}>{e}</button>
                        ))}
                      </span>
                    )}
                  </div>

                  {msg.reactions.length > 0 && (
                    <div className="chat-reactions">
                      {msg.reactions.map((r) => (
                        <button
                          key={r.emoji}
                          type="button"
                          className={r.mine ? "mine" : ""}
                          onClick={() => void react(msg.id, r.emoji)}
                        >
                          {r.emoji} {r.count}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}

        {typing.length > 0 && (
          <p className="chat-typing">
            <span className="chat-dots"><i /><i /><i /></span>
            {typing.slice(0, 3).join(", ")} đang chấp bút…
          </p>
        )}
      </div>

      {!stuck && (
        <button type="button" className="chat-jump" onClick={() => { setStuck(true); }}>
          ↓ Về cuối {unseen > 0 && <b>{unseen} tin mới</b>}
        </button>
      )}

      {/* Ba khay báo trạng thái. Gom vào MỘT chồng vì layout của khung là toạ độ tuyệt đối:
          để rời nhau thì lúc cả ba cùng hiện chúng nằm đè lên nhau ở cùng một mốc `bottom`.
          Chồng này mọc NGƯỢC LÊN từ mép trên thanh nhập nên không bao giờ che ô nhập. */}
      {(notice || replyTo || staged.length > 0) && (
        <div className="chat-trays">
          {notice && <p className="chat-notice">{notice}</p>}

          {replyTo && (
            <div className="chat-replybar">
              <span>↩ Trả lời <b>{replyTo.author}</b>: {replyTo.text.slice(0, 60) || replyTo.sticker || "📎"}</span>
              <button type="button" onClick={() => setReplyTo(null)}>✕</button>
            </div>
          )}

          {staged.length > 0 && (
            <div className="chat-staged">
              {staged.map((a, i) => (
                <span key={a.url}>
                  {a.type.startsWith("image/") ? "🖼" : "📎"} {a.name}
                  <button type="button" onClick={() => setStaged(staged.filter((_, j) => j !== i))}>✕</button>
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Khay nằm TRONG thanh soạn để neo theo mép trên của nó — thanh cao lên khi ô nhập
          xuống dòng, và khay phải trôi theo. Nó `position: absolute` nên không chen vào hàng
          nút. */}
      <footer className="chat-composer">
        {panel !== "none" && (
          <ChatPicker
            tab={panel}
            onTabChange={setPanel}
            onEmoji={(e) => {
              setText((t) => t + e);
              inputRef.current?.focus();
            }}
            onSticker={(e) => void sendSticker(e)}
            onGif={(g) => void sendGif(g)}
          />
        )}
        <input
          ref={fileRef}
          type="file"
          multiple
          hidden
          onChange={(e) => { if (e.target.files?.length) void upload(e.target.files); e.target.value = ""; }}
        />
        <button
          type="button"
          className="chat-hotspot"
          style={FRAME_HOTSPOTS.attach}
          title="Gửi file"
          aria-label="Gửi file"
          disabled={uploading}
          onClick={() => fileRef.current?.click()}
        >
          {/* Chỉ hiện khi đang tải — lúc rảnh nút phải TRỐNG để lộ hình chiếc kẹp vẽ trong ảnh. */}
          {uploading && <span className="chat-hotspot-busy">…</span>}
        </button>
        {/* Ô nhập trong suốt đặt trùng lên khung đã vẽ. Không dùng thuộc tính `placeholder`:
            chữ mời đã in sẵn trong ảnh, và `.chat-input-cover` xoá nó đi — ngay từ lúc BẤM VÀO
            chứ không đợi gõ chữ đầu tiên (xem ghi chú ở lớp ấy). */}
        <textarea
          ref={inputRef}
          value={text}
          onChange={(e) => onType(e.target.value)}
          onKeyDown={(e) => {
            // Enter gửi; Alt+Enter xuống dòng. Alt+Enter không tự chèn newline trong
            // textarea nên phải tự tay đặt nó vào đúng vị trí con trỏ.
            if (e.key !== "Enter") return;
            e.preventDefault();
            if (e.altKey) {
              const el = e.currentTarget;
              const { selectionStart: a, selectionEnd: b, value } = el;
              const next = value.slice(0, a) + "\n" + value.slice(b);
              onType(next);
              requestAnimationFrame(() => el.setSelectionRange(a + 1, a + 1));
            } else {
              void send();
            }
          }}
          onPaste={(e) => {
            const files = [...e.clipboardData.files];
            if (files.length) { e.preventDefault(); void upload(files); }
          }}
          rows={1}
          maxLength={4000}
          title="Enter gửi, Alt+Enter xuống dòng"
          aria-label="Nhập nội dung trò chuyện"
          className={`chat-input ${text ? "typing" : ""}`}
        />
        {/* Tấm che dòng chữ mời in sẵn trong ảnh. LUÔN dựng, và để CSS quyết lúc nào hiện —
            `.chat-input:focus ~ &` cần nó có mặt trong DOM để chọn tới. Dựng theo điều kiện
            như trước thì lúc mới bấm vào ô (chưa gõ) nó chưa tồn tại, và dòng mời nằm chồng
            lên con trỏ. Nằm DƯỚI textarea theo z-index nên không chắn cú bấm nào. */}
        <div className="chat-input-cover" aria-hidden />
        {/* Hai nút phải: khay Emoji/sticker/GIF và ấn Truyền Âm. Cả hai là vùng bấm TRỐNG —
            mặt cười và cánh én đã được vẽ trong tấm khung, thêm icon nữa là đè hai lớp. */}
        <button
          type="button"
          className="chat-hotspot"
          style={FRAME_HOTSPOTS.picker}
          title="Emoji, sticker & GIF"
          aria-label="Emoji, sticker và GIF"
          data-chat-popup-trigger
          onClick={() => openPanel("emoji")}
        />
        <button
          type="button"
          className="chat-hotspot"
          style={FRAME_HOTSPOTS.send}
          title="Truyền Âm (Enter)"
          aria-label="Truyền Âm"
          onClick={() => void send()}
          disabled={uploading}
        />
      </footer>
    </div>
    </div>
  );
}
