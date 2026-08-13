/**
 * Kiểm chứng phép ghép TRẠM → PROJECT VERCEL (scripts/deployTargets.mts).
 *
 * Thuần, không mạng, không database. Đây là chỗ đáng kiểm nhất của lượt phát hành đồng bộ: một
 * cú đoán sai không làm hỏng build mà làm mã của tông môn hạ cánh xuống project của người khác,
 * và không có phép kiểm nào ở hạ nguồn bắt được điều đó.
 */
import { randomBytes } from "node:crypto";
import {
  chooseBook,
  discoverTokens,
  FORBIDDEN_IN_STORE_NAME,
  projectNameFromUrl,
  randomStoreName,
  resolveTarget,
  sensitiveEnvKeys,
  stationUrlFor,
  storesOfProject,
  STORE_REGION,
  STORE_SPECS_SHARED,
  STORE_NAME_LENGTH,
  tokenEnvNameFor,
  upsertEnvLine,
  validateSiteId,
  type ProjectRef,
} from "./deployTargets.mts";

let passed = 0;
function ok(condition: boolean, label: string): void {
  if (!condition) {
    console.error(`✗ ${label}`);
    process.exit(1);
  }
  passed++;
  console.log(`✔ ${label}`);
}

// ---- Đọc token từ env ----------------------------------------------------------------------
{
  const found = discoverTokens({
    VERCEL_TOKEN: "tok-main",
    VERCEL_TOKEN_MIRROR: "tok-guong",
    VERCEL_TARGET_ENV: "production",
    VERCEL_URL: "auto-hh3d.vercel.app",
    VERCEL_OIDC_TOKEN: "eyJ…",
    DATABASE_URL: "postgres://…",
  });
  ok(found.length === 2, "chỉ nhặt đúng hai biến token, bỏ qua VERCEL_* khác");
  ok(found[0].envName === "VERCEL_TOKEN", "VERCEL_TOKEN đứng đầu cho dễ đọc nhật ký");
  ok(
    !found.some((t) => t.envName === "VERCEL_OIDC_TOKEN"),
    "VERCEL_OIDC_TOKEN KHÔNG bị nhận nhầm — nó khớp「VERCEL_…TOKEN」nhưng không phải token phát hành",
  );

  ok(discoverTokens({ VERCEL_TOKEN: "   " }).length === 0, "token toàn khoảng trắng coi như không có");
  ok(discoverTokens({}).length === 0, "env rỗng → không token nào, không ném");
  ok(discoverTokens({ VERCEL_TOKEN: " tok " })[0].token === "tok", "cắt khoảng trắng quanh token");

  // Cùng một token nằm ở hai biến: nếu không khử trùng thì MỌI project hiện hai lần và MỌI trạm
  // bị kết luận là nhập nhằng — một lỗi cấu hình vô hại hoá thành lượt phát hành bị chặn sạch.
  const duplicated = discoverTokens({ VERCEL_TOKEN: "same", VERCEL_TOKEN_MAIN: "same", VERCEL_TOKEN_B: "khac" });
  ok(duplicated.length === 2, "cùng một token ở hai biến chỉ được tính MỘT lần");
}

// ---- URL trạm → tên project ------------------------------------------------------------------
{
  const name = (url: string) => {
    const r = projectNameFromUrl(url);
    return r.ok ? r.name : null;
  };
  ok(name("https://auto-hh3d.vercel.app") === "auto-hh3d", "URL trạm chính → tên project");
  ok(name("https://auto-hh3d-1.vercel.app/") === "auto-hh3d-1", "dấu / cuối không làm lệch tên");
  ok(name("https://AUTO-HH3D-2.VERCEL.APP") === "auto-hh3d-2", "hostname hoa thường đều đọc được");

  ok(name("http://auto-hh3d.vercel.app") === null, "http:// bị từ chối — phát hành không đi qua cửa không mã hoá");
  ok(name("https://tongmon.example.com") === null, "custom domain bị từ chối chứ KHÔNG đoán bừa");
  ok(name("https://a.b.vercel.app") === null, "hai nhãn trước .vercel.app không phải một tên project");
  ok(name("https://vercel.app") === null, "thiếu nhãn → từ chối");
  ok(name("không-phải-url") === null, "URL hỏng → từ chối, không ném");

  const custom = projectNameFromUrl("https://tongmon.example.com");
  ok(!custom.ok && custom.message.includes("custom domain"), "…và lời từ chối chỉ đúng chỗ phải sửa khi ngày ấy tới");
}

