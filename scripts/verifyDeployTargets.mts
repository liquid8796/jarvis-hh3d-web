/**
 * Kiểm chứng phép ghép TRẠM → PROJECT VERCEL (scripts/deployTargets.mts).
 *
 * Thuần, không mạng, không database. Đây là chỗ đáng kiểm nhất của lượt phát hành đồng bộ: một
 * cú đoán sai không làm hỏng build mà làm mã của tông môn hạ cánh xuống project của người khác,
 * và không có phép kiểm nào ở hạ nguồn bắt được điều đó.
 */
import { discoverTokens, projectNameFromUrl, resolveTarget, type ProjectRef } from "./deployTargets.mts";

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

console.log(`\nTất cả ${passed} phép kiểm đều thuận.`);
