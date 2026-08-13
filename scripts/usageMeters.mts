/**
 * BẢNG USAGE — phần THUẦN: cắt chữ đã render thành meter, rồi chọn đúng những cột đáng đọc.
 *
 * VÌ SAO TÁCH KHỎI `vercelUsageFull.mts`: tệp ấy gọi `chromium.launch()` ngay ở THÂN MODULE, nên
 * nhập nó vào để thử một hàm là mở một trình duyệt thật rồi treo ở đó. Cùng lý do đã buộc vòng
 * canh sổ điểm danh rời `removeGithubKhoiloi.mts` sang `rosterPurge.mts` (bản 0.82.5): một đoạn
 * mã sống trong một tệp tự chạy là một đoạn mã KHÔNG phép kiểm nào với tới được. Phép cắt chữ và
 * phép chọn cột là chỗ dễ sai nhất của cả lượt cào — chúng phải kiểm được mà không cần cookie,
 * không cần mạng, không cần Chromium.
 */
import { type Meter } from "./usagePush.mts";

/**
 * MƯỜI CỘT CẦN LẤY — và là TẤT CẢ những gì được đẩy lên sổ (13/08/2026, theo yêu cầu của tông chủ).
 *
 * Đây đúng là các cột có HẠN MỨC trên gói Hobby, tức mọi chỗ có thể chạm trần; thứ tự chép theo
 * bảng Usage trên dashboard để hai bên đối chiếu được bằng mắt.
 *
 * Trước lượt này script đẩy TRỌN bảng (~54 meter, phần lớn là số 0 của Queue/Sandbox/AI Gateway).
 * Ba cái giá của việc ấy: một document JSONB phình ra vì thứ không ai đọc; popup dài tới mức phải
 * cuộn mới thấy cột đáng lo; và phần đuôi render lúc có lúc không, nên nhịp「đợi thôi mọc」bắt
 * phải lúc nó đang nghỉ rồi tưởng đã xong.
 *
 * Ba cột đã BỎ so với bản trước — `ISR Reads`, `ISR Writes`, `Function Duration` — không mất mát:
 * hai cột ISR đứng ở 0 với kiến trúc hiện tại, còn Function Duration thì Fluid làm nó đứng yên ở 0
 * (bình chú dài trong `src/lib/services/vercelUsage.ts` kể vụ「389% hạn」đã trả giá cho điều này).
 */
export const WANTED_TITLES = [
  "Fluid Active CPU",
  "Fluid Provisioned Memory",
  "Function Invocations",
  "Edge Requests",
  "Fast Origin Transfer",
  "Edge Request CPU Duration",
  "Fast Data Transfer",
  "Image Optimization - Transformations",
  "Image Optimization - Cache Writes",
  "Image Optimization - Cache Reads",
] as const;

/**
 * U+2010…U+2015 (‐ ‑ ‒ – — ―) và U+2212 (−). Vercel đổi glyph gạch nối lúc nào cũng được mà không
 * báo ai, và một cột thiếu vì lệch đúng một ký tự thì lượt cào ĐỎ — tức mất số liệu vì một chuyện
 * thuần trình bày.
 *
 * ĐỌC CHO ĐÚNG: `[‐-―−]` KHÔNG phải bốn glyph rời — ba ký tự đầu là một KHOẢNG U+2010→U+2015 (nó
 * nuốt trọn ‑ ‒ – — ở giữa), rồi cộng thêm U+2212. Phép kiểm đóng đinh cả khoảng ấy, nên đừng
 * "dọn cho gọn" bằng cách bỏ bớt ký tự trông như thừa.
 */
const DASH_LIKE = /[‐-―−]/g;

/**
 * Chuẩn hoá tên để SO KHỚP: gạch nối về `-`, mọi khoảng trắng (kể cả nbsp) về một dấu cách, bỏ
 * hoa thường. Chỉ dùng để so — thứ ghi vào sổ luôn là tên chuẩn trong `WANTED_TITLES`, xem `pick`.
 */
