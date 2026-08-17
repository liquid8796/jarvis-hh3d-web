/**
 * DANH SÁCH TRẠM CỦA WORKFLOW USAGE — phần THUẦN, đọc từ chính tệp workflow.
 *
 * `.github/workflows/vercel-usage.yml` giữ một bảng ba cột trong thân shell:
 *
 *     stations="auto-hh3d|jarvis8796|VERCEL_COOKIE_MAIN
 *     auto-hh3d-1|zhangyu4|VERCEL_COOKIE_AUTO_HH3D_1
 *     …"
 *
 * mã trạm | slug đội Vercel | tên secret chứa cookie phiên.
 *
 * VÌ SAO ĐỌC TỪ ĐÓ CHỨ KHÔNG CHÉP LẠI: bảng ấy KHÔNG suy ra được bằng luật. Trạm gốc dùng
 * `VERCEL_COOKIE_MAIN` chứ không phải `VERCEL_COOKIE_AUTO_HH3D`, và slug đội thì khác hẳn tên
 * tài khoản — `liquid8796` có slug `freecoursecademy`, `fatrat080796-5139` có slug
 * `smart-service`, thứ đã đoán sai hai trên ba lần (commit fe18d6c). Một bản chép thứ hai sẽ
 * lệch bản thật vào đúng ngày ai đó thêm trạm, và lệch ở đây nghĩa là ĐẨY COOKIE VÀO NHẦM Ô:
 * workflow sẽ mở tài khoản A bằng phiên của tài khoản B, rồi báo「thiếu cột」sau 90 giây chờ.
 *
 * Nên: workflow là nguồn có thẩm quyền, tệp này chỉ đọc nó.
 */

/** Một dòng của bảng — đúng ba cột, đúng thứ tự workflow ghi. */
export type UsageStation = { siteId: string; team: string; secret: string };

/** Nhãn của biến trong workflow. Đổi tên biến ấy thì đổi luôn hằng số này. */
const BLOCK_START = 'stations="';

/**
 * Bóc bảng trạm ra khỏi thân workflow.
 *
 * Ném khi hình dạng lạ, KHÔNG đoán: tệp này phục vụ một công cụ ghi secret, và một bảng đọc hụt
 * sẽ dẫn tới việc ghi cookie vào ô của trạm khác. Thà dừng và bắt người ta nhìn lại workflow.
 */
export function parseUsageStations(yamlText: string): UsageStation[] {
  const at = yamlText.indexOf(BLOCK_START);
  if (at < 0) {
    throw new Error(
      `Không thấy khối \`${BLOCK_START}…\` trong workflow — hình dạng đã đổi, đọc lại vercel-usage.yml.`,
    );
  }
  const rest = yamlText.slice(at + BLOCK_START.length);
  const end = rest.indexOf('"');
  if (end < 0) throw new Error("Khối `stations=` không có dấu nháy đóng — workflow đang hỏng.");

  const stations: UsageStation[] = [];
  for (const raw of rest.slice(0, end).split("\n")) {
    const line = raw.trim();
    // Dòng trống và dòng chú thích: vòng lặp trong workflow cũng bỏ qua đúng như vậy.
    if (line.length === 0 || line.startsWith("#")) continue;
    const cols = line.split("|").map((c) => c.trim());
    if (cols.length !== 3 || cols.some((c) => c.length === 0)) {
      throw new Error(`Dòng trạm không đủ ba cột「mã|slug đội|tên secret」: ${line}`);
    }
    stations.push({ siteId: cols[0], team: cols[1], secret: cols[2] });
  }
  if (stations.length === 0) throw new Error("Bảng trạm trong workflow rỗng — không có gì để cập nhật.");

  const trung = stations.map((s) => s.siteId).filter((id, i, all) => all.indexOf(id) !== i);
  if (trung.length > 0) throw new Error(`Workflow có mã trạm lặp: ${[...new Set(trung)].join(", ")}`);
  return stations;
}

/** Dạng thô trong tệp trình duyệt xuất ra — mọi trường đều có thể vắng, vì đây là JSON của bên khác. */
type RawEntry = { name?: unknown; value?: unknown; domain?: unknown; path?: unknown; expirationDate?: unknown };

