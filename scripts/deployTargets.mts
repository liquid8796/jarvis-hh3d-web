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

/** Sổ gương như nó nằm trong `app_settings`; `pg` là phong bì đã mã hoá. */
export type Book = { mirrors?: (StationEntry & { pg?: string })[] };

export type BookSource = { stations: StationEntry[]; from: string; warning?: string };

/**
 * Chọn ĐỌC SỔ Ở ĐÂU — thuần, mọi lượt chạm mạng đi qua tham số.
 *
 * Sổ có thẩm quyền nằm ở trạm ĐANG HOẠT ĐỘNG, không phải ở chỗ `DATABASE_URL` dưới máy trỏ tới.
 * Trạm dự phòng chỉ giữ một ẢNH CHỤP sổ từ lượt chuyển gần nhất; mọi thao tác ghi sổ về sau đều
 * rơi vào trạm hoạt động (server action gác bằng `activeSiteCheck`). Đọc nhầm chỗ thì một trạm
 * mới thêm vào sẽ VẮNG MẶT khỏi kế hoạch, mà lượt chạy vẫn kết thúc bằng câu「Mọi trạm trong sổ
 * đã mang cùng một commit」— một lời trấn an sai, đúng loại im lặng mà công cụ này sinh ra để
 * diệt. Đo được 11/08/2026 ngay khi dựng trạm thứ ba.
 *
 * FAIL-OPEN ở mọi nhánh hỏng: thà phát hành theo sổ dưới máy KÈM CẢNH BÁO còn hơn không phát
 * hành được gì vì bảng điều phối nghẽn. Nhưng mỗi lần lùi bước đều phải kêu — `warning`.
 */
export async function chooseBook(deps: {
  localBook: Book;
  activeSiteId: string | null;
  readRemote: (encryptedPg: string) => Promise<Book>;
}): Promise<BookSource> {
  const local = deps.localBook.mirrors ?? [];
  const asStations = (list: Book["mirrors"]) =>
    (list ?? []).filter((m): m is StationEntry & { pg?: string } => Boolean(m?.id && m?.url));

  if (!deps.activeSiteId) {
    return {
      stations: asStations(local),
      from: "database dưới máy (không rõ trạm hoạt động)",
      warning: "Không đọc được bảng điều phối — dùng sổ của database dưới máy, sổ này có thể đã cũ.",
    };
  }

  const activeEntry = local.find((m) => m.id === deps.activeSiteId);
  if (!activeEntry?.pg) {
    return {
      stations: asStations(local),
      from: "database dưới máy (thiếu entry trạm hoạt động)",
      warning:
        `Sổ dưới máy không có chuỗi kết nối của trạm hoạt động「${deps.activeSiteId}」— dùng sổ dưới máy. ` +
        "Đây cũng chính là triệu chứng cụt-đường-về: vào admin ghi trạm ấy vào sổ.",
    };
  }

  try {
    const remote = await deps.readRemote(activeEntry.pg);
    return { stations: asStations(remote.mirrors), from: `trạm hoạt động「${deps.activeSiteId}」` };
  } catch (err) {
    return {
      stations: asStations(local),
      from: "database dưới máy (trạm hoạt động không nối được)",
      warning:
        `Không đọc nổi sổ ở trạm hoạt động「${deps.activeSiteId}」` +
        `(${err instanceof Error ? err.message.slice(0, 80) : "lỗi lạ"}) — lùi về sổ dưới máy.`,
    };
  }
}

/** Một token đọc được từ env, kèm TÊN BIẾN để còn kể tên trong thông báo (không bao giờ in giá trị). */
export type TokenSource = { envName: string; token: string };

/** Một project Vercel mà một token nào đó nhìn thấy. */
export type ProjectRef = { name: string; projectId: string; orgId: string; envName: string };

export type Resolution =
  | { ok: true; target: ProjectRef }
  | { ok: false; message: string };

