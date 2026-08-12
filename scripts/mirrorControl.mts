/**
 * Bảng điều phối gương trạm — công cụ vận hành từ dòng lệnh.
 *
 *   npm run mirror:control -- status                       # đọc + xác minh + in bảng
 *   npm run mirror:control -- set --site auto-hh3d --url https://auto-hh3d.vercel.app
 *
 * `set` là phép LẬT TRẠM khi bảng đã tồn tại — nó chính là bước `flipping` của máy trạng
 * thái §6 (deploy/mirror/README.md) trong lúc trang admin (phase 3) chưa ra đời, và vẫn sẽ
 * là đường tay chữa cháy về sau. Revision tự tăng từ bản đang có; ghi xong ĐỌC LẠI qua đúng
 * đường công khai mà middleware dùng, xác minh chữ ký, rồi mới báo xong.
 *
 * S3Client dựng tại chỗ với hai quirk BẮT BUỘC của OCI (path-style + tắt checksum CRC32) —
 * chép từ media.ts, xem bình chú bên ấy; đừng "dọn gọn" hai dòng đó, thiếu là chữ ký hỏng.
 */
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { CONTROL_DOC_KEY, signControlDoc, type ControlDoc } from "../src/lib/control/doc";
import { controlDocUrl, readControlDoc } from "../src/lib/control/read";
import { loadEnv } from "./loadEnv.mjs";

loadEnv();

function arg(name: string): string | undefined {
  const at = process.argv.indexOf(`--${name}`);
  return at > -1 ? process.argv[at + 1] : undefined;
}

function requireEnv(key: string): string {
  const value = (process.env[key] ?? "").trim();
  if (!value) throw new Error(`Thiếu ${key} — chạy \`npm run env:pull\` hoặc soi .env.local.`);
  return value;
}

const mode = process.argv[2] ?? "status";

if (mode === "status") {
  const url = controlDocUrl();
  console.log(`• Bảng: ${url ?? "(thiếu OCI_REGION/NAMESPACE/BUCKET — không dựng được URL)"}`);
  const doc = await readControlDoc();
  if (!doc) {
    console.log("• Chưa có bảng hợp lệ (chưa init, hoặc chữ ký/định dạng sai — soi tay bằng curl nếu ngờ).");
    process.exit(0);
  }
  console.log(`  revision   : ${doc.revision}`);
  console.log(`  trạm hoạt động: ${doc.activeSiteId} → ${doc.activeUrl}`);
  console.log(`  lật lúc    : ${doc.switchedAt} bởi ${doc.switchedBy}`);
  console.log("  chữ ký     : ✔ hợp lệ (readControlDoc đã xác minh)");
  process.exit(0);
}