// ---- Ghép trạm với project --------------------------------------------------------------------
{
  const main: ProjectRef = { name: "auto-hh3d", projectId: "prj_main", orgId: "team_a", envName: "VERCEL_TOKEN" };
  const guong: ProjectRef = {
    name: "auto-hh3d-1",
    projectId: "prj_guong",
    orgId: "team_b",
    envName: "VERCEL_TOKEN_MIRROR",
  };
  const lac: ProjectRef = { name: "mot-project-khac", projectId: "prj_x", orgId: "team_a", envName: "VERCEL_TOKEN" };
  const catalog = [main, lac, guong];

  const hit = resolveTarget({ id: "main", name: "Trạm chính", url: "https://auto-hh3d.vercel.app" }, catalog);
  ok(hit.ok && hit.target.projectId === "prj_main", "trạm chính ghép đúng project của tài khoản chính");

  const hit2 = resolveTarget({ id: "auto-hh3d-1", name: "Gương 1", url: "https://auto-hh3d-1.vercel.app" }, catalog);
  ok(hit2.ok && hit2.target.orgId === "team_b", "trạm gương ghép sang ĐÚNG tài khoản khác, không lẫn với trạm chính");

  const miss = resolveTarget({ id: "auto-hh3d-9", name: "Gương 9", url: "https://auto-hh3d-9.vercel.app" }, catalog);
  ok(!miss.ok && miss.message.includes("VERCEL_TOKEN"), "không thấy project → kể tên những token đã tìm bằng");

  // Hai tài khoản cùng có project trùng tên: lệ đặt tên `auto-hh3d-<số>` KHÔNG cấm điều đó, và
  //「token nào thấy trước thì thắng」sẽ phát hành lên nhầm tài khoản trong im lặng.
  const doubled = resolveTarget({ id: "main", name: "Trạm chính", url: "https://auto-hh3d.vercel.app" }, [
    main,
    { ...main, projectId: "prj_trung-ten", orgId: "team_c", envName: "VERCEL_TOKEN_KHAC" },
  ]);
  ok(!doubled.ok, "project trùng tên ở hai tài khoản → TỪ CHỐI, không chọn bừa");
  ok(
    !doubled.ok && doubled.message.includes("VERCEL_TOKEN_KHAC"),
    "…và nêu đích danh hai biến token để người ta biết gỡ cái nào",
  );

  // MỘT project thấy qua HAI token là chuyện BÌNH THƯỜNG, không phải nhập nhằng: `mirror:new`
  // cất token dưới tên suy từ mã trạm, nên một tài khoản dễ có hai biến token khác chuỗi.
  // Đo thật 13/08/2026: `VERCEL_TOKEN` và `VERCEL_TOKEN_AUTO_HH3D` cùng trỏ
  // `prj_eW4Il86IBjG2NIZepeWKXFoZnejT`, mà mọi lượt phát hành cho trạm ấy đều chết.
  const haiToken = resolveTarget({ id: "main", name: "Trạm gốc", url: "https://auto-hh3d.vercel.app" }, [
    main,
    { ...main, envName: "VERCEL_TOKEN_AUTO_HH3D" },
  ]);
  ok(haiToken.ok, "CÙNG một project thấy qua hai token → vẫn phát hành được, không kêu nhập nhằng");
  ok(haiToken.ok && haiToken.target.projectId === "prj_main", "…và chọn đúng project ấy");

  const empty = resolveTarget({ id: "main", name: "Trạm chính", url: "https://auto-hh3d.vercel.app" }, []);
  ok(!empty.ok && empty.message.includes("chưa khai token nào"), "danh mục rỗng → lời nhắc khác hẳn, đúng nguyên nhân");

  const badUrl = resolveTarget({ id: "la", name: "Lạ", url: "https://tongmon.example.com" }, catalog);
  ok(!badUrl.ok, "trạm dùng custom domain → từ chối ở bước tra, không phát hành nhầm");
}

