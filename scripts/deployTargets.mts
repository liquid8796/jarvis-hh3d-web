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
 * Ghi `KEY=value` vào NỘI DUNG một tệp .env — THAY dòng cũ nếu khoá đã có, chỉ thêm khi chưa có.
 *
 * Thuần (nhận chuỗi, trả chuỗi) để `verify:deploy-targets` đóng đinh được mà không chạm đĩa.
 *
 * VÌ SAO KHÔNG CHỈ NỐI THÊM MỘT DÒNG, cách mà `newMirrorStation` làm cho tới 13/08/2026: phép
 * kiểm「đã có token chưa」đọc `process.env[tên]`, mà `loadEnv` đặt biến ấy kể cả khi giá trị
 * RỖNG. Một dòng `VERCEL_TOKEN_X=` bỏ dở trong `.env.local` vì thế đọc ra chuỗi rỗng — falsy —
 * nên script kết luận là chưa có rồi nối thêm dòng thứ hai cùng khoá. Và `loadEnv` lấy dòng ĐẦU
 * (`if (!(key in process.env))`), tức dòng rỗng thắng vĩnh viễn: token nằm ngay trong tệp mà mọi
 * lượt phát hành vẫn báo「chưa khai token nào」. Không có dòng đỏ nào ở giữa.
 *
 * Nên phép này THAY dòng đầu tiên mang khoá ấy — đúng dòng mà `loadEnv` sẽ đọc — và không bao
 * giờ sinh ra khoá trùng.
 *
 * Cách tách khoá phải KHỚP `loadEnv`: bỏ dòng trống và dòng `#`, khoá là phần trước dấu `=` đầu
 * tiên, đã trim. Lệch một chỗ là hàm này sửa một dòng khác dòng mà `loadEnv` đọc.
 *
 * Cắt bằng `"\n"` chứ không phải `/\r?\n/` để giữ NGUYÊN xuống dòng của mọi dòng không đụng tới:
 * `.env.local` do `vercel env pull` sinh ra, và viết lại cả tệp theo kiểu khác là một khác biệt
 * ồn ào trong một tệp người ta hay mở ra đọc.
 */
