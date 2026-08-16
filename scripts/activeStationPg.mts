/**
 * DATABASE MÀ APP ĐANG DÙNG — một câu hỏi, một câu trả lời, cho mọi script vận hành.
 *
 * ── TỆP NÀY TỪNG TRẢ LỜI MỘT CÂU HỎI KHÁC ─────────────────────────────────────────────────────
 *
 * Tới 15/08/2026 nó tên là「tra chuỗi kết nối của TRẠM ĐANG HOẠT ĐỘNG」và leo ba nấc thang để
 * tìm: sổ gương dưới máy, rồi sổ gương của từng trạm còn đọc được, rồi hỏi thẳng Vercel. Cả ba
 * nấc dựng trên một giả định: mỗi trạm có database RIÊNG, nên biết trạm nào đang phục vụ là biết
 * hỏi database nào.
 *
 * Cuộc dời backend về VM (16/08/2026) xoá sổ chính giả định ấy. Nay chỉ còn MỘT database — Postgres
 * trên `jarvis-oci-01` — và năm trạm Vercel chỉ là vỏ proxy, không giữ dữ liệu gì. Những Neon cũ
 * thì vẫn nối được, vẫn trả về hàng thật; chúng chỉ đông cứng từ đúng giây cắt chuyển.
 *
 * Đó là lý do ba nấc thang phải đi hẳn chứ không được để lại làm「đường lui」: leo thang bây giờ
 * KHÔNG hỏng, nó dẫn tới một bản sao sai rồi báo xanh. Một script dọn sổ điểm danh sẽ dọn sổ của
 * một database bỏ hoang; một lượt đo nhánh tự chữa sẽ soi sổ Kho GitHub của tháng trước. Không có
 * lỗi nào để đọc — đúng kiểu hỏng tệ nhất, và là kiểu mà chính tệp này đã cảnh báo suốt một tuần.
 *
 * ── NÊN NAY CHỈ CÒN MỘT LUẬT ──────────────────────────────────────────────────────────────────
 *
 * `DATABASE_URL` loopback ⇒ database thật đứng ngay cạnh ⇒ trả về nó.
 * Không loopback ⇒ đang đứng ở máy nhà ⇒ TỪ CHỐI, kèm đúng lệnh phải gõ lại.
 *
 * Từ chối chứ không tự đi vòng, vì máy nhà không có đường nào tới Postgres của VM (nó chỉ nghe
 * trên 127.0.0.1) — mọi「đường vòng」đều là đường tới một database khác. Và lời từ chối phải chỉ
 * đúng lệnh: người đọc nó đang ở giữa một việc khác, câu「chạy trên VM ấy」bắt họ đi tra `npm run
 * vm` nhận đối số kiểu gì.
 *
 * ── PHẦN CÒN LẠI CỦA TỆP TRẢ LỜI MỘT CÂU HỎI VẪN CÒN NGHĨA ────────────────────────────────────
 *
 * `pullStationEnv` không liên quan tới database của app: nó kéo môi trường production của một
 * PROJECT VERCEL về, và project Vercel thì vẫn còn (vỏ proxy vẫn cần cấu hình, vẫn có biến). Nó ở
 * lại nguyên vẹn, chỉ chuyển xuống dưới cho khỏi lẫn với luật ở trên.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseEnvFile } from "./envFile.mts";
import { isLoopbackDatabaseUrl } from "./pgTag.mjs";

/** Nơi `npm run vm` cd vào — bản clone vận hành, KHÁC với slot-3000/3001 mà app chạy. */
export const VM_APP_DIR = "/opt/jarvis/ops-repo";

/**
 * Lỗi RIÊNG cho ca「đứng sai máy」, để người gọi phân biệt được với mọi hỏng hóc khác.
 *
 * Vì sao đáng một lớp riêng thay vì `Error` trần: mọi script gọi `appDatabaseUrl` đều bọc nó
 * trong `try/catch` rồi đổi thành lời từ chối của mình, và cái chúng cần biết là「có nên in
 * stack không」. Đứng sai máy thì stack vô nghĩa — thông điệp ĐÃ là toàn bộ thông tin.
 */
export class KhongPhaiDatabaseCuaApp extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KhongPhaiDatabaseCuaApp";
  }
}

/**
 * Dựng lại ĐÚNG lệnh vừa gõ, nhưng chạy trên VM.
 *
 * `npm_lifecycle_event` là tên script npm đang chạy (`roster:purge`, `verify:keepalive-live`…),
 * npm đặt sẵn vào môi trường của tiến trình con. Có nó thì lời từ chối chỉ được đúng lệnh; không
 * có nó (chạy `tsx` thẳng tay) thì nói thật là không biết, chứ đừng đoán một lệnh sai.
 *
 * HAI dấu `--`, và đó không phải lỗi đánh máy: dấu đầu tách đối số của `npm run vm`, dấu sau tách
 * đối số của script bên trong. Thiếu dấu sau thì `--dry-run` bị chính npm nuốt mất.
 *
 * Hàm THUẦN (không đọc `process`) để `verify:app-db` đo được — xem `scripts/verifyAppDatabase.mts`.
 */
