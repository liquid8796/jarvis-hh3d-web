#!/usr/bin/env node
/**
 * NỬA GỬI của `/api/usage-report` — mang bảng meter đã cào tới trạm ĐANG hoạt động.
 *
 * ── VÌ SAO ĐÂY LÀ MỘT TỆP RIÊNG, KHÔNG PHẢI MƯỜI DÒNG TRONG SCRIPT CÀO ──────────────────
 *
 * Ngày 12/08/2026 lượt Actions đầu tiên chạy trơn tru: cào đủ cột cho cả hai trạm có cookie,
 * rồi cả hai lượt đẩy đều `HTTP 401 — {"error":"unauthorized"}`. Bí mật không sai. Cửa không
 * hỏng. Đo lại từng vế:
 *
 *     POST https://auto-hh3d.vercel.app/api/usage-report   (chìa đúng)  → 401
 *     POST https://auto-hh3d-1.vercel.app/api/usage-report (chìa đúng)  → 400 invalid json
 *
 * `auto-hh3d` đã NGHỈ. Nó không phục vụ nữa, nó 307 sang trạm hoạt động — đúng như middleware
 * được thiết kế. Và đây là cái bẫy: `fetch` của Node đi theo 307, giữ nguyên method lẫn body,
 * nhưng **vứt header `Authorization` khi chuyển hướng đổi origin**. Đúng chuẩn WHATWG fetch,
 * đúng cả về an toàn — không ai muốn một cú redirect gửi bí mật của mình sang máy lạ. Đo trên
 * node v24.18.0 bằng hai server cục bộ: trạm đích nhận `authorization: null`.
 *
 * Nên phía gọi thấy một cửa trả 401 mà không cách nào biết mình đã gõ nhầm cửa. Không log nào
 * nói ra điều đó: 401 là câu trả lời của trạm THỨ HAI cho một request đã bị lột chìa giữa
 * đường. Bài học này repo đã học một lần rồi ở `/api/worker` — xem bình chú `worker-conflict`
 * trong `src/lib/control/doc.ts`:「khôi lỗi không đi theo redirect mù (POST + Authorization)」—
 * chỉ là cửa usage-report sinh sau nên chưa ai mang bài học ấy sang.
 *
 * Nên: ĐI THEO CHUYỂN HƯỚNG BẰNG TAY, có mắt. Mỗi chặng tự gắn lại chìa, và chỉ đi khi chặng
 * kế thoả cả bốn điều dưới đây. Đó là khác biệt giữa「redirect có mắt」và「redirect mù」.
 *
 * ── VÌ SAO KHÔNG ĐƠN GIẢN LÀ SỬA WEB_URL CHO ĐÚNG TRẠM ───────────────────────────────────
 *
 * Vì hôm nay đúng thì sáu tuần nữa sai. Chuyển trạm là việc BÌNH THƯỜNG của hệ này (mỗi lần
 * một tài khoản Hobby chạm trần là một lượt chuyển), còn địa chỉ trong `vars.WEB_URL` thì nằm
 * ngoài repo, không ai nhớ, và sai kiểu này KHÔNG kêu — nó kêu bằng chữ「unauthorized」, tức
 * kêu sai chỗ. Bảng điều phối mới là nguồn sự thật về「trạm nào đang sống」, và chuyển hướng
 * chính là cách nó nói ra điều đó. Nghe nó thì lượt chuyển trạm kế tiếp không cần ai sửa gì.
 */

/** Dạng một dòng meter đi trên dây — khớp đúng `bodySchema` của `/api/usage-report`. */
export type Meter = { title: string; used: string; limit: string | null };

/** Cửa nhận. Chuyển hướng phải giữ NGUYÊN đường này, xem `looksLikeStationHop`. */
export const REPORT_PATH = "/api/usage-report";

/**
 * Trần số chặng.
 *
 * Một lượt chuyển trạm chỉ tốn ĐÚNG một chặng: bảng điều phối có duy nhất một `activeUrl`, nên
 * từ trạm nghỉ nào cũng nhảy thẳng tới trạm sống. Cho hai chặng là để chịu được ca hiếm — bảng
 * đổi đúng lúc đang đẩy, chặng một rơi vào trạm vừa mới nghỉ. Ba chặng thì không còn là chuyển
 * trạm nữa mà là bảng đang trỏ vòng, và im lặng đi tiếp là gửi bí mật đi lang thang.
 */
export const MAX_STATION_HOPS = 2;

/**
 * Trần thời gian MỘT chặng. Cửa này chỉ ghi một document JSONB nên phải trả lời trong tích tắc;
 * 30 giây là rộng rãi có chủ ý. Có trần vì trên CI một kết nối treo sẽ ăn hết quỹ 20 phút của
 * job rồi bị giết ở chỗ chẳng nói lên điều gì.
 */
export const PUSH_TIMEOUT_MS = 30_000;

export type PushOutcome = {
  ok: boolean;
  /** HTTP cuối cùng nhận được; `null` khi hỏng trước lúc có phản hồi (đứt mạng, hết giờ). */
  status: number | null;
  /** Mọi cửa đã thật sự gõ, theo thứ tự — để log nói ra chìa đã đi những đâu. */
  hops: string[];
  /** Lời giải thích khi hỏng, hoặc thân phản hồi khi thuận. Luôn có chữ. */
  detail: string;
};

