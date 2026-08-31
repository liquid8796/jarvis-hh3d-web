"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ChatPicker, type PickerTab } from "./ChatPicker";
import { Avatar } from "@/components/Avatar";
import { isSafeAttachmentUrl } from "@/lib/validation/chat";
import { firstUnreadIndex, parseMarkMs } from "@/lib/validation/chatRead";
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

/**
 * Cách đáy bao nhiêu thì coi là「đang đứng ở tin mới nhất」— tức `stuck`, cờ mở cả phép ghim
 * đáy lẫn phép đẩy mốc đã-đọc. HAI nơi đọc nó: `onScroll` (người ta tự cuộn tới đáy) và phép
 * neo sau khi mở sảnh (vạch chưa-đọc nằm sát đáy sẵn) — hai nơi mà lệch ngưỡng là cùng một tư
 * thế đứng cho hai phán quyết khác nhau.
 */
const NEAR_BOTTOM_PX = 60;

/**
 * Lượt mở sảnh được LẬT NGƯỢC tối đa ngần này trang để tìm ranh giới đọc/chưa-đọc — tức vạch
 *「tin chưa đọc」với chút ngữ cảnh đã-đọc phía trên nó. 4 trang cộng trang đầu là 250 tin;
 * ai bỏ sảnh lâu hơn thế thì vạch nằm ở đỉnh vùng đã tải và huy hiệu vẫn nói con số THẬT —
 * một cái trần thành thật, thay vì một vòng lặp kéo cả nghìn tin chỉ để đặt một vạch kẻ.
 */
const RESTORE_MAX_HOPS = 4;

/** Vạch chưa-đọc đứng cách mép trên chừng này khi mở sảnh — đủ hở để thấy mình đang ở giữa dòng. */
const RESTORE_TOP_GAP_PX = 24;

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
 *
 * 21/08/2026: bài vị hạ tiếp 74 → 60px, CHÂN DUNG GIỮ NGUYÊN 62px — và lần này giữ nguyên mới
 * là đúng thế cân, chứ không phải phá nó. Tỉ lệ 0,77 ở trên chính là chỗ lệch so với bản thiết
 * kế (0,60): lượt 09/08 kéo chân dung xuống 53% cỡ thiết kế mà bài vị thì gần như đứng yên. Nay
 * bài vị xuống 0,81 lần, tỉ lệ về 38/62 = 0,61 — trúng bản thiết kế. Lý lẽ và hai phép đo ở
 * chú thích của `.chat-tagframe` trong globals.css.
 *
 * 31/08/2026 — 62 → 50px, và lần này CẢ BA số đi cùng nhau đúng như đoạn trên dặn: bài vị
 * 60 → 48px, tên 1,05 → 0,88rem. Hai tỉ lệ mà lượt 21/08 vừa chỉnh trúng đều được giữ y
 * nguyên: bề ngang biển / chân dung = 2,25 (trước 2,26) và chiều cao dùng thật / chân dung
 * = (48 − 2×9)/50 = 0,60 (trước 0,61).
 *
 * Vì sao lại thu: đạo hữu đưa một sảnh chat mẫu để so, và ở đó chân dung chỉ 36px cạnh chữ
 * 13px — sảnh của ta trông như đang phóng to. Không chép thẳng 36px vì bài vị của ta là chữ
 * KHẮC TRONG ẢNH, xuống quá thì mờ; 50px là mức xa nhất mà ảnh chụp 2× vẫn đọc được biển.
 */
const AVATAR_SIZE = 50;

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

/**
 * Hình vẽ cho ba nút soạn tin, và nó CHỈ hiện khi sảnh trải kín màn hình.
 *
 * Chiếc kẹp, mặt cười và cánh én đã được vẽ SẴN trong `/chat-frame.webp`; ba cái nút kia chỉ là
 * vùng bấm trong suốt đặt trùng lên. Đó là lý do bình thường chúng phải rỗng — thêm icon là đè
 * hai lớp lên nhau. Nhưng chế độ trải kín màn hình bỏ tấm ảnh đi (nó không kéo giãn được mà
 * không méo hoa văn), nên nếu không có ba hình này thì ba cái nút biến mất khỏi mắt người dùng
 * trong khi vẫn bấm được — một thanh soạn tin vô hình.
 *
 * `aria-hidden`: cả ba nút đã mang `aria-label` riêng, đọc thêm một hình nữa chỉ làm rối.
 */
