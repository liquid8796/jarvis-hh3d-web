import { z } from "zod";

/**
 * Kho GIF — tìm ảnh động qua GIPHY cho tab GIF của sảnh đàm đạo.
 *
 * <b>Trước đó chỗ này định dùng Tenor.</b> Tenor thôi phát khoá miễn phí, nên đổi nhà. Hợp
 * đồng ra ngoài (`gifSearchReady`, `searchGifs`, kiểu `Gif`) giữ nguyên từng chữ — route và
 * khay chọn không phải biết ảnh động đến từ đâu.
 *
 * GIF KHÔNG đi qua tàng khố media của tông môn: chúng ở lại CDN của GIPHY và tin nhắn chỉ giữ
 * URL. Chép chúng về bucket vừa tốn dung lượng trong hạn Always Free vốn đã hẹp, vừa không
 * được gì — một GIF trên GIPHY là công khai sẵn, và bản chép về cũng chẳng bền hơn.
 *
 * Khoá API nằm ở PHÍA SERVER và không bao giờ ra tới trình duyệt — đó là toàn bộ lý do có
 * route `/api/chat/gif` đứng giữa thay vì để client gọi thẳng. Khoá lộ ra là hạn mức của tông
 * môn thành hạn mức của cả internet.
 *
 * Chưa đặt `GIPHY_API_KEY` thì `gifSearchReady()` trả false và tab GIF treo biển "chưa khai
 * mở" — đúng ranh giới mà `chat.ts` và `media.ts` đang dùng: THIẾU CẤU HÌNH là một trạng thái
 * hợp lệ, còn cấu hình có mà gọi hỏng thì phải ném kèm nguyên văn.
 */

const ENV_KEY = "GIPHY_API_KEY";
const GIPHY_BASE = "https://api.giphy.com/v1/gifs";

const RESULT_LIMIT = 24;

/** Sảnh là chỗ chung của cả tông môn — `g` là mức sạch nhất GIPHY có. */
const RATING = "g";

/**
 * Trần độ dài `q` của GIPHY. Gõ quá là API trả lỗi, nên cắt ở đây: một ô tìm im lặng hỏng khi
 * người ta dán cả câu vào là thứ không ai báo lỗi được cho ai.
 */
const MAX_QUERY_LENGTH = 50;

/**
 * Ô xem trước trong lưới: bản hẹp nhất còn xem được.
 *
 * CỐ Ý tránh mọi rendition chỉ-có-MP4 của GIPHY (`preview`, `looping`, `downsized_small`):
 * chúng có `url` trỏ tới .mp4, mà ta gửi đi dưới nhãn `image/gif` — thẻ <img> sẽ ra ô vỡ.
 */
const PREVIEW_RENDITIONS = ["fixed_width_small", "fixed_width_downsampled", "preview_gif", "fixed_width"] as const;

/** Bản thật sự gửi đi: vừa đủ nét cho bong bóng chat, không phải bản gốc vài chục MB. */
const SEND_RENDITIONS = ["downsized_medium", "downsized", "fixed_height", "original"] as const;

/** Trần độ dài URL của `attachmentSchema` bên chat.ts. Lọc ở đây để không vỡ ở lúc gửi. */
const MAX_URL_LENGTH = 2048;

/** Trần độ dài tên đính kèm của `attachmentSchema`. */
const MAX_NAME_LENGTH = 200;

/**
 * Trần `size` của `attachmentSchema`. Bản gửi đi phải nằm dưới mức này, nếu không thì cả TIN
 * bị API từ chối 400 lúc bấm gửi — và người dùng chỉ thấy "có trắc trở", không đời nào đoán
 * ra là tại cái GIF vừa chọn. Lọc ở đây thì nó lặng lẽ lùi xuống bản nhỏ hơn.
 */
const MAX_ATTACHMENT_BYTES = 64 * 1024 * 1024;

const DEFAULT_NAME = "gif";

export type Gif = {
  id: string;
  /** Tên dùng làm `name` của đính kèm — đã cắt vừa trần của schema. */
  name: string;
  previewUrl: string;
  width: number;
  height: number;
  /** URL đem gửi. */
  url: string;
  size: number;
};

/**
 * Số của GIPHY. Tài liệu của họ khai `width`/`height`/`size` là **number**, còn API thật trả
 * về **chuỗi** (`"200"`). Nhận cả hai, và thiếu hay rác thì về 0 — 0 ở đây nghĩa là "không
 * biết", đúng như khi trường ấy vắng mặt.
 */
const giphyNumber = z.coerce.number().int().nonnegative().catch(0);

const renditionSchema = z.object({
  url: z.string().url(),
  width: giphyNumber,
  height: giphyNumber,
  size: giphyNumber,
});

/**
 * `images` cố ý để lỏng (`unknown`) rồi mới soi từng rendition cần: siết cả bản đồ sẽ làm MỘT
 * rendition lạ của GIPHY đánh hỏng cả kết quả, trong khi ta chỉ dùng vài kiểu.
 */