export function normalizeTitle(title: string): string {
  return title.replace(DASH_LIKE, "-").replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * Một dòng số đo: `1,29 GB`, `303K`, `3h 44m`, `58s`, `0 B`, `217.4 GB-Hrs`, `0`.
 * Phải khớp CẢ dòng — `Fast Data Transfer` không được lọt vào đây.
 */
const VALUE_LINE =
  /^(?:[\d.,]+\s*(?:B|KB|MB|GB|TB|GB-Hrs|GB-hrs)|[\d.,]+[KMB]?|(?:\d+h\s*)?(?:\d+m\s*)?(?:\d+s)?)$/;

const isValue = (line: string): boolean => line !== "" && VALUE_LINE.test(line) && /\d/.test(line);

/**
 * Cắt chữ đã render thành bảng meter.
 *
 * Đi từng dòng, giữ một cái tên đang chờ. Gặp dòng-số đầu tiên sau tên thì đó là「đã dùng」;
 * gặp `/` thì dòng-số kế là「hạn」; mọi dòng-số sau đó là nấc kế của gói trả tiền — bỏ.
 */
export function parseUsageText(text: string): Meter[] {
  const lines = text.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
  const meters: Meter[] = [];
  let title: string | null = null;
  let used: string | null = null;
  let limit: string | null = null;
  let expectLimit = false;

  const flush = () => {
    if (title && used) meters.push({ title, used, limit });
    title = null;
    used = null;
    limit = null;
    expectLimit = false;
  };

  for (const line of lines) {
    if (line === "/") {
      expectLimit = true;
      continue;
    }
    if (isValue(line)) {
      if (!title) continue; // số lạc lõng, không thuộc meter nào
      if (!used) used = line;
      else if (expectLimit && !limit) {
        limit = line;
        expectLimit = false;
      }
      continue; // nấc kế: bỏ
    }
    // Dòng chữ = tên meter mới. Chốt cái đang dở trước đã.
    flush();
    title = line;
  }
  flush();
  return meters;
}

export type Selection = {
  /** Đúng các cột trong `WANTED_TITLES`, theo THỨ TỰ ấy, mang tên chuẩn. */
  picked: Meter[];
  /** Cột chưa thấy trong lượt render này. Rỗng = đã đủ. */
  missing: string[];
};

/**
 * Trong hai dòng cùng tên thì lấy dòng CÓ HẠN MỨC.
 *
 * Tên meter xuất hiện HAI chỗ trên trang: thanh điều hướng bên trái và thẻ số. Thẻ số luôn có
 * dạng「đã dùng / hạn」với cả mười cột này, còn một mục điều hướng thì cùng lắm chỉ vô tình dính
 * một con số của khối kế bên. Nên「có hạn」là dấu hiệu phân biệt rẻ nhất và đúng nhất; hoà thì lấy
 * dòng đầu. Lấy bừa dòng đầu là có ngày ghi vào sổ một con số của thanh điều hướng, và nó trông
 * y hệt một con số thật.
 */
function pickBest(a: Meter | undefined, b: Meter): Meter {
  if (!a) return b;
  if (a.limit == null && b.limit != null) return b;
  return a;
}

/** Chọn đúng mười cột cần lấy từ bảng vừa cắt. */
export function selectWanted(meters: Meter[]): Selection {
  const byTitle = new Map<string, Meter>();
  for (const meter of meters) {
    const key = normalizeTitle(meter.title);
    byTitle.set(key, pickBest(byTitle.get(key), meter));
  }

  const picked: Meter[] = [];
  const missing: string[] = [];
  for (const want of WANTED_TITLES) {
    const found = byTitle.get(normalizeTitle(want));
    // Ghi TÊN CHUẨN, không ghi tên vừa đọc: hai trạm cào cùng một ngày có thể nhận hai glyph gạch
    // nối khác nhau, và sổ thì nên nói cùng một thứ tiếng cho mọi trạm.
    if (found) picked.push({ title: want, used: found.used, limit: found.limit });
    else missing.push(want);
  }
  return { picked, missing };
}

/** Trần số tên gợi ý. Một danh sách 30 dòng thì không còn là gợi ý, nó là bãi rác. */
const NEAR_MISS_LIMIT = 8;

/** Từ đủ dài để mang nghĩa. `cpu`, `isr`, `- ` không phân biệt được gì. */
const SIGNIFICANT = 4;

/**
 * Tên ĐÃ THẤY trông gần giống một cột còn thiếu, tên chia nhiều từ chung nhất đứng trước.
 *
 * Để một lượt đỏ tự khai chuỗi thật của Vercel thay vì bắt người ta mở Chromium lên soi tay: hôm
 * nào họ đổi「Image Optimization - Cache Reads」thành một chữ khác, dòng này in ra đúng cái tên
 * mới, và lượt sửa chỉ còn là chép nó vào `WANTED_TITLES`.
 *
 * SO THEO TỪ CHUNG, KHÔNG SO TỪ ĐẦU — bản đầu (13/08/2026) chỉ so từ đầu, và nó im đúng lần đầu
 * tiên được gọi thật: lượt cào trạm `auto-hh3d-3` thiếu `Fast Data Transfer` giữa 51 meter đọc
 * được, mà một cái tên rút gọn kiểu「Data Transfer」thì không chia từ ĐẦU với nó. Một phép gợi ý
 * chỉ chạy đúng lúc cái tên gần như không đổi là một phép gợi ý vô dụng: nó câm ở đúng ca nó sinh
 * ra để phục vụ. Nay `Fast Data Transfer` chia 2 từ với `Data Transfer` nên nó bị nêu tên.
 *
 * CHỌN NHỚ HƠN CHỌN ĐÚNG, có chủ ý: chia đúng MỘT từ cũng được nêu (`Blob Stored Data` lọt vào vì
 * chữ `data`). Bù lại bằng XẾP HẠNG — chia nhiều từ nhất đứng đầu — và bằng trần 8 dòng. Một cái
 * tên thừa nằm ở dòng cuối chỉ tốn của người đọc một giây; một cái tên thiếu thì họ phải đi mở
 * Chromium, và đó chính là việc mà hàm này sinh ra để khỏi phải làm.
 */
export function nearMisses(meters: Meter[], missing: readonly string[]): string[] {
  const wordsOf = (title: string): string[] =>
    normalizeTitle(title)
      .split(/[^a-z0-9]+/)
      .filter((word) => word.length >= SIGNIFICANT);

  const missingWords = missing.map((title) => new Set(wordsOf(title)));
  const wanted = new Set(WANTED_TITLES.map(normalizeTitle));

  const scored = new Map<string, number>();
  for (const meter of meters) {
    if (wanted.has(normalizeTitle(meter.title))) continue; // đã khớp một cột khác, không phải ứng viên
    const words = wordsOf(meter.title);
    let best = 0;
    for (const set of missingWords) {
      let shared = 0;
      for (const word of words) if (set.has(word)) shared += 1;
      if (shared > best) best = shared;
    }
    // Giữ điểm CAO NHẤT cho một cái tên xuất hiện nhiều lần (thẻ và thanh điều hướng).
    if (best > 0 && best > (scored.get(meter.title) ?? 0)) scored.set(meter.title, best);
  }

  return [...scored.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, NEAR_MISS_LIMIT)
    .map(([title]) => title);
}