if (mode === "set") {
  const site = arg("site");
  const rawUrl = arg("url");
  if (!site || !rawUrl) throw new Error("Cần đủ --site <SITE_ID> và --url <https://…>.");
  const activeUrl = rawUrl.replace(/\/$/, "");
  if (!activeUrl.startsWith("https://")) throw new Error(`--url phải là https tuyệt đối, nhận「${rawUrl}」.`);

  const workerToken = requireEnv("WORKER_TOKEN");
  const region = requireEnv("OCI_REGION");
  const namespace = requireEnv("OCI_NAMESPACE");
  const bucket = requireEnv("OCI_BUCKET");

  const current = await readControlDoc();
  const revision = (current?.revision ?? 0) + 1;

  // Dọn trạm sắp lên thay TRƯỚC khi lật — cùng luật với nút「Lật」trên trang admin
  // (mirror/promote.ts giải thích vì sao phải là một luật chung).
  //
  // KHÔNG ĐƯỢC PHÉP CHẶN LƯỢT LẬT. Lệnh này là đường thoát hiểm: nó tồn tại cho đúng cái ngày
  // trạm chính chết hẳn, mà ngày ấy `DATABASE_URL` dưới máy trỏ vào chính cái xác ấy nên đọc
  // sổ sẽ hỏng. Hỏng thì kêu to rồi đi tiếp — một trạm lên ngôi mang theo bảng bế quan vẫn hơn
  // một tông môn không có trạm nào.
  let cleanup = "";
  try {
    const dbUrl = (process.env.DATABASE_URL ?? "").trim();
    if (!dbUrl) throw new Error("thiếu DATABASE_URL nên không đọc được sổ gương");
    const { neon } = await import("@neondatabase/serverless");
    const rows = (await neon(dbUrl)`select value from app_settings where id = 'global'`) as { value: unknown }[];
    const book = ((rows[0]?.value ?? {}) as { mirrors?: { id: string; pg: string }[] }).mirrors ?? [];
    const entry = book.find((m) => m.id === site);
    if (!entry) throw new Error(`sổ gương không có entry「${site}」`);
    const { decryptSecret } = await import("../src/lib/crypto/secretBox");
    const { resetPromotedStation } = await import("../src/lib/mirror/promote");
    await resetPromotedStation(neon(decryptSecret(entry.pg)), current?.activeSiteId || "(không rõ)");
    cleanup = `✔ đã tắt bế quan + đặt mirrorSwitch về idle ở「${site}」`;
  } catch (err) {
    cleanup =
      `⚠ KHÔNG dọn được「${site}」(${err instanceof Error ? err.message : "lỗi lạ"}).\n` +
      `  Vẫn lật bảng. Nhưng nếu trạm ấy đang mang bế quan của lượt chuyển trước thì nó lên ngôi\n` +
      `  trong tình trạng đóng cửa — vào /admin của nó tắt bảo trì, hoặc chạy tay:\n` +
      `  update app_settings set value = jsonb_set(value,'{maintenance}','{\"active\":false,\"startedAt\":null,\"expectedEndAt\":null,\"note\":\"\"}'::jsonb,true);`;
  }
  console.log(`• ${cleanup}`);

  const doc: ControlDoc = signControlDoc(
    {
      revision,
      activeSiteId: site,
      activeUrl,
      switchedAt: new Date().toISOString(),
      switchedBy: `mirrorControl.mts@${process.env.COMPUTERNAME ?? process.env.HOSTNAME ?? "cli"}`,
    },
    workerToken,
  );

  if (current) {
    console.log(`• Lật bảng: ${current.activeSiteId} (rev ${current.revision}) → ${site} (rev ${revision})`);
  } else {
    console.log(`• Khởi tạo bảng: ${site} (rev ${revision})`);
  }

  const client = new S3Client({
    region,
    endpoint: `https://${namespace}.compat.objectstorage.${region}.oraclecloud.com`,
    credentials: {
      accessKeyId: requireEnv("OCI_ACCESS_KEY_ID"),
      secretAccessKey: requireEnv("OCI_SECRET_ACCESS_KEY"),
    },
    forcePathStyle: true,
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });

  try {
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: CONTROL_DOC_KEY,
        Body: JSON.stringify(doc, null, 2),
        ContentType: "application/json",
        // Lớp cache nào giữa OCI và bên đọc cũng không được ôm bảng quá nhịp cache nội bộ.
        CacheControl: "no-store",
      }),
    );
  } finally {
    client.destroy();
  }

  // Đọc lại bằng ĐÚNG con đường middleware sẽ đi — thấy đúng revision vừa ghi mới tin là xong.
  const { resetControlCacheForVerify } = await import("../src/lib/control/read");
  resetControlCacheForVerify();
  const echo = await readControlDoc();
  if (!echo || echo.revision !== revision || echo.activeSiteId !== site) {
    throw new Error(
      `Ghi xong nhưng đọc lại không khớp (đọc được: ${echo ? `rev ${echo.revision} → ${echo.activeSiteId}` : "null"}) — ` +
        "bảng trên bucket đang ở trạng thái không xác định, soi tay ngay.",
    );
  }
  console.log(`✔ Bảng đã sống: rev ${echo.revision}, trạm hoạt động ${echo.activeSiteId} → ${echo.activeUrl}`);
  process.exit(0);
}

throw new Error(`Không hiểu lệnh「${mode}」— dùng status | set.`);