export function upsertEnvLine(
  text: string,
  key: string,
  value: string,
): { text: string; replaced: boolean } {
  /**
   * Chặn ở đây vì đây là RANH GIỚI TIN CẬY: tệp sắp bị ghi cũng đang giữ `DATABASE_URL` và
   * `ENCRYPTION_KEY`. Một giá trị lẫn xuống dòng không làm hàm này ném — nó lặng lẽ chèn một
   * dòng khai báo giả vào giữa tệp, và thứ hỏng sẽ là một biến khác, ở một lượt chạy khác.
   * Token Vercel hôm nay không thể chứa ký tự ấy; hàm thì phải đứng vững cả với người gọi sau.
   */
  if (key.length === 0 || /[\r\n=]/.test(key)) {
    throw new Error(`Tên biến env không hợp lệ: ${JSON.stringify(key)}`);
  }
  if (/[\r\n]/.test(value)) {
    throw new Error(`Giá trị của ${key} có ký tự xuống dòng — từ chối ghi, tệp .env sẽ hỏng.`);
  }

  const lines = text.split("\n");

  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i];
    const trimmed = raw.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;
    if (trimmed.slice(0, eq).trim() !== key) continue;

    // Giữ lại `\r` của chính dòng ấy nếu tệp đang dùng CRLF.
    lines[i] = raw.endsWith("\r") ? `${key}=${value}\r` : `${key}=${value}`;
    return { text: lines.join("\n"), replaced: true };
  }

  const body = text.length === 0 || text.endsWith("\n") ? text : `${text}\n`;
  return { text: `${body}${key}=${value}\n`, replaced: false };
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
  /**
   * NHẬP NHẰNG LÀ「HAI PROJECT KHÁC NHAU CÙNG TÊN」, KHÔNG PHẢI「một project thấy bằng hai token」.
   *
   * Bản đầu từ chối ngay khi `matches.length > 1`, và điều đó SAI theo một kiểu chỉ lộ ra khi
   * dùng thật: ngày 13/08/2026 `mirror:new --site auto-hh3d` cất thêm `VERCEL_TOKEN_AUTO_HH3D`
   * bên cạnh `VERCEL_TOKEN` đã có. Hai chuỗi token khác nhau, CÙNG một tài khoản, cùng một
   * `projectId` — mà mọi lượt phát hành cho trạm ấy đều chết với câu「không đoán chủ nhân」.
   * `discoverTokens` khử trùng theo GIÁ TRỊ nên nó không cứu được ca này: hai token là hai
   * chuỗi thật sự khác nhau.
   *
   * Nguy hiểm thật sự mà phép từ chối này canh là phát hành lên NHẦM TÀI KHOẢN — và điều đó chỉ
   * xảy ra khi cùng một cái tên trỏ tới hai project KHÁC NHAU. Nên câu hỏi đúng là đếm
   * `projectId`, không đếm token.
   */
  const distinct = new Map(matches.map((m) => [m.projectId, m]));
  if (distinct.size > 1) {
    return {
      ok: false,
      message:
        `Tên project「${named.name}」trỏ tới ${distinct.size} project KHÁC NHAU: ` +
        [...distinct.values()].map((m) => `${m.projectId} (qua ${m.envName})`).join(", ") +
        " — không đoán được cái nào của tông môn. Gỡ token của tài khoản lạ khỏi .env.local rồi chạy lại.",
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

/**
 * REGION của MỌI kho — `iad1` (Washington, D.C., US East).
 *
 * Ghim tường minh chứ không phó mặc mặc định, vì hai lẽ. Một: region là `ui:read-only` sau khi
 * tạo ở CẢ HAI sản phẩm — dựng sai chỗ thì chỉ còn đường xoá kho dựng lại, mà xoá kho là xoá
 * dữ liệu. Hai: bốn kho đang chạy đều ở `iad1` nhưng KHÔNG phải vì ai đó chọn, mà vì mặc định
 * của nhà cung cấp lúc ấy tình cờ như vậy — một mặc định đổi lúc nào cũng được, và trạm mới nằm
 * lệch châu lục so với ba trạm cũ là thứ không ai thấy cho tới ngày đồng bộ gương chậm gấp mười.
 */
export const STORE_REGION = "iad1";

/**
 * Hai kho mỗi trạm phải có, kèm metadata BẮT BUỘC của từng nhà cung cấp.
 *
 * HAI SẢN PHẨM DÙNG HAI TÊN KHOÁ KHÁC NHAU CHO CÙNG MỘT THỨ: Neon đọc `region`, Atlas đọc
 * `vercelRegion`. Đây không phải chỗ để đoán — lấy thẳng từ `metadataSchema` mà Vercel trả về
 * ở `GET /v1/storage/stores` (đo 12/08/2026):
 *
 *   neon  → required ["region"],                ui:options [cle1 iad1 pdx1 fra1 lhr1 syd1 sin1 gru1]
 *   atlas → required ["clusterTier","vercelRegion"], ui:options [arn1 bom1 … iad1 … cdg1]
 *
 * Cùng nguồn ấy cho biết `clusterTier` là bắt buộc — thiếu nó thì lượt dựng chết NỬA CHỪNG, sau
 * khi project đã tạo và kho Neon đã xong (đo cùng ngày, Vercel CLI 56.4.1). Muốn thêm khoá nào
 * thì tra lại schema, đừng đoán: chính lời lỗi của CLI cũng nói tên khoá còn thiếu.
 */
export const STORE_SPECS_SHARED = [
  {
    slug: "neon",
    plan: "free_v3",
    label: "Neon Postgres",
    metadata: [`region=${STORE_REGION}`],
  },
  {
    slug: "mongodbatlas",
    plan: "FREE",
    label: "MongoDB Atlas",
    metadata: ["clusterTier=FREE", `vercelRegion=${STORE_REGION}`],
  },
] as const;

/** Một kho marketplace như Vercel trả về ở `GET /v1/storage/stores`. */
export type StoreRef = { id?: string; name?: string; projectsMetadata?: { name?: string }[] };

/**
 * Chia kho của một tài khoản thành ba nhóm theo project đang nối.
 *
 * ĐÂY LÀ CHỖ NGUY HIỂM NHẤT CỦA CÔNG CỤ XOÁ. Từ 12/08/2026 tên kho là chuỗi ngẫu nhiên không
 * mang chữ nào của tông môn, nên KHÔNG còn cách nào nhận ra kho của một trạm bằng tên — sợi dây
 * duy nhất là project đang nối. Chọn sai ở đây là xoá database của người khác.
 *
 *   • `cuaRieng`  — nối ĐÚNG project ấy và không nối gì khác. Chỉ nhóm này được xoá.
 *   • `dungChung` — nối project ấy VÀ project khác. Xoá là kéo theo thứ không ai xin xoá, nên
 *                   chỉ báo tên rồi để yên; người vận hành tự gỡ nối trước nếu thật sự muốn.
 *   • `moCoi`     — không nối project nào. Thường là rác của một lượt dựng chết giữa chừng,
 *                   nhưng KHÔNG quy được cho trạm nào, nên cũng chỉ báo. Xoá hộ một thứ không
 *                   quy được chủ là đúng cái kiểu「dọn dẹp」đã xoá nhầm dữ liệu ở khắp nơi.
 */
export function storesOfProject(
  stores: readonly StoreRef[],
  projectName: string,
): { cuaRieng: StoreRef[]; dungChung: StoreRef[]; moCoi: StoreRef[] } {
  const cuaRieng: StoreRef[] = [];
  const dungChung: StoreRef[] = [];
  const moCoi: StoreRef[] = [];

  for (const store of stores) {
    const names = (store?.projectsMetadata ?? [])
      .map((p) => (p?.name ?? "").trim())
      .filter((n) => n.length > 0);
    if (names.length === 0) {
      moCoi.push(store);
      continue;
    }
    if (!names.includes(projectName)) continue;
    if (names.some((n) => n !== projectName)) dungChung.push(store);
    else cuaRieng.push(store);
  }
  return { cuaRieng, dungChung, moCoi };
}
