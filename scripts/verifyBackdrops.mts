#!/usr/bin/env node
/**
 * Kiểm chứng TẤM NỀN: phần thuần (sổ trang, phép làm sạch URL, phép dựng CSS) và phần chạm
 * tàng khố THẬT (tải lên, liệt kê, xoá).
 *
 * Phần đáng tiền nhất nằm ở khối "chống chèn": URL trong app_settings đi THẲNG vào một thẻ
 * `<style>` của mọi trang. Đó là một ranh giới tin cậy thật — document JSONB ấy sửa tay được —
 * nên mỗi ngả thoát ra khỏi luật CSS phải có một dòng đóng đinh, chứ không phải một niềm tin
 * rằng `safeBackdropUrl` chắc là đủ chặt.
 *
 * Vết để lại: một object tạm dưới `backdrops/__kiem-tra-…`, dọn trong `finally` theo TIỀN TỐ
 * nên một lần chạy hỏng trước đây cũng được quét nốt. KHÔNG đụng vào phép gán trong
 * app_settings — script này chỉ đọc cấu hình, vì đây là database thật của tông môn đang chạy.
 */
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import {
  BACKDROP_PREFIX,
  backdropObjectKey,
  deleteObject,
  listObjectsUnder,
  mediaStoreReady,
  putBackdropFile,
  sniffImageKind,
  statObject,
} from "../src/lib/services/media";
import { getAppSettings } from "../src/lib/services/settings";
import {
  BACKDROP_PAGES,
  DEFAULT_SLOT,
  RESCUE_BACKDROP_URL,
  backdropCss,
  backdropDisplayName,
  isBackdropPageKey,
  safeBackdropUrl,
} from "../src/lib/validation/backdrops";
import { loadEnv } from "./loadEnv.mjs";

loadEnv();

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};

// ---- 1. Sổ trang ----------------------------------------------------------------------
assert(BACKDROP_PAGES.length === 9, `sổ trang đang có ${BACKDROP_PAGES.length} mục, đáng lẽ 9`);
assert(
  new Set(BACKDROP_PAGES.map((p) => p.key)).size === BACKDROP_PAGES.length,
  "mã trang không được trùng nhau — hai trang cùng mã là hai luật CSS đè lên nhau",
);
assert(
  !BACKDROP_PAGES.some((p) => p.key === DEFAULT_SLOT),
  `không trang nào được mang mã「${DEFAULT_SLOT}」— nó là tên ô của nền mặc định`,
);
assert(
  !BACKDROP_PAGES.some((p) => p.path === "/"),
  "trang chủ KHÔNG được có trong sổ: nó chính là nền mặc định, không phải một mục chọn riêng",
);
for (const page of BACKDROP_PAGES) {
  assert(page.path.startsWith("/"), `đường dẫn của ${page.key} phải bắt đầu bằng /`);
  assert(page.label.trim().length > 0, `trang ${page.key} chưa có nhãn hiển thị`);
  assert(isBackdropPageKey(page.key), `chính mã ${page.key} phải được nhận là mã hợp lệ`);
}
assert(!isBackdropPageKey("khong-co-that"), "mã bịa phải bị từ chối");
assert(!isBackdropPageKey(""), "chuỗi rỗng không phải mã trang");
console.log(`✔ Sổ trang: ${BACKDROP_PAGES.length} trang, mã không trùng, trang chủ đứng ngoài.`);

// ---- 1b. Nền cứu hộ: hằng số trong code và luật trong CSS phải nói cùng một tấm ---------
// CSS không đọc được hằng số TypeScript, nên đường dẫn ấy buộc phải nằm ở hai chỗ. Dòng này
// biến "hai bản chép tay" thành một bất biến CÓ NGƯỜI GÁC: đổi tên tệp ở một bên là đỏ ngay,
// thay vì lặng lẽ để tông môn mất luôn nấc cuối của thang rơi.
const globalsCss = readFileSync("src/app/globals.css", "utf8");
assert(
  globalsCss.includes(`url("${RESCUE_BACKDROP_URL}")`),
  `globals.css phải dùng đúng tấm cứu hộ「${RESCUE_BACKDROP_URL}」mà code khai`,
);
assert(
  existsSync(`public${RESCUE_BACKDROP_URL}`),
  `tấm cứu hộ「public${RESCUE_BACKDROP_URL}」phải CÒN trong repo — nó là nấc cuối khi tàng khố đóng`,
);
console.log(`✔ Nền cứu hộ: globals.css và code cùng trỏ vào ${RESCUE_BACKDROP_URL}, và tệp còn trong repo.`);

// ---- 2. Làm sạch URL: đây là hàng rào chống chèn CSS ------------------------------------
const OK_URLS = [
  RESCUE_BACKDROP_URL,
  "/backdrop-hang-doi.png",
  "https://objectstorage.eu-frankfurt-1.oraclecloud.com/n/fr5enftxwrc3/b/jarvis-media/o/backdrops/nen-a1B2c3D4e5F6g7H8.png",
  "https://objectstorage.eu-frankfurt-1.oraclecloud.com/n/x/b/y/o/backdrops/Th%C3%A1i-abc.webp",
];
for (const url of OK_URLS) {
  assert(safeBackdropUrl(url) === url, `URL hợp lệ bị từ chối oan: ${url}`);
}

