#!/usr/bin/env node
/**
 * Kiểm chứng SỔ GƯƠNG TRẠM CHỊU ĐƯỢC MỘT TRẠM KHÔNG CÓ CHUỖI KẾT NỐI — `npm run verify:mirror-book`.
 *
 * ── CÁI BẪY MÀ LƯỢT KIỂM NÀY CANH ─────────────────────────────────────────────────────────────
 *
 * Ngày 16/08/2026, tab Gương Trạm thôi hỏi `DATABASE_URL`/`MONGODB_URI`: trạm nay là vỏ chuyển
 * tiếp về backend trên VM, kho riêng của nó không ai đọc. Nhưng lược đồ khi ấy khai
 * `pg: z.string().min(1)`, và mảng `mirrors` đứng trên `.catch([])`.
 *
 * Ghép hai điều ấy lại thì được một cái bẫy im lặng và tốn kém: ghi MỘT trạm mới (không còn chuỗi
 * kết nối để điền) là một phần tử trượt phép gán → cả MẢNG trượt → `.catch([])` nuốt gọn → sổ trả
 * về RỖNG. Không lỗi nào hiện ra; chỉ là năm trạm cũ với token Vercel của năm tài khoản khác nhau
 * biến mất khỏi trang, và lượt lưu kế tiếp đóng cái rỗng ấy lại thành vĩnh viễn.
 *
 * `.catch([])` KHÔNG sai — nó có lý do riêng (một phần tử rác do sửa tay JSONB không được phép
 * làm sập cả trang admin). Cái sai là bắt một trường không ai điền phải khác rỗng. Nên phép kiểm
 * ở đây không đo `.catch`, nó đo đúng một điều: **sổ đi qua được cảnh trạm-không-chuỗi-kết-nối
 * mà không mất trạm nào.**
 *
 * Thuần, không chạm database, chạy được cả ở máy nhà lẫn trên VM.
 */
import { appSettingsSchema } from "../src/lib/services/settings";

class Failed extends Error {}

let passed = 0;
function ok(condition: boolean, label: string): void {
  if (!condition) throw new Failed(label);
  passed += 1;
  console.log(`  ✔ ${label}`);
}

/** Phong bì secretBox giả — chỉ cần đúng HÌNH, phép gán không giải mã gì cả. */
const PHONG_BI = "v1.aGVsbG8.d29ybGQ.c2VjcmV0";

type Mirror = Record<string, unknown>;

const tramCu = (id: string): Mirror => ({
  id,
  name: `Trạm ${id}`,
  url: `https://${id}.vercel.app`,
  pg: PHONG_BI,
  mongo: PHONG_BI,
  vercelToken: PHONG_BI,
});

/** Trạm ghi SAU lượt gỡ: không còn hai chuỗi kết nối, chỉ có token Vercel. */
const tramMoi = (id: string): Mirror => ({
  id,
  name: `Trạm ${id}`,
  url: `https://${id}.vercel.app`,
  pg: "",
  mongo: "",
  vercelToken: PHONG_BI,
});

const doc = (mirrors: Mirror[]) => appSettingsSchema.parse({ mirrors });

function main(): void {
  console.log("── Cái bẫy: một trạm không chuỗi kết nối KHÔNG được nuốt cả sổ ──");

  const tron = doc([tramCu("auto-hh3d"), tramMoi("auto-hh3d-9"), tramCu("auto-hh3d-1")]).mirrors;
  ok(tron.length === 3, "sổ 3 trạm trong đó 1 trạm kiểu mới → vẫn đủ 3 (bản cũ trả về 0)");
  ok(
    tron.map((m) => m.id).join(",") === "auto-hh3d,auto-hh3d-9,auto-hh3d-1",
    "…và đúng thứ tự, đúng danh tính — không phần tử nào bị đánh tráo",
  );
  ok(
    tron[0].vercelToken === PHONG_BI && tron[2].vercelToken === PHONG_BI,
    "token Vercel của các trạm CŨ đi qua nguyên vẹn — đây mới là thứ đắt nhất trong sổ",
  );

  console.log("\n── Hai chiều tương thích ────────────────────────────────────");

  const cu = doc([tramCu("auto-hh3d-3")]).mirrors;
  ok(cu[0].pg === PHONG_BI && cu[0].mongo === PHONG_BI, "phong bì kho cũ KHÔNG bị lược đồ xoá đi");
  const moi = doc([tramMoi("auto-hh3d-9")]).mirrors;
  ok(moi[0].pg === "" && moi[0].mongo === "", "trạm kiểu mới giữ chuỗi rỗng, không bị nhét giá trị bịa");

  const thieuHan = doc([{ id: "auto-hh3d-9", name: "Trạm mới", url: "https://x.vercel.app" }]).mirrors;
  ok(thieuHan.length === 1, "VẮNG HẲN hai khoá (bản ghi cũ hơn cả trường pg) cũng đi qua được");
  ok(thieuHan[0].pg === "" && thieuHan[0].mongo === "", "…và được điền chuỗi rỗng, không phải undefined");

  console.log("\n── Những gì VẪN phải bị chặn ────────────────────────────────");

  ok(doc([{ name: "Không có mã", url: "https://x.vercel.app" }]).mirrors.length === 0, "thiếu `id` vẫn là rác — sổ về rỗng");
  ok(doc([{ id: "x", name: "Sai URL", url: "http://x.vercel.app" }]).mirrors.length === 0, "URL không https vẫn bị chặn");
  ok(doc([]).mirrors.length === 0, "sổ rỗng thật thì vẫn rỗng");
}

try {
  main();
  console.log(`\n✔ ${passed} phép kiểm — sổ gương sống sót qua lượt gỡ chuỗi kết nối.`);
} catch (err) {
  console.error(err instanceof Failed ? `\n✗ ${err.message}` : `\n✖ ${err instanceof Error ? err.stack : err}`);
  process.exitCode = 1;
}