// ---- Mã trạm: một cái tên sống ở ba nơi -------------------------------------------------------
// Ép ở đây để mã sai bị chặn TRƯỚC khi tạo project, chứ không lộ ra ở lượt deploy đầu — lúc ấy
// đã có rác nằm trên tài khoản người ta.
{
  const bad = (raw: string, why: string) => ok(!validateSiteId(raw).ok, `mã「${raw}」phải bị từ chối — ${why}`);
  const good = (raw: string, want: string) => {
    const r = validateSiteId(raw);
    ok(r.ok && r.siteId === want, `mã「${raw}」hợp lệ → ${want}`);
  };

  good("auto-hh3d-3", "auto-hh3d-3");
  good("  auto-hh3d-3  ", "auto-hh3d-3");
  good("a", "a");
  bad("", "rỗng");
  bad("Auto-HH3D", "có chữ hoa — hostname không phân biệt hoa thường, nhưng SITE_ID thì có");
  bad("-auto", "mở đầu bằng gạch ngang");
  bad("auto-", "kết thúc bằng gạch ngang");
  bad("auto_hh3d", "gạch dưới không hợp lệ trong nhãn hostname");
  bad("auto hh3d", "khoảng trắng");
  bad("auto.hh3d", "dấu chấm — sẽ thành hai nhãn hostname");
  bad("x".repeat(64), "quá 63 ký tự");
  ok(validateSiteId("x".repeat(63)).ok, "đúng 63 ký tự vẫn nhận — biên trên, không lệch một");

  ok(stationUrlFor("auto-hh3d-3") === "https://auto-hh3d-3.vercel.app", "mã → địa chỉ trạm");
  const roundTrip = projectNameFromUrl(stationUrlFor("auto-hh3d-3"));
  ok(roundTrip.ok && roundTrip.name === "auto-hh3d-3", "địa chỉ dựng ra rồi đọc ngược lại vẫn đúng mã — hai hàm khớp nhau");

  ok(tokenEnvNameFor("auto-hh3d-3") === "VERCEL_TOKEN_AUTO_HH3D_3", "mã → tên biến token");
  ok(
    discoverTokens({ [tokenEnvNameFor("auto-hh3d-3")]: "tok" }).length === 1,
    "…và tên ấy được discoverTokens nhặt ngay, không phải khai thêm ở đâu",
  );
}

// ---- Đọc sổ ở đâu ----------------------------------------------------------------------------
// Nhánh này quyết định TRẠM NÀO được phát hành. Sai ở đây không làm hỏng build — nó lặng lẽ bỏ
// sót một trạm rồi vẫn báo「Mọi trạm đã cùng commit」. Đo được 11/08/2026 khi dựng trạm thứ ba:
// trạm mới ghi vào sổ của trạm ĐANG HOẠT ĐỘNG, còn công cụ thì đọc sổ ở database dưới máy — một
// ảnh chụp cũ của trạm dự phòng, không hề có trạm mới.
{
  const st = (id: string) => ({ id, name: id, url: `https://${id}.vercel.app`, pg: `enc:${id}` });
  const localBook = { mirrors: [st("main"), st("auto-hh3d-1")] };
  const remoteBook = { mirrors: [st("main"), st("auto-hh3d-1"), st("auto-hh3d-2")] };

  const fromActive = await chooseBook({
    localBook,
    activeSiteId: "auto-hh3d-1",
    readRemote: async (env) => (env === "enc:auto-hh3d-1" ? remoteBook : { mirrors: [] }),
  });
  ok(fromActive.stations.length === 3, "đọc sổ ở TRẠM HOẠT ĐỘNG → thấy đủ trạm mới thêm");
  ok(fromActive.from.includes("auto-hh3d-1"), "…và nói rõ đã đọc ở đâu");
  ok(!fromActive.warning, "…đường thuận thì không cảnh báo gì");

  const noDoc = await chooseBook({ localBook, activeSiteId: null, readRemote: async () => remoteBook });
  ok(noDoc.stations.length === 2 && Boolean(noDoc.warning), "bảng điều phối không đọc được → lùi về sổ dưới máy KÈM cảnh báo");

  const missing = await chooseBook({ localBook, activeSiteId: "auto-hh3d-9", readRemote: async () => remoteBook });
  ok(missing.stations.length === 2, "sổ dưới máy thiếu entry trạm hoạt động → vẫn phát hành được");
  ok(Boolean(missing.warning?.includes("cụt-đường-về")), "…và gọi đúng tên triệu chứng cụt-đường-về");

  const broken = await chooseBook({
    localBook,
    activeSiteId: "auto-hh3d-1",
    readRemote: async () => {
      throw new Error("ECONNREFUSED");
    },
  });
  ok(broken.stations.length === 2, "trạm hoạt động không nối được → KHÔNG chết cả lượt, lùi về sổ dưới máy");
  ok(Boolean(broken.warning?.includes("ECONNREFUSED")), "…và mang theo nguyên văn lý do để còn gỡ");

  const junk = await chooseBook({
    localBook: { mirrors: [st("main"), { id: "", name: "", url: "" }, { id: "x", name: "x", url: "" }] as never },
    activeSiteId: null,
    readRemote: async () => ({}),
  });
  ok(junk.stations.length === 1, "entry thiếu id/url bị loại, không lọt vào kế hoạch phát hành");

  const empty = await chooseBook({ localBook: {}, activeSiteId: null, readRemote: async () => ({}) });
  ok(empty.stations.length === 0, "sổ rỗng → mảng rỗng, không ném");
}