/** Mỗi chuỗi dưới đây là một ngả THOÁT RA nếu phép làm sạch hớ. */
const ATTACKS = [
  ['url có ngoặc kép thoát khỏi url()', '/a.png") ; body { display: none } .x { content: url("'],
  ["url có dấu ngoặc đơn đóng sớm", "/a.png) ; body { display: none"],
  ["url mang </style> thoát khỏi thẻ", "/a.png</style><script>alert(1)</script>"],
  ["url có xuống dòng", "/a.png\n}body{display:none}"],
  ["javascript:", "javascript:alert(1)"],
  ["data: URI", "data:text/html,<script>alert(1)</script>"],
  ["http thường (không phải https)", "http://example.com/a.png"],
  ["giao thức tương đối", "//example.com/a.png"],
  ["đường dẫn tương đối", "a.png"],
  ["chuỗi rỗng", ""],
  ["chỉ khoảng trắng", "   "],
  ["url có dấu cách ở giữa", "/a b.png"],
  ["url có dấu nháy đơn", "/a'.png"],
  ["url có dấu gạch chéo ngược", "/a\\.png"],
  ["https thiếu đường dẫn", "https://example.com"],
] as const;
for (const [name, attack] of ATTACKS) {
  assert(safeBackdropUrl(attack) === null, `phải từ chối — ${name}: ${JSON.stringify(attack)}`);
}
assert(safeBackdropUrl(`/${"a".repeat(3000)}.png`) === null, "URL dài quá 2048 ký tự phải bị từ chối");
console.log(`✔ Làm sạch URL: ${OK_URLS.length} dạng hợp lệ lọt, ${ATTACKS.length} ngả chèn CSS/HTML bị chặn.`);

// ---- 3. Dựng CSS -----------------------------------------------------------------------
assert(backdropCss(null, {}) === "", "chưa cấu hình gì thì KHÔNG được phát ra luật nào");

const one = backdropCss(null, { chat: { key: "backdrops/a.png", url: "/a.png" } });
assert(
  one === 'body:has([data-backdrop="chat"]) .backdrop{background-image:url("/a.png")}',
  `luật một trang sai hình dạng: ${one}`,
);

const withDefault = backdropCss({ key: "backdrops/d.png", url: "/d.png" }, {});
assert(
  withDefault === '.backdrop{background-image:url("/d.png")}',
  `luật nền mặc định sai hình dạng: ${withDefault}`,
);

// Nền mặc định phải đứng TRƯỚC luật của từng trang, nếu không nó đè lên chính chúng.
const both = backdropCss({ key: "backdrops/d.png", url: "/d.png" }, { chat: { key: "k", url: "/c.png" } });
assert(
  both.indexOf(".backdrop{") < both.indexOf("body:has("),
  "luật mặc định phải đứng trước luật từng trang, không thì nó đè mất",
);

// Mã trang lạ trong document JSONB: KHÔNG được sinh ra luật nào.
const bogus = backdropCss(null, { "khong-co-that": { key: "k", url: "/x.png" } } as never);
assert(bogus === "", `mã trang lạ phải bị bỏ qua, nhận được: ${bogus}`);

// URL bẩn: bỏ qua đúng ô ấy, các ô khác không suy suyển.
const dirty = backdropCss(null, {
  chat: { key: "k", url: '/a.png") ; body { display: none } .x { content: url("' },
  admin: { key: "k", url: "/ok.png" },
} as never);
assert(!dirty.includes("display: none"), "URL bẩn KHÔNG được lọt vào CSS");
assert(dirty.includes('data-backdrop="admin"'), "một ô bẩn không được kéo theo ô lành");
assert(!dirty.includes('data-backdrop="chat"'), "ô có URL bẩn phải bị bỏ hẳn");

// Thứ tự ổn định: cùng cấu hình, hai lần dựng ra cùng một chuỗi.
const inputA = { profile: { key: "k", url: "/p.png" }, chat: { key: "k", url: "/c.png" } };
const inputB = { chat: { key: "k", url: "/c.png" }, profile: { key: "k", url: "/p.png" } };
assert(backdropCss(null, inputA) === backdropCss(null, inputB), "thứ tự luật phải theo sổ trang, không theo thứ tự khoá");
console.log("✔ Dựng CSS: hình dạng đúng, mặc định đứng trước, mã lạ và URL bẩn bị loại, thứ tự ổn định.");

// ---- 4. Tên hiển thị -------------------------------------------------------------------
assert(
  backdropDisplayName("backdrops/tu-linh-tien-tu-a1B2c3D4e5F6g7H8.png") === "tu-linh-tien-tu",
  "phải cắt cả tiền tố, hậu tố ngẫu nhiên và đuôi file",
);
assert(backdropDisplayName("backdrops/nen.png") === "nen", "key không có hậu tố vẫn phải đọc được");
assert(backdropDisplayName("backdrops/anh la.PNG").length > 0, "key lạ vẫn phải ra một cái tên, không ra rỗng");
console.log("✔ Tên hiển thị: cắt đúng hậu tố ngẫu nhiên, key lạ vẫn có tên.");