const VERCEL_HOST_SUFFIX = ".vercel.app";

/** Chỉ `VERCEL_TOKEN` và `VERCEL_TOKEN_<HẬU TỐ>` — không quét bừa mọi biến bắt đầu bằng VERCEL_. */
const TOKEN_ENV_PATTERN = /^VERCEL_TOKEN(_[A-Z0-9_]+)?$/;

/**
 * Mã trạm phải sống được ở BA nơi cùng lúc, nên nó chịu ràng buộc chặt nhất của cả ba: `SITE_ID`
 * trong env, tên project trên Vercel, và một nhãn hostname trong `https://<mã>.vercel.app`.
 *
 * Nhãn hostname là ràng buộc gắt nhất (RFC 1123): chữ thường, số, gạch ngang; không mở đầu hay
 * kết thúc bằng gạch ngang; tối đa 63 ký tự. Ép ở đây để một mã sai bị chặn TRƯỚC khi kịp tạo
 * project — chứ không phải lộ ra ở lượt deploy đầu tiên, lúc đã có rác nằm trên tài khoản.
 */
export function validateSiteId(raw: string): { ok: true; siteId: string } | { ok: false; message: string } {
  const siteId = raw.trim();
  if (!siteId) return { ok: false, message: "Thiếu mã trạm." };
  if (siteId.length > 63) return { ok: false, message: `Mã trạm dài ${siteId.length} ký tự — nhãn hostname tối đa 63.` };
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(siteId)) {
    return {
      ok: false,
      message:
        `Mã trạm「${siteId}」không hợp lệ. Chỉ chữ thường, số và gạch ngang; ` +
        "không mở đầu/kết thúc bằng gạch ngang (lệ đặt tên: auto-hh3d-<số>).",
    };
  }
  return { ok: true, siteId };
}

/** Địa chỉ trạm suy từ mã — nghịch đảo của `projectNameFromUrl`, giữ hai hàm khớp nhau. */
export function stationUrlFor(siteId: string): string {
  return `https://${siteId}${VERCEL_HOST_SUFFIX}`;
}

/**
 * Tên biến env giữ token của một trạm. Suy từ mã trạm nên không ai phải nghĩ ra tên, và
 * `discoverTokens` nhặt được ngay vì nó khớp `VERCEL_TOKEN_<HẬU TỐ>`.
 */
export function tokenEnvNameFor(siteId: string): string {
  return `VERCEL_TOKEN_${siteId.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`;
}

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

/**
 * Một dòng biến môi trường như Vercel trả về ở `GET /v9/projects/<id>/env`. Chỉ khai hai trường
 * cần dùng, và cả hai đều KHÔNG bắt buộc — đây là JSON của một API ngoài, không phải kiểu của ta.
 */
export type ProjectEnvVar = { key?: string; type?: string };

/**
 * Vercel có ba dạng biến, và ĐÂY là dạng duy nhất không đọc lại được.
 *
 * `plain` hiện nguyên văn, `encrypted` mã hoá at-rest nhưng `vercel env pull` vẫn lấy ra được,
 * còn `sensitive` thì chỉ ghi được — không API nào, không lệnh nào trả lại giá trị ấy nữa.
 */
export const UNREADABLE_ENV_TYPE = "sensitive";

/**
 * Tên những biến ở dạng KHÔNG ĐỌC LẠI ĐƯỢC, sắp xếp cho thông báo lỗi ổn định.
 *
 * Tách khỏi chỗ gọi để có thể ĐÓNG ĐINH bằng phép thử: cả hệ gương trạm đứng trên việc đọc lại
 * được env của một trạm (dựng trạm mới phải `env:pull` để lấy chuỗi kết nối integration vừa
 * tiêm; cứu một trạm cụt đường về cũng vậy), nên「biến nào không đọc lại được」là một câu hỏi
 * đáng có câu trả lời được kiểm, chứ không phải một phép lọc viết vội giữa một hàm dài.
 *
 * Chịu được dữ liệu thiếu: một dòng vắng `type` KHÔNG bị coi là sensitive (Vercel luôn trả
 * trường ấy; vắng nghĩa là hình dạng API đã đổi, và đoán bừa「sensitive」sẽ chặn mọi lượt dựng
 * trạm vì một lý do không có thật). Dòng vắng `key` vẫn được kể tên, vì nó CÓ ở đó và người đọc
 * cần biết còn một biến nữa.
 */
