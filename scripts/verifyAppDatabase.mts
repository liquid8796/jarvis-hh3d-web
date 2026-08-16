#!/usr/bin/env node
/**
 * Kiểm chứng LUẬT「database nào là của app」— `npm run verify:app-db`.
 *
 * VÌ SAO ĐÁNG MỘT LƯỢT KIỂM RIÊNG, trong khi luật chỉ có một dòng `if`: cái được kiểm ở đây không
 * phải phép so chuỗi, mà là LỜI TỪ CHỐI. Nó là toàn bộ giá trị của mục này.
 *
 * Nhớ lại chuyện đã xảy ra: bốn công cụ vận hành từng leo ba nấc thang để tìm「database của trạm
 * đang hoạt động」, và sau ngày backend về VM thì cả bốn vẫn chạy trơn tru — vào một Neon đông
 * cứng. Chúng dọn sổ điểm danh của một database bỏ hoang rồi in ✔. Thứ chữa được cảnh ấy không
 * phải một `if` trả về `false`, mà là một câu nói đủ để người đọc gõ tiếp được ngay: đang trỏ đi
 * đâu, vì sao không đi tiếp được, và LỆNH NÀO thay thế.
 *
 * Nên các phép kiểm dưới đây soi đúng ba thứ ấy trong thông điệp, cộng một luật an toàn: chuỗi
 * kết nối chứa mật khẩu, nên chỉ HOST được phép lọt ra ngoài.
 *
 * Toàn hàm thuần, không chạm database — chạy được ở máy nhà lẫn trên VM, dưới một giây.
 */
import { appDatabaseUrl, offVmRefusal, vmRerunCommand, KhongPhaiDatabaseCuaApp } from "./activeStationPg.mts";

/** Một phép kiểm ngã. Ném chứ không `process.exit` — xem cùng khối ở `verifyRosterPurge.mts`. */
class Failed extends Error {}

let passed = 0;
function ok(condition: boolean, label: string): void {
  if (!condition) throw new Failed(label);
  passed += 1;
  console.log(`  ✔ ${label}`);
}

/** Mật khẩu giả, cố ý trông như thật: nó là thứ KHÔNG được xuất hiện trong bất kỳ thông điệp nào. */
const MAT_KHAU = "npg_S3cr3tKhongDuocLotRaNgoai";
const NEON_URL = `postgresql://neondb_owner:${MAT_KHAU}@ep-cu-xua-123.ap-southeast-1.aws.neon.tech/neondb?sslmode=require`;
const VM_URL = `postgresql://jarvis:${MAT_KHAU}@127.0.0.1:5432/jarvis`;

function main(): void {
  console.log("── Luật: DATABASE_URL loopback mới là database của app ──────────");

  ok(appDatabaseUrl({ DATABASE_URL: VM_URL }, []) === VM_URL, "127.0.0.1 → trả về nguyên chuỗi (đang đứng trên VM)");
  ok(
    appDatabaseUrl({ DATABASE_URL: "postgresql://u:p@localhost:5432/jarvis" }, []).length > 0,
    "localhost cũng là loopback — VM có thể đổi cách viết mà luật không lung lay",
  );

  const ném = (env: NodeJS.ProcessEnv): KhongPhaiDatabaseCuaApp => {
    try {
      appDatabaseUrl(env, []);
    } catch (err) {
      if (err instanceof KhongPhaiDatabaseCuaApp) return err;
      throw new Failed(`ném sai loại lỗi: ${String(err)}`);
    }
    throw new Failed("KHÔNG ném — đây là ca đã âm thầm đọc nhầm database suốt một ngày");
  };

  ném({ DATABASE_URL: NEON_URL });
  passed += 1;
  console.log("  ✔ Neon cũ → NÉM KhongPhaiDatabaseCuaApp (không lặng lẽ đọc bản đông cứng)");

  ném({});
  passed += 1;
  console.log("  ✔ thiếu hẳn DATABASE_URL → cũng NÉM, không coi chuỗi rỗng là loopback");

  ném({ DATABASE_URL: "khong-phai-url" });
  passed += 1;
  console.log("  ✔ chuỗi không đọc được thành URL → NÉM chứ không vỡ bằng TypeError");

  console.log("\n── Lời từ chối: đủ để gõ tiếp được ngay ─────────────────────────");

  const loi = ném({ DATABASE_URL: NEON_URL, npm_lifecycle_event: "roster:purge" }).message;
  ok(loi.includes("ep-cu-xua-123.ap-southeast-1.aws.neon.tech"), "nói RÕ nó đang trỏ đi đâu");
  ok(!loi.includes(MAT_KHAU), "KHÔNG để mật khẩu trong chuỗi kết nối lọt ra log");
  ok(loi.includes("npm run vm -- npm run roster:purge"), "chỉ đúng lệnh phải gõ lại");
  ok(/đông cứng|không ai dùng nữa/.test(loi), "nói vì sao chạy tiếp ở đây là nguy hiểm, không chỉ 'không được'");

  console.log("\n── Dựng lại lệnh: hai dấu `--` ──────────────────────────────────");

  ok(
    vmRerunCommand("roster:purge", ["--dry-run"]) === "npm run vm -- npm run roster:purge -- --dry-run",
    "có đối số → hai dấu `--` (thiếu dấu sau thì npm nuốt mất --dry-run)",
  );
  ok(
    vmRerunCommand("verify:keepalive-live") === "npm run vm -- npm run verify:keepalive-live",
    "không đối số → đúng một dấu `--`",
  );
  ok(
    vmRerunCommand("roster:purge", ["--older-than", "6"]) === "npm run vm -- npm run roster:purge -- --older-than 6",
    "đối số rời được nối lại nguyên thứ tự",
  );
  ok(
    !vmRerunCommand(undefined).includes("npm run undefined"),
    "chạy tsx thẳng tay (không có npm_lifecycle_event) → nói không biết, KHÔNG bịa một lệnh sai",
  );
  ok(vmRerunCommand("   ") === vmRerunCommand(undefined), "tên script toàn khoảng trắng cũng coi như không có");

  console.log("\n── Ca biên của phép in host ─────────────────────────────────────");

  ok(offVmRefusal(undefined, "x").includes("DATABASE_URL trống"), "không có biến → nói thẳng là trống");
  ok(offVmRefusal("   ", "x").includes("DATABASE_URL trống"), "biến toàn khoảng trắng cũng là trống");
  ok(
    offVmRefusal("postgresql://u:p@auto-hh3d-4.internal/db", "x").includes("auto-hh3d-4.internal"),
    "host của một trạm cũ hiện nguyên tên — đủ để nhận ra mình đang trỏ vào cái gì",
  );
}

try {
  main();
  console.log(`\n✔ ${passed} phép kiểm — luật「database của app」và lời từ chối của nó đều đứng.`);
} catch (err) {
  console.error(err instanceof Failed ? `\n✗ ${err.message}` : `\n✖ ${err instanceof Error ? err.stack : err}`);
  process.exitCode = 1;
}
