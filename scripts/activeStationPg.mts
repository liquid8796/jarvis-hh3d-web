/**
 * TRA CHUỖI KẾT NỐI CỦA TRẠM ĐANG HOẠT ĐỘNG, chịu được chuyện sổ dưới máy đã cũ.
 *
 * VÌ SAO LÀ MỘT MÔ-ĐUN RIÊNG: sổ có thẩm quyền nằm ở trạm ĐANG HOẠT ĐỘNG, không phải ở chỗ
 * `DATABASE_URL` dưới máy trỏ tới — mà `.env.local` thì trỏ cứng vào `main`, trạm đã nghỉ từ
 * 10/08/2026. Mọi script ghi sổ đều phải đi qua đúng phép tra này, và một bản chép thứ hai là
 * hẹn ngày một script ghi vào trạm đã nghỉ: một lượt hỏng KHÔNG để lại dấu vết nào — nó nối
 * được, đọc ra dữ liệu thật, chỉ là dữ liệu của một trạm không ai dùng nữa.
 *
 * `newMirrorStation.mts` dừng hẳn khi sổ dưới máy thiếu trạm hoạt động. Ở đây đi thêm một bước,
 * vì cảnh ấy là cảnh THƯỜNG chứ không hiếm: sổ của `main` đóng băng đúng ngày nó nghỉ và không
 * bao giờ biết những trạm sinh sau. Đo 12/08/2026: sổ dưới máy có 2 trạm, sổ ở trạm hoạt động có
 * 4. Sổ đi theo mọi lượt đồng bộ nên trạm nào còn sống cũng biết đường chỉ tiếp — hỏi lần lượt
 * tới khi ra.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { neon } from "@neondatabase/serverless";
import { decryptSecret } from "../src/lib/crypto/secretBox";

type Mirror = { id: string; pg?: string };

async function readMirrors(url: string): Promise<Mirror[]> {
  const rows = (await neon(url)`select value->'mirrors' as mirrors from app_settings where id = 'global'`) as {
    mirrors: Mirror[] | null;
  }[];
  return rows[0]?.mirrors ?? [];
}

/**
 * Chuỗi kết nối Postgres của `activeSiteId`, tra qua sổ dưới máy rồi qua sổ của từng trạm còn
 * đọc được. NÉM khi hết đường — người gọi bắt rồi đổi thành lời từ chối của riêng nó (mỗi script
 * có một lớp `Stop`/`DungLai` riêng, và ném ở đây thì không script nào phải nhập của script kia).
 *
 * `onFallback` để người gọi kể lại đường vòng đã đi. Im lặng đi vòng cũng ra kết quả đúng, nhưng
 * nó giấu mất dấu hiệu「sổ dưới máy đã cũ」— thứ đáng biết trước khi nó gây chuyện ở một lượt khác.
 */
export async function resolveActiveStationPg(input: {
  localDatabaseUrl: string;
  activeSiteId: string;
  onFallback?: (viaSiteId: string) => void;
}): Promise<string> {
  const { localDatabaseUrl, activeSiteId } = input;

  const local = await readMirrors(localDatabaseUrl);
  const direct = local.find((m) => m.id === activeSiteId);
  if (direct?.pg) return decryptSecret(direct.pg);

  for (const station of local) {
    if (!station.pg) continue;
    try {
      const found = (await readMirrors(decryptSecret(station.pg))).find((m) => m.id === activeSiteId);
      if (found?.pg) {
        input.onFallback?.(station.id);
        return decryptSecret(found.pg);
      }
    } catch {
      // Trạm không nối được thì hỏi trạm kế. Một trạm chết không được phép chặn cả lượt chạy.
    }
  }

  throw new Error(
    `Không tra ra chuỗi kết nối của trạm đang hoạt động「${activeSiteId}」.\n` +
      "  Vào trang Tông Môn → Gương Trạm trên trạm ấy, bấm「Ghi trạm này vào sổ」rồi chạy lại.",
  );
}

/**
 * ── NẤC THANG THỨ HAI: HỎI THẲNG VERCEL ──────────────────────────────────────────────────────
 *
 * `resolveActiveStationPg` ở trên đứng trên một giả định: chuỗi kết nối dưới máy còn MỞ ĐƯỢC một
 * database nào đó. Ngày 14/08/2026 giả định ấy gãy: một lượt chuyển trạm xoá hẳn project của trạm
 * cũ, và cả `.env` lẫn `.env.local` cùng trả `password authentication failed` — nên phép tra không
 * có nổi bậc thang đầu tiên để đứng lên. Công cụ nào cũng chết ở dòng đầu, kể cả những công cụ chỉ
 * cần ĐỌC.
 *
 * Đường vòng đã phải đi bằng tay hôm ấy, nay viết thành mã: bảng điều phối cho biết trạm nào đang
 * hoạt động (nó nằm trên OCI, không phụ thuộc database), tên trạm suy ra tên project Vercel, và
 * `VERCEL_TOKEN_<TÊN>` trong `.env.local` mở được project ấy. Chìa Vercel KHÔNG xoay theo lượt
 * chuyển trạm, nên nấc này còn đứng khi mọi nấc khác đã đổ.
 *
 * Vì sao phải qua CLI mà không gọi API: `DATABASE_URL` nằm trong nhóm「sensitive」của Vercel, và
 * `GET /v10/projects/{id}/env?decrypt=true` trả về đúng phong bì đã mã hoá chứ không trả giá trị
 * (đo 14/08/2026). `vercel env pull` thì giải được — nó là đường duy nhất còn lại.
 */