export function sensitiveEnvKeys(envs: readonly ProjectEnvVar[]): string[] {
  return envs
    .filter((e) => e?.type === UNREADABLE_ENV_TYPE)
    .map((e) => (e.key ?? "").trim() || "(biến không tên)")
    .sort();
}

/**
 * Độ dài tên kho. Đủ dài để không bao giờ đụng nhau, đủ ngắn để đọc trong dashboard.
 * 26 × 36¹³ ≈ 4,6 × 10²¹ khả năng — nhiều hơn số lượt dựng trạm mà cả đời tông môn cần.
 */
export const STORE_NAME_LENGTH = 14;

/**
 * Chữ CẤM xuất hiện trong tên kho.
 *
 * Ngẫu nhiên vẫn có thể tình cờ sinh ra `hh3d` (xác suất cỡ 6 × 10⁻⁶ mỗi lần) — nhỏ, nhưng
 *「tình cờ」không phải một lời hứa. Yêu cầu ở đây là tên kho KHÔNG khai nó thuộc về ai, và một
 * yêu cầu tường minh thì phải được canh tường minh.
 */
export const FORBIDDEN_IN_STORE_NAME = ["jarvis", "hh3d"] as const;

/**
 * Một tên kho NGẪU NHIÊN HOÀN TOÀN — không tiền tố, không mang chữ nào của tông môn.
 *
 * Mỗi trạm gương sống trên một tài khoản Vercel riêng, nên một cái tên chung là sợi dây nối các
 * tài khoản ấy lại với nhau trong mắt bất kỳ ai nhìn vào. Muốn biết kho nào của trạm nào thì
 * nhìn PROJECT ĐANG NỐI trong dashboard — sợi dây thật, và nó vẫn luôn ở đó.
 *
 * Ký tự đầu là CHỮ CÁI: Atlas đòi tên cluster bắt đầu bằng chữ, và một cái tên hợp lệ ở nơi
 * khắt khe nhất thì hợp lệ ở mọi nơi.
 *
 * `% ALNUM.length` có lệch phân phối (256 không chia hết cho 36) và điều đó là CÓ CHỦ Ý: đây là
 * một cái NHÃN cho người đọc, không phải bí mật. Ai sau này định dùng hàm này làm token thì phải
 * viết lại phần lấy ngẫu nhiên, đừng dùng lại.
 */
export function randomStoreName(randomBytes: (n: number) => Uint8Array): string {
  const ALPHA = "abcdefghijklmnopqrstuvwxyz";
  const ALNUM = `${ALPHA}0123456789`;
  for (let attempt = 0; attempt < 100; attempt++) {
    const bytes = randomBytes(STORE_NAME_LENGTH);
    let name = ALPHA[bytes[0] % ALPHA.length];
    for (let i = 1; i < STORE_NAME_LENGTH; i++) name += ALNUM[bytes[i] % ALNUM.length];
    if (!FORBIDDEN_IN_STORE_NAME.some((word) => name.includes(word))) return name;
  }
  // Chỉ với tới được nếu ai đó nhét vào danh sách cấm một chuỗi quá ngắn hoặc quá phổ biến.
  throw new Error(
    `Sinh 100 lần đều dính chữ cấm (${FORBIDDEN_IN_STORE_NAME.join(", ")}) — xem lại FORBIDDEN_IN_STORE_NAME.`,
  );
}