export function vmRerunCommand(script: string | undefined, args: readonly string[] = []): string {
  const clean = (script ?? "").trim();
  if (clean.length === 0) return `npm run vm -- <lệnh vừa gõ, chạy trong ${VM_APP_DIR}>`;
  const tail = args.length > 0 ? ` -- ${args.join(" ")}` : "";
  return `npm run vm -- npm run ${clean}${tail}`;
}

/**
 * Lời từ chối khi `DATABASE_URL` không trỏ vào database của app.
 *
 * In cả HOST đang trỏ tới, cắt bỏ phần còn lại của chuỗi: người đọc cần biết「nó đang trỏ đi
 * đâu」để nhận ra đây là Neon cũ hay là một trạm nào đó, mà chuỗi kết nối đầy đủ thì chứa mật
 * khẩu — thứ không được rơi vào log của bất kỳ lượt chạy nào.
 *
 * Hàm THUẦN. Xem `vmRerunCommand` về hai dấu `--`.
 */
export function offVmRefusal(url: string | undefined, script: string | undefined, args: readonly string[] = []): string {
  let host = "(DATABASE_URL trống)";
  if (typeof url === "string" && url.trim().length > 0) {
    try {
      host = new URL(url).hostname;
    } catch {
      host = "(DATABASE_URL không đọc được thành URL)";
    }
  }
  return (
    `Lệnh này đụng vào database của app, mà DATABASE_URL dưới máy đang trỏ tới「${host}」.\n\n` +
    "  Từ 16/08/2026 database của app là Postgres trên VM, chỉ nghe trên 127.0.0.1 — không có\n" +
    "  đường nào tới nó từ máy nhà. Những Neon cũ thì vẫn nối được nhưng đã đông cứng từ giây\n" +
    "  cắt chuyển: chạy tiếp ở đây sẽ đọc ra dữ liệu thật của một database không ai dùng nữa,\n" +
    "  rồi báo xanh.\n\n" +
    "  Chạy lại trên VM:\n\n" +
    `      ${vmRerunCommand(script, args)}\n`
  );
}

/**
 * Chuỗi kết nối tới database mà APP đang dùng, hoặc NÉM nếu đang đứng sai máy.
 *
 * Nhận `env`/`argv` qua đối số (mặc định là của tiến trình) để lượt kiểm dựng được cả hai cảnh
 * mà không phải bịa `process.env` toàn cục — thứ sẽ rò sang mọi phép đo sau nó.
 */
export function appDatabaseUrl(
  env: NodeJS.ProcessEnv = process.env,
  argv: readonly string[] = process.argv.slice(2),
): string {
  const url = env.DATABASE_URL;
  if (typeof url === "string" && isLoopbackDatabaseUrl(url)) return url;
  throw new KhongPhaiDatabaseCuaApp(offVmRefusal(url, env.npm_lifecycle_event, argv));
}

/**
 * ── KÉO MÔI TRƯỜNG CỦA MỘT PROJECT VERCEL ────────────────────────────────────────────────────
 *
 * Phần dưới đây KHÔNG trả lời câu hỏi「database của app ở đâu」(xem khối đầu tệp). Nó trả lời
 * một câu khác vẫn còn nghĩa: biến production của một project Vercel là gì.
 *
 * Vì sao phải qua CLI mà không gọi API: giá trị trong nhóm「sensitive」của Vercel không đọc được
 * qua `GET /v10/projects/{id}/env?decrypt=true` — API trả về đúng phong bì đã mã hoá chứ không
 * trả giá trị (đo 14/08/2026). `vercel env pull` thì giải được.
 */

/** Trần cho một lời gọi `vercel`. Link + pull đều là việc vài giây; lâu hơn thế là có chuyện. */
const VERCEL_TIMEOUT_MS = 120_000;

/** `auto-hh3d-1` → `VERCEL_TOKEN_AUTO_HH3D_1`. Cùng khuôn tên mà `deployTargets.mts` dùng. */
export function tokenKeyForSite(siteId: string): string {
  return `VERCEL_TOKEN_${siteId.toUpperCase().replace(/-/g, "_")}`;
}

/**
 * Kéo TRỌN môi trường production của một trạm về, qua `vercel env pull` trong một thư mục TẠM.
 *
 * Thư mục tạm là bắt buộc, không phải cho gọn: `vercel link` ghi `.vercel/project.json` và
 * `vercel env pull` ghi `.env.local` — hai tệp mà kho này đang dùng thật, và trên cây làm việc
 * này thường có phiên khác đang đọc chúng. Ghi đè chúng để đọc một biến là đổi cấu hình của người
 * khác giữa chừng.
 *
 * Trả TRỌN bảng chứ không lọc sẵn: người gọi biết mình cần gì (`syncActiveStationEnv` cần cả họ
 * khoá database). Lọc ở đây là bắt mọi người gọi sau phải sửa vào chính hàm này mỗi lần cần thêm
 * một biến.
 */
export function pullStationEnv(siteId: string): Map<string, string> {
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

    return parseEnvFile(readFileSync(path.join(dir, "env.prod"), "utf8"));
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
