/**
 * Kiểm chứng phép ghép TRẠM → PROJECT VERCEL (scripts/deployTargets.mts).
 *
 * Thuần, không mạng, không database. Đây là chỗ đáng kiểm nhất của lượt phát hành đồng bộ: một
 * cú đoán sai không làm hỏng build mà làm mã của tông môn hạ cánh xuống project của người khác,
 * và không có phép kiểm nào ở hạ nguồn bắt được điều đó.
 */
import {
  chooseBook,
  discoverTokens,
  projectNameFromUrl,
  resolveTarget,
  sensitiveEnvKeys,
  stationUrlFor,
  tokenEnvNameFor,
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

console.log(`\nTất cả ${passed} phép kiểm đều thuận.`);