// ---- 5. Tàng khố thật -------------------------------------------------------------------
if (!mediaStoreReady()) {
  console.log("");
  console.log("⚠ Tàng khố media chưa cấu hình — BỎ QUA phần chạm kho. Phần thuần ở trên đã xanh.");
  process.exit(0);
}

const TEMP_NAME = `__kiem-tra-${randomUUID().slice(0, 8)}`;
let storedKey = "";

try {
  // PNG 1×1 hợp lệ, dựng bằng tay để không phụ thuộc tệp nào trong repo.
  const pixel = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
  const body = new Uint8Array(pixel);
  const kind = sniffImageKind(body);
  assert(kind?.contentType === "image/png", "ảnh thử phải được nhận là PNG");

  const key = backdropObjectKey(TEMP_NAME, kind!);
  assert(key.startsWith(`${BACKDROP_PREFIX}/`), `key phải nằm dưới ${BACKDROP_PREFIX}/, nhận ${key}`);
  assert(key.endsWith(".png"), "đuôi file phải suy từ BYTES, không từ tên client khai");
  assert(
    backdropObjectKey(TEMP_NAME, kind!) !== key,
    "hai lần đặt tên phải ra hai key khác nhau — `immutable` trong cache-control dựa vào đó",
  );

  const stored = await putBackdropFile({ name: TEMP_NAME, kind: kind!, body });
  storedKey = stored.key;
  assert(stored.url.startsWith("https://"), `URL công khai phải là https, nhận ${stored.url}`);
  assert(safeBackdropUrl(stored.url) === stored.url, "URL do chính kho sinh ra PHẢI qua được phép làm sạch");

  const head = await statObject(storedKey);
  assert(head?.size === body.byteLength, `kho phải giữ đủ ${body.byteLength} byte, nhận ${head?.size}`);
  console.log(`✔ Tải lên: ${storedKey} (${head?.size} B), URL qua được phép làm sạch.`);

  const listed = await listObjectsUnder(`${BACKDROP_PREFIX}/`);
  assert(!listed.storeClosed, "kho vừa ghi được thì không thể báo đóng");
  if (!listed.storeClosed) {
    const mine = listed.objects.find((object) => object.key === storedKey);
    assert(mine !== undefined, "tấm vừa tải lên phải có trong phép liệt kê");
    assert(mine!.size === body.byteLength, "phép liệt kê phải khai đúng dung lượng");
    assert(mine!.url === stored.url, "URL từ phép liệt kê phải trùng URL lúc tải lên");
    assert(
      listed.objects.every((object) => object.key !== `${BACKDROP_PREFIX}/`),
      "chính cái tiền tố không được lọt vào danh sách như một tấm ảnh",
    );
    // Mới trước: tấm vừa tải lên là tấm mới nhất, nên nó phải đứng đầu.
    assert(listed.objects[0]?.key === storedKey, "phép liệt kê phải sắp mới-trước");
    console.log(`✔ Liệt kê: ${listed.objects.length} tấm dưới ${BACKDROP_PREFIX}/, mới-trước, không lẫn thư mục.`);
  }

  await deleteObject(storedKey);
  assert((await statObject(storedKey)) === null, "xoá xong thì kho phải hết tấm ấy");
  storedKey = "";
  console.log("✔ Xoá: object biến mất khỏi kho thật.");

  // ---- 6. Cấu hình đang chạy có nhất quán không ------------------------------------------
  const { appearance } = await getAppSettings();
  const configured = [
    ...(appearance.defaultBackdrop ? [[DEFAULT_SLOT, appearance.defaultBackdrop] as const] : []),
    ...BACKDROP_PAGES.flatMap((page) => {
      const chosen = appearance.pageBackdrops[page.key];
      return chosen ? [[page.key, chosen] as const] : [];
    }),
  ];
  for (const [slot, image] of configured) {
    assert(safeBackdropUrl(image.url) !== null, `ô「${slot}」đang giữ một URL không qua nổi phép làm sạch: ${image.url}`);
    assert(
      (await statObject(image.key)) !== null,
      `ô「${slot}」trỏ vào「${image.key}」mà kho không còn tấm ấy — trang này đang rơi về nền mặc định`,
    );
  }
  console.log(
    configured.length === 0
      ? "✔ Cấu hình: chưa ô nào được gán — mọi trang dùng tấm cứu hộ trong repo."
      : `✔ Cấu hình: ${configured.length} ô đã gán, ô nào cũng trỏ vào một tấm CÒN trong kho.`,
  );

  console.log("");
  console.log("TẤT CẢ XANH — sổ trang, hàng rào chèn CSS, và đường ghi/đọc tàng khố đều đứng vững.");
} finally {
  if (storedKey) {
    await deleteObject(storedKey).catch(() => {});
  }
}
