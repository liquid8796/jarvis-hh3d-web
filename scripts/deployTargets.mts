/**
 * Ghép TRẠM (trong sổ gương) với PROJECT VERCEL (trong tài khoản nào đó) — phần THUẦN.
 *
 * Bài toán có một lỗ hổng dữ liệu phải nói thẳng: sổ gương KHÔNG lưu gì về Vercel. Mỗi trạm chỉ
 * có `id`, `name`, `url` và hai chuỗi kết nối đã mã hoá — không `projectId`, không `orgId`,
 * không token. Nên muốn「deploy cho mọi trạm trong sổ」thì phải suy ra phần còn thiếu.
 *
 * Suy bằng URL, không bằng một bảng ánh xạ mới. `url` của trạm là `https://<project>.vercel.app`
 * theo đúng lệ đặt tên ở deploy/mirror/README.md §9 («một cái tên cho cả ba chỗ»), nên nhãn đầu
 * của hostname CHÍNH LÀ tên project. Còn tài khoản nào cầm project ấy thì hỏi Vercel: token nào
 * nhìn thấy nó, token ấy là chủ.
 *
 * Vì sao không thêm `projectId`/`orgId` vào sổ: đó là một migration, một ô nhập trên trang admin,
 * và hai trường nữa phải giữ cho khớp thực tế. Suy từ URL không thêm gì để lệch — cái tên đã là
 * một sự thật duy nhất rồi.
 *
 * Giới hạn nói thẳng: chỉ hiểu `*.vercel.app`. Ngày tông môn có custom domain (§11) thì chỗ này
 * phải đổi, và nó sẽ BÁO LỖI RÕ chứ không đoán bừa — xem `projectNameFromUrl`.
 */

/** Một trạm trong sổ, rút gọn còn phần mà việc phát hành cần. */
export type StationEntry = { id: string; name: string; url: string };

/** Một token đọc được từ env, kèm TÊN BIẾN để còn kể tên trong thông báo (không bao giờ in giá trị). */
export type TokenSource = { envName: string; token: string };

/** Một project Vercel mà một token nào đó nhìn thấy. */
export type ProjectRef = { name: string; projectId: string; orgId: string; envName: string };

export type Resolution =
  | { ok: true; target: ProjectRef }
  | { ok: false; message: string };

/** Chỉ `VERCEL_TOKEN` và `VERCEL_TOKEN_<HẬU TỐ>` — không quét bừa mọi biến bắt đầu bằng VERCEL_. */
const TOKEN_ENV_PATTERN = /^VERCEL_TOKEN(_[A-Z0-9_]+)?$/;

/**
 * Mọi token Vercel khai trong env, theo thứ tự tất định.
 *
 * Thêm một tài khoản = thêm một biến `VERCEL_TOKEN_<TÊN>`; không phải sửa mã. Đây là mở rộng
 * đúng cái đã có (`VERCEL_TOKEN`, `VERCEL_TOKEN_MIRROR`), không phải bịa ra một cơ chế mới.
 *
 * KHỬ TRÙNG THEO GIÁ TRỊ, và đây là chỗ dễ vào sai lặng lẽ nhất: cùng một token nằm ở hai biến
 * (ví dụ thêm `VERCEL_TOKEN_MAIN` mà quên xoá `VERCEL_TOKEN`) sẽ khiến MỌI project hiện ra hai
 * lần trong danh mục, và mọi trạm bị kết luận là「nhập nhằng」— một lỗi cấu hình vô hại hoá
 * thành một lượt phát hành bị chặn hoàn toàn.
 */
export function discoverTokens(env: Record<string, string | undefined>): TokenSource[] {
  const seen = new Set<string>();
  const found: TokenSource[] = [];
  for (const envName of Object.keys(env).sort()) {
    if (!TOKEN_ENV_PATTERN.test(envName)) continue;
    const token = (env[envName] ?? "").trim();
    if (!token || seen.has(token)) continue;
    seen.add(token);
    found.push({ envName, token });
  }
  // `VERCEL_TOKEN` (trạm chính) lên đầu cho dễ đọc nhật ký; còn lại giữ thứ tự chữ cái.
  return found.sort((a, b) => Number(b.envName === "VERCEL_TOKEN") - Number(a.envName === "VERCEL_TOKEN"));
}

const VERCEL_HOST_SUFFIX = ".vercel.app";

/**
 * Tên project Vercel suy từ `url` của trạm.
 *
 * Từ chối mọi thứ không phải `https://<nhãn>.vercel.app` — KHÔNG đoán. Một cú đoán sai ở đây
 * nghĩa là phát hành mã của tông môn lên một project của người khác.
 */
export function projectNameFromUrl(url: string): { ok: true; name: string } | { ok: false; message: string } {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, message: `URL「${url}」không đọc được.` };
  }
  if (parsed.protocol !== "https:") {
    return { ok: false, message: `URL「${url}」phải là https.` };
  }
  const host = parsed.hostname.toLowerCase();
  if (!host.endsWith(VERCEL_HOST_SUFFIX)) {
    return {
      ok: false,
      message:
        `Hostname「${host}」không phải *.vercel.app nên không suy ra được tên project. ` +
        "Đây là giới hạn đã biết: ngày tông môn dùng custom domain thì scripts/deployTargets.mts " +
        "phải học cách tra domain → project qua API.",
    };
  }
  const name = host.slice(0, -VERCEL_HOST_SUFFIX.length);
  // `.vercel.app` trơ trọi, hay `a.b.vercel.app` — cả hai đều không phải một tên project.
  if (!name || name.includes(".")) {
    return { ok: false, message: `Hostname「${host}」không có đúng một nhãn trước ${VERCEL_HOST_SUFFIX}.` };
  }
  return { ok: true, name };
}

/**
 * Chọn project cho một trạm trong danh mục gộp từ MỌI token.
 *
 * Ba kết cục, và cái ở giữa là lý do hàm này tồn tại: hai tài khoản cùng có project trùng tên
 * (lệ đặt tên `auto-hh3d-<số>` không cấm điều đó) thì「token nào tìm thấy trước」sẽ phát hành
 * lên nhầm tài khoản — im lặng. Nhập nhằng phải là LỖI, không phải một phép chọn ngẫu nhiên.
 */
export function resolveTarget(station: StationEntry, catalog: readonly ProjectRef[]): Resolution {
  const named = projectNameFromUrl(station.url);
  if (!named.ok) return { ok: false, message: named.message };

  const matches = catalog.filter((p) => p.name === named.name);
  if (matches.length === 0) {
    const searched = [...new Set(catalog.map((p) => p.envName))];
    return {
      ok: false,
      message:
        `Không tài khoản nào có project「${named.name}」` +
        (searched.length > 0 ? ` (đã tìm bằng ${searched.join(", ")}).` : " — chưa khai token nào.") +
        " Thiếu token của tài khoản ấy thì thêm một biến VERCEL_TOKEN_<TÊN> vào .env.local.",
    };
  }
  if (matches.length > 1) {
    return {
      ok: false,
      message:
        `Project「${named.name}」thấy được bằng NHIỀU token (${matches.map((m) => m.envName).join(", ")}) — ` +
        "không đoán chủ nhân. Gỡ token thừa khỏi .env.local rồi chạy lại.",
    };
  }
  return { ok: true, target: matches[0] };
}