// ---- Biến môi trường nào KHÔNG đọc lại được ------------------------------------------------
//
// Cả hệ gương trạm đứng trên việc đọc lại được env của một trạm: dựng trạm mới phải `env:pull`
// để lấy chuỗi kết nối mà integration vừa tiêm, và cứu một trạm cụt đường về cũng đi qua đúng
// cửa ấy. Một biến `sensitive` không hỏng ngay — nó hỏng vào đúng ngày người ta cần đọc nó, và
// lúc ấy không còn bản sao nào. Đo 12/08/2026: `auto-hh3d` có 18 biến sensitive, `auto-hh3d-1`
// có 7 (đúng bộ bí mật dùng chung); hai trạm dựng bằng script hiện tại thì không có cái nào.
{
  const envs = [
    { key: "AUTH_SECRET", type: "sensitive" },
    { key: "DATABASE_URL", type: "encrypted" },
    { key: "SITE_ID", type: "plain" },
    { key: "CRON_SECRET", type: "sensitive" },
  ];
  ok(sensitiveEnvKeys(envs).join(",") === "AUTH_SECRET,CRON_SECRET", "chỉ nhặt biến sensitive, và xếp theo tên");
  ok(
    sensitiveEnvKeys(envs.filter((e) => e.type !== "sensitive")).length === 0,
    "toàn encrypted/plain → không có gì để kêu",
  );
  ok(sensitiveEnvKeys([]).length === 0, "danh sách rỗng → không ném");
  // Vercel luôn trả `type`; vắng nghĩa là hình dạng API đã đổi. Đoán bừa "sensitive" ở đó sẽ
  // chặn MỌI lượt dựng trạm vì một lý do không có thật, nên nhánh này cố ý cho qua.
  ok(sensitiveEnvKeys([{ key: "X" }]).length === 0, "dòng vắng type KHÔNG bị coi là sensitive");
  ok(sensitiveEnvKeys([{ type: "sensitive" }])[0] === "(biến không tên)", "biến sensitive vắng tên vẫn được kể ra");
  ok(
    sensitiveEnvKeys([{ key: "  ", type: "sensitive" }])[0] === "(biến không tên)",
    "tên toàn khoảng trắng coi như không có tên",
  );
  // "Sensitive" hoa đầu không phải giá trị Vercel dùng; khớp lỏng ở đây là mời một lỗi khác vào.
  ok(
    sensitiveEnvKeys([{ key: "X", type: "Sensitive" }]).length === 0,
    "so khớp CHÍNH XÁC chuỗi type, không lỏng lẻo hoa thường",
  );
}