/** Một cookie ĐÃ soi: có tên và giá trị, đủ để đưa thẳng cho Playwright. */
export type RawCookie = { name: string; value: string; domain?: string; path?: string; expirationDate?: number };

/** Cookie MỞ ĐƯỢC phiên Vercel. Thiếu nó thì tệp chỉ là một mớ cookie vô dụng. */
export const REQUIRED_COOKIE = "authorization";

const chuoi = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined);

/**
 * Đọc và soi một tệp cookie do trình duyệt xuất ra.
 *
 * Luật「phải có `authorization`」vốn nằm trong `vercelUsageFull.mts`; dời ra đây để công cụ ghi
 * secret dùng CHUNG một phép kiểm, chứ không phải một bản chép có thể nới lỏng dần. Bắt ở lúc
 * ghi secret là rẻ nhất: bắt lúc workflow chạy nghĩa là sáu tiếng sau, trong một lượt CI đỏ.
 *
 * Mục thiếu `name`/`value` bị BỎ QUA chứ không làm hỏng cả tệp — bản xuất của một số tiện ích có
 * lẫn mục rác — nhưng số bị bỏ được TRẢ VỀ để người gọi nói ra, vì im lặng vứt cookie là cách
 * êm ái nhất để một phiên thiếu mất đúng mảnh nó cần.
 */
export function readCookieFile(
  text: string,
): { ok: true; cookies: RawCookie[]; boQua: number } | { ok: false; message: string } {
  let raw: { cookies?: unknown };
  try {
    // Cắt BOM trước khi parse. `JSON.parse` coi U+FEFF là ký tự lạ và chết với một câu không ai
    // đoán ra nguyên nhân — trong khi tệp mở bằng editor thì trông hoàn toàn bình thường. Trên
    // Windows thì Notepad, `Set-Content -Encoding utf8` của PowerShell và không ít tiện ích xuất
    // cookie đều ghi BOM; đo được đúng ca ấy ngày 13/08/2026 khi dựng tệp thử bằng PowerShell.
    raw = JSON.parse(text.replace(/^﻿/, "")) as { cookies?: unknown };
  } catch (err) {
    return { ok: false, message: `không phải JSON đọc được: ${err instanceof Error ? err.message : "lỗi lạ"}` };
  }
  const list = raw?.cookies;
  if (!Array.isArray(list)) {
    return { ok: false, message: "thiếu mảng `cookies` ở gốc — xuất lại bằng tiện ích xuất cookie của trình duyệt." };
  }

  const cookies: RawCookie[] = [];
  let boQua = 0;
  for (const entry of list as RawEntry[]) {
    const name = chuoi(entry?.name);
    const value = typeof entry?.value === "string" ? entry.value : undefined;
    if (name === undefined || value === undefined) {
      boQua++;
      continue;
    }
    cookies.push({
      name,
      value,
      domain: chuoi(entry.domain),
      path: chuoi(entry.path),
      expirationDate: typeof entry.expirationDate === "number" ? entry.expirationDate : undefined,
    });
  }

  if (!cookies.some((c) => c.name === REQUIRED_COOKIE)) {
    return {
      ok: false,
      message: `thiếu cookie \`${REQUIRED_COOKIE}\` — xuất lại từ trình duyệt ĐANG đăng nhập Vercel.`,
    };
  }
  return { ok: true, cookies, boQua };
}

/** Trang mà trình duyệt THẬT SỰ dừng lại sau khi điều hướng tới bảng Usage. */
export type UsageLanding =
  | { kind: "usage" }
  | { kind: "signedOut"; url: string }
  | { kind: "elsewhere"; url: string };

/**
 * Chặng đầu tiên của đường dẫn khi Vercel đá một khách CHƯA đăng nhập.
 *
 * `auth-redirect` là cái đo được 17/08/2026 — `GET /<slug>/~/usage` không cookie trả **307 →
 * `/auth-redirect/<slug>/~/usage`**, cho MỌI slug, kể cả slug không tồn tại. Ba chặng còn lại là
 * những cửa đăng nhập quen thuộc của họ, để một lượt đổi đường không lọt qua lưới trong im lặng.
 */
const AUTH_SEGMENTS = ["auth-redirect", "login", "signin", "sso"];