function HotspotIcon({ d }: { d: string }) {
  return (
    <svg className="chat-hotspot-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d={d} />
    </svg>
  );
}

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
  /**
   * Tin mang vạch「tin chưa đọc」phía trên nó — đặt MỘT lần lúc mở sảnh rồi đứng yên cả phiên,
   * kể cả khi người ta đã đọc qua nó: vạch là chứng tích「mình đã rời đi ở đây」, đổi nó theo
   * từng nhịp đọc là biến một cột mốc thành một con trỏ nhấp nháy.
   */
  const [dividerAt, setDividerAt] = useState<string | null>(null);
  /**
   * Sảnh đang trải kín màn hình — CHỈ có nghĩa trên điện thoại.
   *
   * Khung là một tấm ảnh tỉ lệ 1372:1059, nên trên màn dọc nó bị bề rộng quyết định: ở khung
   * nhìn 390×844 khung chỉ cao 276px và bỏ trống hơn nửa màn. Phóng to là cách duy nhất lấy
   * lại chỗ ấy — nhưng nó buộc phải BỎ tỉ lệ của tấm ảnh, nên chế độ này vẽ một khung thật
   * bằng CSS thay cho tấm ảnh. Xem `.chat-full` trong globals.css.
   *
   * Khởi đầu `false` ở CẢ hai phía để lượt dựng của server và lượt dựng đầu của client ra cùng
   * một cây — đọc bề rộng màn hình ngay trong render là cách chắc chắn nhất để gãy hydrate.
   */
  const [full, setFull] = useState(false);

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
  /** Tin cần neo cuộn tới sau lượt vẽ đầu — tiêu thụ đúng một lần trong `useBeforePaint` dưới. */
  const restoreAnchor = useRef<string | null>(null);
  /** Mốc đã-đọc lớn nhất ĐÃ GỬI lên server (ms) — chặn việc lặp lại cùng một cú POST mỗi nhịp. */
  const lastMarkSent = useRef(0);

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

    /**
     * LƯỢT MỞ SẢNH — khác nhịp poll ở đúng một câu hỏi: mình đã đọc tới đâu?
     *
     * `withMark=1` mang về mốc đã-đọc và số tin chưa đọc kèm trang tin mới nhất. Có tin chưa
     * đọc thì sảnh KHÔNG ghim xuống đáy như mọi khi: nó lật ngược thêm vài trang (trần
     * `RESTORE_MAX_HOPS`) cho tới khi ranh giới đọc/chưa-đọc lọt vào vùng đã tải, đặt vạch
     *「tin chưa đọc」ở đó, rồi neo cuộn vào vạch. Toàn bộ diễn ra TRƯỚC lượt merge đầu tiên —
     * nghĩa là không có khung hình nào ghim đáy rồi mới giật ngược lên: sảnh mở ra là đã đứng
     * đúng chỗ đọc dở.
     *
     * Mọi ngả hỏng của bootstrap đều rơi về hành vi CŨ (ghim đáy): mốc là tiện nghi, không
     * phải cửa — một lượt đọc mốc trượt không được phép chặn ai vào sảnh.
     */
    const bootstrap = async () => {
      try {
        const res = await fetch("/api/chat?withMark=1", { cache: "no-store" });
        if (!alive) return;
        if (res.status === 503) {
          const data = await res.json().catch(() => ({}));
          setStoreClosed(String(data.error ?? "Tàng thư đàm đạo chưa khai mở."));
          return;
        }
        if (!res.ok) return;
        setStoreClosed(null);
        const data: {
          messages: Message[];
          typing: string[];
          avatars?: AvatarMap;
          lastReadAt?: string | null;
          unread?: number;
        } = await res.json();

        let collected = data.messages;
        let avatarsAll = data.avatars ?? {};
        const markMs = parseMarkMs(data.lastReadAt);
        const unread = typeof data.unread === "number" ? data.unread : 0;

        let anchorId: string | null = null;
        if (markMs !== null && unread > 0) {
          let hops = 0;
          // `idx === 0` nghĩa là CẢ vùng đã tải đều chưa đọc — ranh giới còn nằm trên nữa.
          // `idx > 0` là đã thấy ranh giới; `-1` là chẳng có gì chưa đọc trong vùng này (đua
          // giữa hai câu hỏi đếm/tải — vô hại, rơi về ghim đáy).
          while (alive && hops < RESTORE_MAX_HOPS && collected.length > 0) {
            if (firstUnreadIndex(collected, markMs, me.id) !== 0) break;
            const oldest = collected[0];
            const older = await fetch(
              `/api/chat?beforeAt=${encodeURIComponent(oldest.createdAt)}&beforeId=${oldest.id}`,
              { cache: "no-store" },
            );
            if (!older.ok) break;
            const page: { messages: Message[]; avatars?: AvatarMap } = await older.json();
            if (page.messages.length === 0) break;
            collected = [...page.messages, ...collected];
            avatarsAll = { ...avatarsAll, ...(page.avatars ?? {}) };
            hops += 1;
          }
          if (!alive) return;
          const idx = firstUnreadIndex(collected, markMs, me.id);
          if (idx !== -1) anchorId = collected[idx].id;
        }

        for (const m of collected) knownIds.current.add(m.id);

        if (anchorId) {
          // Cùng MỘT lượt batch với merge: hiệu ứng ghim-đáy đọc `stuck` đã là false nên không
          // tranh chỗ với phép neo vào vạch ngay sau lượt vẽ này.
          setStuck(false);
          setUnseen(unread);
          setWindowSize(Math.max(RENDER_WINDOW, collected.length));
          setDividerAt(anchorId);
          restoreAnchor.current = anchorId;
        }
        // Mốc đã ở server rồi thì đừng gửi lại chính nó; chưa có mốc thì tin đầu tiên nhìn
        // thấy sẽ lập mốc (0 thua mọi createdAt thật).
        lastMarkSent.current = markMs ?? 0;

        merge(collected, avatarsAll);
        setTyping(data.typing);
      } catch {
        /* mạng chớp — nhịp poll đầu tiên sẽ vớt lại theo lối cũ */
      }
    };

    // Poll chỉ khởi động SAU khi bootstrap ngã ngũ: một nhịp tick chen vào giữa lúc đang lật
    // ngược tìm ranh giới sẽ merge trang mới nhất với stuck còn true — sảnh ghim đáy một khung
    // hình rồi mới bị giật lên vạch, đúng cái giật mà bootstrap sinh ra để xoá.
    let timer: ReturnType<typeof setInterval> | null = null;
    void bootstrap().finally(() => {
      if (alive) timer = setInterval(tick, POLL_MS);
    });
    return () => {
      alive = false;
      if (timer) clearInterval(timer);
    };
  }, [merge, me.id]);

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
    // `full` nằm trong danh sách này vì trải/thu sảnh đổi chiều cao vùng cuộn một cách dữ dội
    // (195px ↔ gần trọn màn hình) mà không sinh ra tin mới nào. Thiếu nó thì người đang đứng ở
    // đáy bấm phóng to và rơi vào giữa quá khứ: `scrollTop` cũ giữ nguyên trong một khung cao
    // gấp bốn, nên cái đáy đã trôi đi mất mà không ai kéo họ theo.
  }, [messages, typing, stuck, full]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
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

  /**
   * Neo cuộn vào vạch「tin chưa đọc」— chạy đúng MỘT lần, ở lượt vẽ đầu tiên có tin, trước khi
   * trình duyệt kịp vẽ (cùng lý do với phép bù nới cửa sổ ở trên: sau lượt vẽ là người ta đã
   * thấy sảnh đứng nhầm chỗ một khung hình).
   *
   * Tiêu thụ ref VÔ ĐIỀU KIỆN ở lượt có tin: thẻ neo chắc chắn nằm trong DOM vì bootstrap đã
   * nới cửa sổ trùm hết vùng tải — còn nếu một ngày nào đó nó vắng mặt thì thà ghim đáy như
   * cũ chứ không được để cái ref sống sót rồi giật màn hình ở một lượt vẽ vu vơ về sau.
   */
  useBeforePaint(() => {
    const id = restoreAnchor.current;
    const el = scrollRef.current;
    if (!id || !el || visible.length === 0) return;
    restoreAnchor.current = null;
    const row = el.querySelector(`[data-msg-id="${id}"]`);
    if (!(row instanceof HTMLElement)) return;
    const top = row.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop;
    jumpScrollTo(el, Math.max(0, top - RESTORE_TOP_GAP_PX));
    /**
     * ĐO LẠI TƯ THẾ ĐỨNG sau cú neo — lỗ hổng đã ship ngày 22/08 nằm đúng ở chỗ thiếu phép đo
     * này. Bootstrap hạ `stuck` xuống false để phép ghim đáy khỏi tranh chỗ, và chỉ `onScroll`
     * nâng nó lại — nhưng khi cả phần chưa đọc lọt trong một màn hình (sảnh vắng, một hai tin
     * mới) thì cú neo trỏ về đúng scrollTop đang đứng, KHÔNG một sự kiện cuộn nào phát ra, và
     * `stuck` kẹt ở false vĩnh viễn: người ta đọc hết tin ngay trước mắt mà mốc không bao giờ
     * được đẩy — icon nổi đeo huy hiệu「1」mãi, kèm một nút「Về cuối」chỉ vào chỗ đang đứng.
     *
     * Đứng-sát-đáy sau cú neo nghĩa là tin mới nhất ĐANG trong tầm mắt — đúng định nghĩa của
     * `stuck`, chỉ là tới bằng phép neo thay vì bằng tay. Nâng cờ ở đây thì hiệu ứng đẩy mốc
     * và phép ghim đáy tự nối nhịp, y như sau một cú cuộn thật.
     */
    if (el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX) setStuck(true);
  }, [visible]);

  /**
   * Đẩy mốc đã-đọc khi đang DÍNH ĐÁY và tab đang HIỆN — hai điều kiện, thiếu cái nào cũng
   * thành nói dối: không dính đáy là đang đọc quá khứ (tin mới chưa lọt vào mắt), còn tab ẩn
   * thì sảnh vẫn tự ghim đáy theo tin mới suốt đêm và một cái mốc chạy theo nó sẽ lặng lẽ
   * đánh dấu đã-đọc cả trăm tin không ai nhìn.
   *
   * Gửi bằng fetch trần, không qua `post()`: mốc là việc hậu trường, một lượt ghi trượt không
   * đáng một tấm toast — nhịp sau có tin mới hơn sẽ tự vá.
   */
  /**
   * Tab hiện/ẩn thành state để hiệu ứng đẩy mốc THỨC DẬY lúc người ta quay lại tab: thiếu nó
   * thì đêm tin về lúc tab ẩn sẽ treo mốc mãi tới khi có thêm một tin mới nữa — huy hiệu trên
   * icon nổi cứ đeo con số cũ dù sảnh đang mở ngay trước mắt.
   */
  const [pageVisible, setPageVisible] = useState(true);
  useEffect(() => {
    const onVisibility = () => setPageVisible(document.visibilityState === "visible");
    onVisibility();
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  /**
   * Trải kín màn hình thì trang phía sau phải THÔI cuộn: sảnh là một tấm `position: fixed`, và
   * nếu body vẫn cuộn được thì cú vuốt nào trượt khỏi vùng tin sẽ kéo cả trang bên dưới đi —
   * người dùng thấy nền tiên hiệp trôi sau một khung đứng yên.
   *
   * Trả lại ĐÚNG giá trị cũ chứ không gán `""`: trang này không đặt `overflow` cho body, nhưng
   * một lượt gán cứng sẽ đè mất luật của bất kỳ lớp nào đặt sau — và hàm dọn còn chạy cả lúc
   * component lìa đời giữa chừng.
   */
  useEffect(() => {
    if (!full) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [full]);

  /**
   * Esc thoát — cùng nết với mọi lớp phủ khác của app.
   *
   * Nhường cho khay emoji/cảm xúc: sảnh có sẵn một tay nghe Esc để đóng khay (xem `popupOpen`),
   * và hai tay nghe cùng bắt một phím sẽ đóng cả hai thứ trong một nhịp — người ta bấm Esc để
   * bỏ cái khay vừa mở lại mất luôn cả màn hình đang đọc. Khay đóng trước, sảnh đóng sau.
   */
  useEffect(() => {
    if (!full || popupOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setFull(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [full, popupOpen]);

  /**
   * Màn rộng ra (xoay ngang, hoặc cửa sổ desktop kéo to) thì tự thoát.
   *
   * Luật CSS của chế độ này nằm trong `@media (max-width: 767px)`, nên trên màn rộng cái cờ
   * còn bật cũng không vẽ ra gì — nhưng nó vẫn khoá cuộn của body và vẫn chờ sẵn để bật lại
   * khi xoay về dọc. Một trạng thái vô hình mà còn tác dụng phụ là thứ tệ hơn cả hai vế.
   */
  useEffect(() => {
    if (!full) return;
    const mq = window.matchMedia("(min-width: 768px)");
    const sync = () => { if (mq.matches) setFull(false); };
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, [full]);

  useEffect(() => {
    if (!stuck || storeClosed || messages.length === 0 || !pageVisible) return;
    const newest = messages[messages.length - 1];
    const newestMs = Date.parse(newest.createdAt);
    if (!Number.isFinite(newestMs) || newestMs <= lastMarkSent.current) return;
    lastMarkSent.current = newestMs;
    void fetch("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ op: "read", at: newest.createdAt }),
    }).catch(() => {});
  }, [messages, stuck, storeClosed, pageVisible]);

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
    <div className={`chat-frame ${full ? "chat-full" : ""}`}>
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

      {/* Nút trải sảnh kín màn hình. Đứng NGOÀI `.chat-head` vì dải ấy mang `pointer-events:
          none` (nó chỉ là chữ, để nó nuốt cú bấm là vùng tin mất một dải cao 12%). CSS giấu
          hẳn nút này từ 768px trở lên — trên desktop khung đã cao bằng cả khung nhìn. */}
      <button
        type="button"
        className="chat-expand"
        onClick={() => setFull((v) => !v)}
        /* Nhãn đổi theo VIỆC SẮP LÀM, nên KHÔNG kèm `aria-pressed`: hai thứ cùng lúc thì trình
           đọc màn hình đọc ra「Thu sảnh về khung, nút bật/tắt, đang bật」— một câu tự mâu thuẫn.
           Đổi nhãn là cách rõ hơn cho một nút chỉ có hai trạng thái nhìn thấy được. */
        title={full ? "Thu sảnh về khung" : "Trải sảnh kín màn hình"}
        aria-label={full ? "Thu sảnh về khung" : "Trải sảnh kín màn hình"}
      >
        {/* Hai mũi tên chéo — ra bốn góc khi đang thu, chụm về giữa khi đang trải. */}
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          {full ? (
            <path d="M9 3v6H3M15 3v6h6M9 21v-6H3M15 21v-6h6" />
          ) : (
            <path d="M3 9V3h6M21 9V3h-6M3 15v6h6M21 15v6h-6" />
          )}
        </svg>
      </button>

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
            <div key={msg.id} data-msg-id={msg.id}>
              {showDay && <div className="chat-day"><span>{fmtDay(msg.createdAt)}</span></div>}
              {/* Vạch nằm SAU mốc ngày: mốc ngày kể「hôm nào」, vạch kể「từ đây là phần bạn
                  chưa xem」— đảo lại thì vạch chỉ vào cả cái mốc ngày, một thứ không ai cần
                  được nhắc là chưa đọc. */}
              {dividerAt === msg.id && (
                <div className="chat-unread" role="separator" aria-label="Tin chưa đọc bắt đầu từ đây">
                  <span>tin chưa đọc</span>
                </div>
              )}

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
          <HotspotIcon d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
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
          /* Dòng mời CHỈ có khi sảnh trải kín màn hình: lúc còn trong khung, câu「Nhập nội dung
             trò chuyện…」đã được in vào tấm ảnh và `.chat-input-cover` lo việc xoá nó đi — thêm
             `placeholder` ở đó là hai dòng chữ chồng lên nhau. Trải kín màn hình thì tấm ảnh đi
             mất, và một ô nhập không lời mời là một ô nhập câm. */
          /* NGẮN hơn câu in trong ảnh, và đó là vì chỗ hẹp hơn: ô nhập ở đây chỉ còn ~210px sau
             khi trừ ba nút 44px, nên「Nhập nội dung trò chuyện…」xuống hai dòng và bị cắt mất
             chữ cuối — đã thấy trên ảnh chụp 390×844. */
          placeholder={full ? "Nhập nội dung…" : undefined}
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
        >
          <HotspotIcon d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M8.5 14.5a4.5 4.5 0 0 0 7 0M9 9.5v.5M15 9.5v.5" />
        </button>
        <button
          type="button"
          className="chat-hotspot"
          style={FRAME_HOTSPOTS.send}
          title="Truyền Âm (Enter)"
          aria-label="Truyền Âm"
          onClick={() => void send()}
          disabled={uploading}
        >
          <HotspotIcon d="M21.5 2.5L10.5 13.5M21.5 2.5l-7 19-4-8.5-8.5-4 19.5-6.5z" />
        </button>
      </footer>
    </div>
    </div>
  );
}