// ---- Tên kho: ngẫu nhiên hoàn toàn, KHÔNG khai nó thuộc về ai ------------------------------
//
// Mỗi trạm gương sống trên một tài khoản Vercel riêng, nên một cái tên chung giữa các tài khoản
// là sợi dây nối chúng lại trong mắt bất kỳ ai nhìn vào. Hai đời trước của chỗ này đều hỏng:
// hằng số `jarvis-hh3d` (dựng lại là trùng tên với cái vừa xoá), rồi `jarvis-hh3d-<hex>` (hết
// trùng, nhưng vẫn khai). Đây là chỗ canh cả hai tính chất ấy.
{
  const names = Array.from({ length: 500 }, () => randomStoreName(randomBytes));

  ok(names.every((n) => n.length === STORE_NAME_LENGTH), `dài đúng ${STORE_NAME_LENGTH} ký tự`);
  // Nhãn hợp lệ ở nơi khắt khe nhất (Atlas đòi bắt đầu bằng chữ cái) thì hợp lệ ở mọi nơi.
  ok(names.every((n) => /^[a-z][a-z0-9]*$/.test(n)), "chỉ [a-z0-9], và ký tự đầu là CHỮ CÁI");
  ok(
    names.every((n) => !FORBIDDEN_IN_STORE_NAME.some((w) => n.includes(w))),
    `không tên nào mang chữ của tông môn (${FORBIDDEN_IN_STORE_NAME.join(", ")})`,
  );
  ok(new Set(names).size === names.length, "500 lần sinh không trùng nhau lần nào");

  // Nhánh SINH LẠI khi dính chữ cấm: nguồn ngẫu nhiên giả ép ra "hh3d…" ở lượt đầu rồi mới trả
  // byte thật. Không ép thì nhánh ấy đời nào cũng không chạy, và một nhánh chưa từng chạy là
  // một nhánh chưa từng đúng.
  const forced = "hh3dxxxxxxxxxx";
  let lan = 0;
  const nguonGia = (n: number): Uint8Array => {
    lan++;
    if (lan === 1) return Uint8Array.from([...forced].map((c) => "abcdefghijklmnopqrstuvwxyz0123456789".indexOf(c)));
    return randomBytes(n);
  };
  const sau = randomStoreName(nguonGia);
  ok(lan === 2, "lượt sinh dính chữ cấm bị VỨT và sinh lại");
  ok(!FORBIDDEN_IN_STORE_NAME.some((w) => sau.includes(w)), "…và tên trả về đã sạch chữ cấm");
}

// ---- Metadata của hai kho: region phải ghim, và HAI SẢN PHẨM DÙNG HAI TÊN KHOÁ KHÁC NHAU ----
//
// Neon đọc `region`, Atlas đọc `vercelRegion`. Đây đúng là chỗ để đoán sai, nên nó được đóng
// đinh bằng chính `metadataSchema` mà Vercel trả về ở GET /v1/storage/stores (đo 12/08/2026).
// Region là `ui:read-only` sau khi tạo ở cả hai: dựng sai chỗ thì chỉ còn đường xoá kho dựng lại.
{
  const REGION_KEY: Record<string, string> = { neon: "region", mongodbatlas: "vercelRegion" };
  // Nguyên văn `ui:options` đo được từ API — bắt được cả lỗi gõ nhầm kiểu `iad-1`.
  const REGION_CHOICES: Record<string, string[]> = {
    neon: ["cle1", "iad1", "pdx1", "fra1", "lhr1", "syd1", "sin1", "gru1"],
    mongodbatlas: ["arn1", "bom1", "syd1", "sin1", "sfo1", "pdx1", "lhr1", "kix1", "icn1", "iad1", "hnd1", "hkg1", "gru1", "fra1", "dub1", "cpt1", "cle1", "cdg1"],
  };

  const pairs = (spec: (typeof STORE_SPECS_SHARED)[number]) =>
    new Map(spec.metadata.map((m) => [m.slice(0, m.indexOf("=")), m.slice(m.indexOf("=") + 1)]));

  ok(STORE_SPECS_SHARED.length === 2, "đúng hai kho mỗi trạm");
  for (const spec of STORE_SPECS_SHARED) {
    const md = pairs(spec);
    const key = REGION_KEY[spec.slug];
    ok(md.has(key), `${spec.slug}: khai region bằng đúng khoá「${key}」`);
    ok(md.get(key) === STORE_REGION, `${spec.slug}: region = ${STORE_REGION}`);
    ok(REGION_CHOICES[spec.slug].includes(md.get(key) ?? ""), `${spec.slug}: region nằm trong danh sách Vercel nhận`);
    // Khoá region của sản phẩm KIA không được lọt vào đây — nhầm chéo là kho dựng ở đâu không ai biết.
    const other = Object.values(REGION_KEY).find((k) => k !== key)!;
    ok(!md.has(other), `${spec.slug}: KHÔNG mang khoá「${other}」của sản phẩm kia`);
  }
  const atlas = STORE_SPECS_SHARED.find((s) => s.slug === "mongodbatlas")!;
  ok(pairs(atlas).get("clusterTier") === "FREE", "Atlas khai clusterTier=FREE (thiếu là chết nửa chừng)");
  ok(
    new Set(STORE_SPECS_SHARED.map((s) => pairs(s).get(REGION_KEY[s.slug]))).size === 1,
    "hai kho của một trạm nằm CÙNG một region",
  );
}