/** Trần cho một lời gọi `vercel`. Link + pull đều là việc vài giây; lâu hơn thế là có chuyện. */
const VERCEL_TIMEOUT_MS = 120_000;

/** `auto-hh3d-1` → `VERCEL_TOKEN_AUTO_HH3D_1`. Cùng khuôn tên mà `deployTargets.mts` dùng. */
export function tokenKeyForSite(siteId: string): string {
  return `VERCEL_TOKEN_${siteId.toUpperCase().replace(/-/g, "_")}`;
}

/**
 * Kéo `DATABASE_URL` production của một trạm về, qua `vercel env pull` trong một thư mục TẠM.
 *
 * Thư mục tạm là bắt buộc, không phải cho gọn: `vercel link` ghi `.vercel/project.json` và
 * `vercel env pull` ghi `.env.local` — hai tệp mà kho này đang dùng thật, và trên cây làm việc
 * này thường có phiên khác đang đọc chúng. Ghi đè chúng để đọc một biến là đổi cấu hình của người
 * khác giữa chừng.
 */
export function pullStationPgFromVercel(siteId: string): string {
  const key = tokenKeyForSite(siteId);
  const token = (process.env[key] ?? "").trim();
  if (token.length === 0) {
    throw new Error(
      `Sổ dưới máy không dùng được, mà cũng không có ${key} trong .env.local để hỏi thẳng Vercel.\n` +
        `  Thêm chìa của tài khoản giữ trạm「${siteId}」vào .env.local rồi chạy lại.`,
    );
  }

  const dir = mkdtempSync(path.join(tmpdir(), "tram-pg-"));
  try {
    const run = (args: string[]) =>
      execFileSync("vercel", args, {
        cwd: dir,
        timeout: VERCEL_TIMEOUT_MS,
        encoding: "utf8",
        // `vercel` trên Windows là một tệp .cmd — không có shell thì execFile trả ENOENT. Mọi đối
        // số ở đây là chuỗi cố định hoặc tên trạm đã qua `reviewStationIdentity`, không có khoảng
        // trắng để phép nối chuỗi của shell làm vỡ.
        shell: true,
        stdio: ["ignore", "pipe", "pipe"],
      });

    run(["link", "--yes", "--project", siteId, "--token", token]);
    run(["env", "pull", "./env.prod", "--environment=production", "--yes", "--token", token]);

    const line = readFileSync(path.join(dir, "env.prod"), "utf8")
      .split("\n")
      .find((row) => row.startsWith("DATABASE_URL="));
    const value = (line ?? "").slice("DATABASE_URL=".length).trim().replace(/^"|"$/g, "");
    if (value.length === 0) {
      throw new Error(`Trạm「${siteId}」không có DATABASE_URL trong môi trường production.`);
    }
    return value;
  } catch (err) {
    if (err instanceof Error && /ENOENT/.test(err.message)) {
      throw new Error(
        "Không gọi được `vercel`. Cài bằng `npm i -g vercel` rồi chạy lại — đây là đường DUY NHẤT " +
          "còn lại khi sổ dưới máy không mở được database nào.",
      );
    }
    throw err;
  } finally {
    // Thư mục này vừa chứa TOÀN BỘ môi trường production của một trạm — xoá là phần bắt buộc của
    // việc đọc nó, không phải phần dọn dẹp cho gọn.
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {
      // Không xoá được thì nói ở nơi gọi cũng chẳng giúp gì; điều quan trọng là không nuốt mất
      // giá trị trả về vì một lượt dọn hụt.
    }
  }
}

/**
 * Chuỗi kết nối của trạm đang hoạt động, ĐI ĐƯỢC KỂ CẢ KHI SỔ DƯỚI MÁY ĐÃ CHẾT.
 *
 * Hai nấc, và thứ tự có lý do: nấc sổ rẻ hơn hẳn (một lượt truy vấn, không gọi tiến trình con) và
 * đúng trong ca thường; nấc Vercel là lối thoát hiểm, tốn hai lượt gọi CLI.
 */
export async function resolveActiveStationPgAnywhere(input: {
  localDatabaseUrl: string;
  activeSiteId: string;
  onFallback?: (viaSiteId: string) => void;
  onVercelFallback?: (why: string) => void;
}): Promise<string> {
  try {
    return await resolveActiveStationPg(input);
  } catch (err) {
    const why = err instanceof Error ? err.message.split("\n")[0] : "lỗi lạ";
    input.onVercelFallback?.(why);
    return pullStationPgFromVercel(input.activeSiteId);
  }
}