/**
 * PHIÊN CHẾT KHÔNG BÁO BẰNG MÃ LỖI — nó báo bằng một cú CHUYỂN HƯỚNG, và đó là cả lý do hàm này
 * tồn tại.
 *
 * Script cào từng chỉ có một phép gác: `res.status() >= 400`. Phép ấy KHÔNG BAO GIỜ chạy được cho
 * cookie hết hạn, vì 307 thì Playwright đi theo và dừng ở một trang đăng nhập **HTTP 200**. Hệ
 * quả đo được ngày 17/08/2026 (workflow「Vercel usage」lượt 145–146): mỗi trạm cào trang đăng
 * nhập, thiếu cả tám cột, tải lại, thiếu tiếp, rồi chết sau 180 giây — năm trạm thành 1007s và
 * 1088s, gấp mười lần một lượt khoẻ (~100s), sát trần 20 phút của job. Và câu chẩn đoán cuối
 * cùng lại đoán giữa ba nguyên nhân không liên quan («trang chưa render xong, hoặc cookie chỉ mở
 * được một phần trang»), nên nhìn log cũng không biết phải sửa gì.
 *
 * SO ĐƯỜNG DẪN CHỨ KHÔNG DÒ CHỮ「login」, và phân biệt hai ngả hỏng thay vì gộp:
 *
 *   · `signedOut` — đường dẫn rơi vào một chặng xác thực. Chắc chắn là phiên, sửa bằng cookie mới.
 *   · `elsewhere` — dừng ở một chỗ khác hẳn. Nhiều khả năng Vercel DỜI trang Usage; gọi nó là
 *     「hết phiên」sẽ đẩy người ta đi làm mới cookie cả buổi cho một cái hỏng không nằm ở đó.
 *
 * Trả về nguyên văn URL đích ở cả hai ngả: đó chính là dữ kiện mà lượt hỏng 17/08 thiếu.
 */
export function reviewUsageLanding(finalUrl: string, team: string): UsageLanding {
  let path: string;
  try {
    path = new URL(finalUrl).pathname;
  } catch {
    // `about:blank` cũng lọt vào đây ở vài lượt điều hướng hỏng — không phải usage, và cũng
    // không phải cửa đăng nhập, nên nó là `elsewhere` đúng nghĩa.
    return { kind: "elsewhere", url: finalUrl };
  }

  // Cắt gạch chéo đuôi để `/x/~/usage/` không bị kể là một trang khác; giữ `/` cho gốc.
  const landed = path.toLowerCase().replace(/\/+$/, "") || "/";
  if (landed === `/${team.toLowerCase()}/~/usage`) return { kind: "usage" };

  const firstSegment = landed.split("/")[1] ?? "";
  return AUTH_SEGMENTS.includes(firstSegment)
    ? { kind: "signedOut", url: finalUrl }
    : { kind: "elsewhere", url: finalUrl };
}

/**
 * Hạn của cookie `authorization`, tính bằng ngày kể từ bây giờ — `null` khi tệp không khai hạn.
 *
 * Không phải trang trí: cả cái workflow này sinh ra để chạy sáu tiếng một lần, nên biết phiên
 * còn sống mấy ngày là biết bao giờ phải quay lại đây. Tệp xuất từ trình duyệt thường có
 * `expirationDate` (giây epoch); cookie phiên thuần thì không có, và `null` nói đúng điều đó.
 */
export function daysUntilExpiry(cookies: readonly RawCookie[], now = Date.now()): number | null {
  const auth = cookies.find((c) => c?.name === REQUIRED_COOKIE);
  const seconds = auth?.expirationDate;
  if (typeof seconds !== "number" || !Number.isFinite(seconds)) return null;
  // `trunc` chứ không `floor`: floor làm tròn XUỐNG ở cả hai phía, nên một cookie hết hạn 3 ngày
  // trước bị kể thành「4 ngày trước」— đo được lúc chạy thử 13/08/2026. Trunc cắt về phía 0, nên
  // phía dương vẫn dè dặt (29,9 ngày → 29) mà phía âm thôi thổi phồng.
  return Math.trunc((seconds * 1000 - now) / 86_400_000);
}