// ---- Kho nào của trạm nào: chỗ nguy hiểm nhất của công cụ XOÁ -------------------------------
//
// Tên kho là chuỗi ngẫu nhiên, nên sợi dây duy nhất nhận ra kho của một trạm là PROJECT ĐANG
// NỐI. Chọn sai ở đây là xoá database của người khác — nên mọi nhánh đều có phép thử.
{
  const s = (name: string, ...projects: string[]) => ({
    id: `store_${name}`,
    name,
    projectsMetadata: projects.map((p) => ({ name: p })),
  });
  const chia = storesOfProject(
    [
      s("rieng1", "auto-hh3d-1"),
      s("rieng2", "auto-hh3d-1"),
      s("chung", "auto-hh3d-1", "mot-project-khac"),
      s("cuaNguoiKhac", "mot-project-khac"),
      s("moCoi"),
    ],
    "auto-hh3d-1",
  );
  ok(chia.cuaRieng.map((x) => x.name).join(",") === "rieng1,rieng2", "chỉ nhặt kho nối ĐÚNG project ấy và không gì khác");
  ok(chia.dungChung.map((x) => x.name).join(",") === "chung", "kho dùng chung tách riêng, KHÔNG nằm trong nhóm được xoá");
  ok(chia.moCoi.map((x) => x.name).join(",") === "moCoi", "kho không nối project nào là mồ côi, cũng không được xoá");
  ok(!chia.cuaRieng.some((x) => x.name === "cuaNguoiKhac"), "kho của project khác không bao giờ lọt vào");

  ok(storesOfProject([], "auto-hh3d-1").cuaRieng.length === 0, "tài khoản không có kho nào → không ném");
  // Tên project là so KHỚP TUYỆT ĐỐI: `auto-hh3d-1` không được kéo theo kho của `auto-hh3d-11`,
  // và cũng không được bị kho của `auto-hh3d` nhận vơ. Lệ đặt tên `auto-hh3d-<số>` khiến hai ca
  // này nằm sát nhau tới mức một phép `startsWith` cẩu thả sẽ nuốt gọn cả hai.
  const gan = storesOfProject([s("a", "auto-hh3d-11"), s("b", "auto-hh3d"), s("c", "auto-hh3d-1")], "auto-hh3d-1");
  ok(gan.cuaRieng.map((x) => x.name).join(",") === "c", "tên project khớp TUYỆT ĐỐI, không tiền tố không hậu tố");

  // Dữ liệu thiếu từ API không được biến một kho của người khác thành kho「của riêng」ta.
  const rac = storesOfProject(
    [{ id: "x", name: "thieu-metadata" }, { id: "y", name: "ten-rong", projectsMetadata: [{ name: "  " }] }],
    "auto-hh3d-1",
  );
  ok(rac.cuaRieng.length === 0 && rac.moCoi.length === 2, "kho thiếu/rỗng metadata rơi vào mồ côi, không vào nhóm xoá");
}