const gifSchema = z.object({
  id: z.string().min(1),
  title: z.string().optional(),
  images: z.record(z.string(), z.unknown()),
});

const payloadSchema = z.object({
  data: z.array(z.unknown()).default([]),
  /** GIPHY đôi khi trả HTTP 200 mà báo hỏng ở trong `meta` — xem ghi chú ở `searchGifs`. */
  meta: z.object({ status: z.number().optional(), msg: z.string().optional() }).optional(),
});

export function gifSearchReady(): boolean {
  return (process.env[ENV_KEY] ?? "").trim().length > 0;
}

function pickRendition(
  images: Record<string, unknown>,
  order: readonly string[],
  maxSize = Number.POSITIVE_INFINITY,
): z.infer<typeof renditionSchema> | null {
  for (const key of order) {
    const parsed = renditionSchema.safeParse(images[key]);
    if (!parsed.success) continue;
    if (parsed.data.url.length > MAX_URL_LENGTH) continue;
    // size = 0 nghĩa là GIPHY không nói, và không nói KHÔNG phải là quá khổ — cho qua.
    if (parsed.data.size > maxSize) continue;
    return parsed.data;
  }
  return null;
}

/** Tên file cho đính kèm. GIPHY có thể trả title rỗng, và schema đòi tên dài ít nhất 1 ký tự. */
function nameOf(title: string | undefined): string {
  const trimmed = (title ?? "").trim().slice(0, MAX_NAME_LENGTH);
  return trimmed.length > 0 ? trimmed : DEFAULT_NAME;
}

/**
 * GIPHY JSON → danh sách GIF dùng được. Thuần, không mạng — nên kiểm chứng được bằng dữ liệu
 * mẫu, kể cả những bản ghi méo.
 *
 * Bản ghi hỏng bị BỎ QUA chứ không làm hỏng cả mẻ: một kết quả thiếu rendition ta cần là
 * chuyện thường của một API bên thứ ba, và đánh sập cả lưới vì nó thì người dùng mất tất cả
 * chỉ vì một ô.
 */
export function mapGiphyResults(payload: unknown): Gif[] {
  const parsed = payloadSchema.safeParse(payload);
  if (!parsed.success) return [];

  const gifs: Gif[] = [];
  for (const raw of parsed.data.data) {
    const result = gifSchema.safeParse(raw);
    if (!result.success) continue;

    const preview = pickRendition(result.data.images, PREVIEW_RENDITIONS);
    const send = pickRendition(result.data.images, SEND_RENDITIONS, MAX_ATTACHMENT_BYTES);
    if (!preview || !send) continue;

    gifs.push({
      id: result.data.id,
      name: nameOf(result.data.title),
      previewUrl: preview.url,
      width: preview.width,
      height: preview.height,
      url: send.url,
      size: send.size,
    });
  }
  return gifs;
}

/**
 * Tìm GIF. Chuỗi rỗng = lấy bảng "đang thịnh hành", nên tab GIF vừa mở đã có gì để xem thay
 * vì một khung trắng chờ người ta nghĩ ra từ khoá.
 *
 * Ném kèm nguyên văn khi GIPHY trả lỗi — route ở trên biến nó thành 502 có lời giải thích.
 */
export async function searchGifs(query: string): Promise<Gif[]> {
  const key = (process.env[ENV_KEY] ?? "").trim();
  if (!key) throw new Error(`Kho GIF chưa khai mở — thiếu ${ENV_KEY}.`);

  const trimmed = query.trim().slice(0, MAX_QUERY_LENGTH);
  const url = new URL(`${GIPHY_BASE}/${trimmed ? "search" : "trending"}`);
  url.searchParams.set("api_key", key);
  url.searchParams.set("limit", String(RESULT_LIMIT));
  url.searchParams.set("rating", RATING);
  if (trimmed) {
    url.searchParams.set("q", trimmed);
    url.searchParams.set("lang", "vi");
  }

  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    // Đọc thân lỗi để lời báo còn nói được GIPHY CHÊ gì (khoá sai, hết hạn mức…), nhưng cắt
    // ngắn: một trang HTML lỗi dán nguyên vào log thì che mất mọi thứ quanh nó.
    const detail = (await res.text().catch(() => "")).slice(0, 200);
    throw new Error(`GIPHY trả HTTP ${res.status} ${res.statusText}${detail ? ` — ${detail}` : ""}`);
  }

  const payload: unknown = await res.json();

  // GIPHY có thói quen trả HTTP 200 kèm một `meta.status` hỏng (hay gặp nhất: 403 khoá sai).
  // Không soi chỗ này thì lỗi khoá hiện ra thành "không có GIF nào khớp" — một lời nói dối
  // êm ái dẫn người đi sửa nhầm chỗ.
  const envelope = payloadSchema.safeParse(payload);
  if (envelope.success) {
    const { status, msg } = envelope.data.meta ?? {};
    if (status !== undefined && status >= 400) {
      throw new Error(`GIPHY báo lỗi ${status}${msg ? ` — ${msg}` : ""}`);
    }
  }

  return mapGiphyResults(payload);
}