/**
 * Chặng kế có phải vẫn là CÙNG MỘT CỬA trên một trạm khác không?
 *
 * Bốn điều, mỗi điều chặn một kiểu đi lạc:
 *   • 307/308 — hai mã DUY NHẤT hứa giữ nguyên method và body. 302/303 nghĩa là「GET chỗ kia」,
 *     đẩy tiếp một POST theo đó là tự dịch lại ý của server.
 *   • có `Location`, ghép được thành URL tuyệt đối, và là `http(s):` chứ không phải một lược đồ
 *     lạ (`javascript:`, `file:`…).
 *   • KHÔNG TỤT HẠNG: đang đứng trên `https:` thì chặng kế cũng phải `https:`. Đi từ dây mã hoá
 *     xuống dây trần là gửi `CRON_SECRET` dưới dạng chữ trần; thà hỏng. (Luật viết theo chiều
 *     「không tụt」chứ không phải「chỉ https」để một trạm chạy dưới máy — và phép thử của nó —
 *     vẫn đi được trọn đường; ngoài đời `WEB_URL` luôn là https nên hai cách là một.)
 *   • ĐÚNG `REPORT_PATH` — trạm nghỉ giữ nguyên path khi 307 (doc.ts: `activeUrl + pathname +
 *     search`). Một Location đổi đường là thứ khác đang trả lời, không phải tầng gương trạm.
 */
export function looksLikeStationHop(
  status: number,
  location: string | null,
  from: string,
): { ok: true; url: string } | { ok: false; why: string } {
  if (status !== 307 && status !== 308) {
    return { ok: false, why: `HTTP ${status} không hứa giữ nguyên POST (chỉ 307/308 mới hứa)` };
  }
  if (!location) return { ok: false, why: `HTTP ${status} nhưng không kèm Location` };

  let next: URL;
  try {
    next = new URL(location, from);
  } catch {
    return { ok: false, why: `Location không phải URL đọc được: ${location}` };
  }
  if (next.protocol !== "http:" && next.protocol !== "https:") {
    return { ok: false, why: `Location dùng lược đồ「${next.protocol}」, không phải http(s)` };
  }
  if (new URL(from).protocol === "https:" && next.protocol === "http:") {
    return { ok: false, why: "Location tụt từ https xuống http — không gắn lại chìa lên dây trần" };
  }
  if (next.pathname !== REPORT_PATH) {
    return { ok: false, why: `Location đổi sang đường「${next.pathname}」, không còn là cửa nhận bảng` };
  }
  return { ok: true, url: next.toString() };
}

/**
 * Đẩy một bảng meter lên `origin`, đi theo chuyển hướng gương trạm nếu có.
 *
 * KHÔNG BAO GIỜ NÉM: mọi kiểu hỏng — mạng đứt, hết giờ, cửa trả 4xx, chuyển hướng đáng ngờ —
 * đều về cùng một `PushOutcome` có chữ giải thích. Người gọi là một vòng lặp trên CI đang cào
 * bốn trạm; nó cần biết trạm này hỏng vì cái gì rồi đi tiếp, chứ không cần một stack trace.
 */
export async function pushUsageReport(input: {
  origin: string;
  secret: string;
  siteId: string;
  readAt: string;
  meters: Meter[];
}): Promise<PushOutcome> {
  const { origin, secret, siteId, readAt, meters } = input;
  const payload = JSON.stringify({ siteId, readAt, meters });

  let target = `${origin.replace(/\/+$/, "")}${REPORT_PATH}`;
  const hops: string[] = [target];

  for (;;) {
    let res: Response;
    try {
      res = await fetch(target, {
        method: "POST",
        // Điểm mấu chốt của cả tệp: TỰ đi, để mỗi chặng được gắn lại `Authorization`.
        redirect: "manual",
        headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
        body: payload,
        signal: AbortSignal.timeout(PUSH_TIMEOUT_MS),
      });
    } catch (err) {
      // `cause` chứ không chỉ `message`: `fetch` gói mọi thứ thành đúng một câu「fetch failed」,
      // còn tên thật của chuyện (ENOTFOUND, ECONNREFUSED, hết giờ) nằm dưới một tầng.
      const why = err instanceof Error ? `${err.name}: ${err.message}` : "lỗi lạ";
      const cause = err instanceof Error && err.cause instanceof Error ? ` (${err.cause.message})` : "";
      return { ok: false, status: null, hops, detail: `không gọi được ${target} — ${why}${cause}` };
    }

    if (res.status < 300 || res.status >= 400) {
      const body = (await res.text()).trim();
      return { ok: res.ok, status: res.status, hops, detail: body || "(thân rỗng)" };
    }

    // 3xx: trạm này đã nghỉ và đang chỉ đường sang trạm sống.
    const step = looksLikeStationHop(res.status, res.headers.get("location"), target);
    if (!step.ok) {
      return { ok: false, status: res.status, hops, detail: `chuyển hướng không đi theo được — ${step.why}` };
    }
    // `hops.length` là số cửa ĐÃ gõ, nên số chặng đã đi là `hops.length - 1`.
    if (hops.length > MAX_STATION_HOPS) {
      return {
        ok: false,
        status: res.status,
        hops,
        detail: `quá ${MAX_STATION_HOPS} chặng chuyển hướng — bảng điều phối đang trỏ vòng? ${hops.join(" → ")}`,
      };
    }
    target = step.url;
    hops.push(target);
  }
}