// ───────── upsertEnvLine — ghi token vào .env.local mà KHÔNG sinh khoá trùng ─────────
//
// Đáng kiểm vì cả hai kiểu hỏng đều IM LẶNG. Sinh khoá trùng thì `loadEnv` lấy dòng ĐẦU, nên một
// dòng rỗng bỏ quên sẽ thắng vĩnh viễn và mọi lượt phát hành báo「chưa khai token nào」dù token
// nằm ngay trong tệp. Sửa nhầm dòng thì ghi đè một bí mật KHÁC — và `.env.local` giữ cả
// DATABASE_URL lẫn ENCRYPTION_KEY.
{
  const KEY = "VERCEL_TOKEN_AUTO_HH3D_3";

  const empty = upsertEnvLine("", KEY, "vcp_1");
  ok(empty.text === `${KEY}=vcp_1\n` && !empty.replaced, "tệp rỗng → tạo đúng một dòng, kết bằng xuống dòng");

  const noEol = upsertEnvLine("A=1", KEY, "vcp_1");
  ok(noEol.text === `A=1\n${KEY}=vcp_1\n`, "tệp không kết bằng xuống dòng vẫn không dính hai dòng vào nhau");

  const appended = upsertEnvLine("A=1\nB=2\n", KEY, "vcp_1");
  ok(appended.text === `A=1\nB=2\n${KEY}=vcp_1\n` && !appended.replaced, "khoá chưa có → nối thêm, giữ nguyên phần trên");

  // ĐÂY LÀ CA SINH RA CẢ HÀM NÀY: một dòng cùng khoá đang bỏ trống.
  const filled = upsertEnvLine(`A=1\n${KEY}=\nB=2\n`, KEY, "vcp_1");
  ok(filled.replaced, "dòng cùng khoá đang rỗng phải được NHẬN RA, không phải bỏ qua");
  ok(filled.text === `A=1\n${KEY}=vcp_1\nB=2\n`, "thay tại chỗ, không đổi thứ tự dòng");
  ok(filled.text.split("\n").filter((l) => l.startsWith(`${KEY}=`)).length === 1, "KHÔNG BAO GIỜ sinh khoá trùng");

  // `loadEnv` lấy dòng ĐẦU, nên phải sửa đúng dòng ấy — sửa dòng sau là sửa thứ không ai đọc.
  const dup = upsertEnvLine(`${KEY}=\n${KEY}=cu\n`, KEY, "vcp_1");
  ok(dup.text === `${KEY}=vcp_1\n${KEY}=cu\n`, "có sẵn khoá trùng thì sửa dòng ĐẦU — đúng dòng loadEnv đọc");

  const crlf = upsertEnvLine(`A=1\r\n${KEY}=\r\nB=2\r\n`, KEY, "vcp_1");
  ok(crlf.text === `A=1\r\n${KEY}=vcp_1\r\nB=2\r\n`, "tệp CRLF giữ nguyên CRLF ở mọi dòng, kể cả dòng vừa sửa");

  const commented = upsertEnvLine(`# ${KEY}=cu\n`, KEY, "vcp_1");
  ok(commented.text === `# ${KEY}=cu\n${KEY}=vcp_1\n`, "dòng bị comment KHÔNG phải một khai báo — không sửa vào đó");

  // Lệ đặt tên `auto-hh3d-<số>` khiến hai tên này nằm sát nhau tới mức một phép `startsWith` sẽ nuốt cả hai.
  const prefix = upsertEnvLine("VERCEL_TOKEN_AUTO_HH3D=vcp_goc\n", "VERCEL_TOKEN_AUTO_HH3D_3", "vcp_3");
  ok(
    prefix.text === "VERCEL_TOKEN_AUTO_HH3D=vcp_goc\nVERCEL_TOKEN_AUTO_HH3D_3=vcp_3\n",
    "khoá khớp TUYỆT ĐỐI: token của trạm gốc không bị token của trạm 3 ghi đè",
  );

  const spaced = upsertEnvLine(`  ${KEY} = cu \n`, KEY, "vcp_1");
  ok(spaced.text === `${KEY}=vcp_1\n`, "khoá có khoảng trắng bao quanh vẫn là khoá ấy — khớp cách loadEnv trim");

  // Đường thật: tên biến do `tokenEnvNameFor` sinh ra phải được chính hàm này nhận lại được.
  const real = tokenEnvNameFor("auto-hh3d-9");
  ok(upsertEnvLine(upsertEnvLine("", real, "a").text, real, "b").text === `${real}=b\n`, "ghi hai lượt liên tiếp không đẻ dòng thứ hai");

  // Ranh giới tin cậy: tệp sắp ghi cũng giữ DATABASE_URL và ENCRYPTION_KEY, nên một giá trị lẫn
  // xuống dòng phải NÉM chứ không được chèn lặng lẽ một khai báo giả vào giữa tệp.
  const nem = (fn: () => unknown): boolean => {
    try {
      fn();
      return false;
    } catch {
      return true;
    }
  };
  ok(nem(() => upsertEnvLine("A=1\n", KEY, "vcp\nDATABASE_URL=cua-ke-gian")), "giá trị có xuống dòng → ném, không ghi");
  ok(nem(() => upsertEnvLine("A=1\n", KEY, "vcp\rx")), "giá trị có ký tự CR → ném");
  ok(nem(() => upsertEnvLine("A=1\n", "", "vcp_1")), "tên biến rỗng → ném");
  ok(nem(() => upsertEnvLine("A=1\n", "A=B", "vcp_1")), "tên biến lẫn dấu = → ném, bằng không nó khai ra hai khoá");
}

console.log(`\nTất cả ${passed} phép kiểm đều thuận.`);
