#!/usr/bin/env node
/**
 * Kiểm chứng tàng khố media — cách đặt tên object, cách dựng URL, và ranh giới cấu hình.
 *
 * Phần KHÔNG cần mạng chạy ở mọi máy. Phần vòng đời thật (tải lên → tải về bằng HTTPS công
 * khai → xoá) chỉ chạy khi có đủ bộ biến OCI_* — và nó KHÔNG bị bỏ qua trong im lặng: cuối
 * bản kê ghi rõ nó có chạy hay không, vì một phép thử bị bỏ qua mà trông như đã xanh là cách
 * nhanh nhất để tin vào một kho chưa từng được chạm tới.
 *
 * Đặt `MEDIA_TEST_PREFIX` để đổi tiền tố của object thử (mặc định `verify/`); mọi object nó
 * tạo đều bị xoá ở cuối, kể cả khi một phép thử ở giữa ném.
 */
import { loadEnv } from "./loadEnv.mjs";

loadEnv();

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};

const OCI_KEYS = ["OCI_REGION", "OCI_NAMESPACE", "OCI_BUCKET", "OCI_ACCESS_KEY_ID", "OCI_SECRET_ACCESS_KEY"] as const;

/** Ảnh chụp biến môi trường thật, để mấy phép thử về cấu hình mượn rồi trả lại nguyên trạng. */
const realEnv = Object.fromEntries(OCI_KEYS.map((k) => [k, process.env[k]])) as Record<string, string | undefined>;
const hasRealConfig = OCI_KEYS.every((k) => (realEnv[k] ?? "").trim().length > 0);

function setEnv(values: Partial<Record<(typeof OCI_KEYS)[number], string | undefined>>) {
  for (const key of OCI_KEYS) {
    const value = values[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function restoreEnv() {
  setEnv(realEnv as Partial<Record<(typeof OCI_KEYS)[number], string | undefined>>);
}

const media = await import("../src/lib/services/media.ts");

const FAKE = {
  OCI_REGION: "eu-frankfurt-1",
  OCI_NAMESPACE: "frtestns",
  OCI_BUCKET: "jarvis-media",
  OCI_ACCESS_KEY_ID: "khoa-thu",
  OCI_SECRET_ACCESS_KEY: "bi-mat-thu",
} as const;

const created: string[] = [];

try {
  // ---- Ranh giới cấu hình ----------------------------------------------------------
  setEnv({});
  assert(!media.mediaStoreReady(), "không có biến nào thì kho phải báo chưa khai mở");

  setEnv({ OCI_REGION: FAKE.OCI_REGION, OCI_BUCKET: FAKE.OCI_BUCKET });
  let partialError: unknown = null;
  try {
    media.mediaStoreReady();
  } catch (err) {
    partialError = err;
  }
  assert(partialError instanceof Error, "đặt nửa vời phải ném, không được im lặng coi như chưa mở");
  const partialMessage = (partialError as Error).message;
  assert(partialMessage.includes("OCI_NAMESPACE"), "lời báo lỗi phải gọi tên biến còn thiếu");
  assert(partialMessage.includes("OCI_SECRET_ACCESS_KEY"), "phải gọi tên ĐỦ các biến còn thiếu");
  assert(!partialMessage.includes("OCI_REGION"), "biến đã đặt thì không được kể vào danh sách thiếu");

  setEnv(FAKE);
  assert(media.mediaStoreReady(), "đủ bộ biến thì kho phải báo sẵn sàng");
  console.log("✔ Cấu hình: không có gì = chưa khai mở, nửa vời = ném kèm tên biến thiếu, đủ = sẵn sàng.");

  // ---- Đặt tên object --------------------------------------------------------------
  const key = media.chatObjectKey("u-123", "anh dep.jpg");
  assert(key.startsWith("chat/u-123/"), `key phải nằm dưới chat/{userId}/, đang là ${key}`);
  assert(key.endsWith(".jpg"), `đuôi file phải nằm CUỐI, đang là ${key}`);
  assert(key.includes("anh_dep-"), `tên gốc phải còn nhận ra được, đang là ${key}`);

  assert(
    media.chatObjectKey("u-1", "a.jpg") !== media.chatObjectKey("u-1", "a.jpg"),
    "hai lần gửi cùng tên KHÔNG được ra cùng key — đó là chỗ người sau ghi đè người trước",
  );

  const unicode = media.chatObjectKey("u-1", "ảnh của tông môn.png");
  assert(unicode.includes("ảnh_của_tông_môn-"), `chữ tiếng Việt phải giữ nguyên, đang là ${unicode}`);
  assert(unicode.endsWith(".png"), "đuôi vẫn phải ở cuối khi tên có dấu");

  const noExt = media.chatObjectKey("u-1", "README");
  assert(!noExt.slice(noExt.lastIndexOf("/")).includes("."), `không có đuôi thì đừng bịa ra, đang là ${noExt}`);

  const dotfile = media.chatObjectKey("u-1", ".gitignore");
  assert(dotfile.includes("/.gitignore-"), `".gitignore" là TÊN, không phải đuôi — đang là ${dotfile}`);
  assert(!dotfile.endsWith(".gitignore"), `hậu tố ngẫu nhiên phải nằm sau tên, đang là ${dotfile}`);

  const longExt = media.chatObjectKey("u-1", "tep.dinhkemcuctokhongphaiduoifile");
  assert(!longExt.endsWith("khongphaiduoifile"), `đuôi dài bất thường phải bị coi là tên, đang là ${longExt}`);

  const empty = media.chatObjectKey("u-1", "");
  assert(empty.includes("/tep-"), `tên rỗng phải rơi về "tep", đang là ${empty}`);

  const symbols = media.chatObjectKey("u-1", "???.png");
  assert(symbols.includes("/tep-"), `tên toàn ký tự lạ phải rơi về "tep", đang là ${symbols}`);
  assert(symbols.endsWith(".png"), "vẫn giữ đuôi khi phần tên bị thay");

  // Điều PHẢI giữ là số tầng: một dấu `/` lọt vào userId sẽ đẻ thêm thư mục giữa chat/ và
  // tên file, và từ đó object của người này rơi vào vùng tên của người khác.
  const nastyUser = media.chatObjectKey("../../etc", "a.png");
  assert(nastyUser.split("/").length === 3, `key phải đúng 3 tầng, đang là ${nastyUser}`);
  assert(!nastyUser.includes(".."), `userId phải được rửa sạch, đang là ${nastyUser}`);
  assert(media.chatObjectKey("", "a.png").includes("/an-danh/"), "userId rỗng phải có đường lui");
  console.log("✔ Đặt tên: đuôi ở cuối, tên gốc còn nhận ra, không đụng nhau, tên lạ có đường lui.");

  // ---- URL công khai ---------------------------------------------------------------
  const url = media.publicUrlOf("chat/u-1/ảnh.png");
  assert(
    url.startsWith(`https://objectstorage.${FAKE.OCI_REGION}.oraclecloud.com/n/${FAKE.OCI_NAMESPACE}/b/${FAKE.OCI_BUCKET}/o/`),
    `URL sai hình dạng: ${url}`,
  );
  assert(url.includes("/o/chat/u-1/"), `dấu / phân cấp phải giữ nguyên, không bị mã hoá: ${url}`);
  assert(!url.includes("ảnh"), `chữ có dấu phải được mã hoá phần trăm: ${url}`);
  assert(new URL(url).pathname.endsWith("/o/chat/u-1/" + encodeURIComponent("ảnh.png")), `mã hoá sai: ${url}`);
  console.log("✔ URL công khai: đúng dạng gốc OCI, phân cấp giữ nguyên, chữ có dấu được mã hoá.");

  // ---- Vòng đời thật trên OCI ------------------------------------------------------
  if (!hasRealConfig) {
    console.log("");
    console.log("⚠ BỎ QUA vòng đời thật: chưa có bộ biến OCI_*. Những gì trên đây KHÔNG chứng minh");
    console.log("  rằng kho thật nhận được một byte nào. Đặt OCI_* rồi chạy lại để có phần đó.");
  } else {
    media.closeMediaStore();
    restoreEnv();

    const prefix = process.env.MEDIA_TEST_PREFIX?.trim() || "verify";
    const stamp = `${Date.now()}`;
    const payload = new Uint8Array(Buffer.from(`kiểm chứng tàng khố media ${stamp}`, "utf8"));

    const stored = await media.putChatFile({
      userId: `${prefix}-${stamp}`,
      fileName: "kiểm chứng.txt",
      body: payload,
    });
    created.push(stored.key);

    const stat = await media.statObject(stored.key);
    assert(stat !== null, "vừa tải lên xong thì HEAD phải thấy object");
    assert(stat!.size === payload.byteLength, `kích thước phải khớp: khai ${payload.byteLength}, kho báo ${stat!.size}`);

    // Đây mới là phép thử thật sự: một trình duyệt bất kỳ, KHÔNG mang chữ ký nào, phải tải
    // được đúng bytes ấy về. Bucket không công khai thì chính chỗ này sẽ đỏ.
    const fetched = await fetch(stored.url);
    assert(fetched.ok, `tải công khai phải được, đang là HTTP ${fetched.status} ${fetched.statusText}`);
    const back = new Uint8Array(await fetched.arrayBuffer());
    assert(Buffer.compare(Buffer.from(back), Buffer.from(payload)) === 0, "bytes tải về phải khớp từng byte");
    // Tệp KHÔNG phải ảnh phải mang nhãn mờ + ép tải xuống. Đây là phép chặn XSS lưu trữ: bucket
    // công khai đọc, nên một tệp giữ được nhãn `text/html` là một trang web của kẻ tải lên chạy
    // trên tên miền của Oracle.
    assert(
      fetched.headers.get("content-type") === "application/octet-stream",
      `tệp không phải ảnh phải mang nhãn mờ, đang là ${fetched.headers.get("content-type")}`,
    );
    assert(
      (fetched.headers.get("content-disposition") ?? "").startsWith("attachment"),
      `tệp không phải ảnh phải bị ép tải xuống, đang là ${fetched.headers.get("content-disposition")}`,
    );
    assert(
      (fetched.headers.get("cache-control") ?? "").includes("max-age=2592000"),
      `cache-control phải được giữ, đang là ${fetched.headers.get("cache-control")}`,
    );

    // Và đây là ca ĐỘC: một tệp HTML tự khai là ảnh. Nhãn phải do BYTES quyết định.
    const html = new Uint8Array(Buffer.from("<!doctype html><script>alert(document.domain)</script>", "utf8"));
    const evil = await media.putChatFile({ userId: `${prefix}-${stamp}`, fileName: "anh.png", body: html });
    created.push(evil.key);
    const evilFetched = await fetch(evil.url);
    assert(
      evilFetched.headers.get("content-type") === "application/octet-stream",
      `HTML tự khai là ảnh vẫn phải ra nhãn mờ, đang là ${evilFetched.headers.get("content-type")}`,
    );
    assert(
      (evilFetched.headers.get("content-disposition") ?? "").startsWith("attachment"),
      "HTML phải bị ép tải xuống, không được dựng thành trang",
    );

    // Ảnh THẬT thì giữ nhãn ảnh thật, để bong bóng tin vẫn vẽ được <img>.
    const png = new Uint8Array(
      Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==", "base64"),
    );
    const good = await media.putChatFile({ userId: `${prefix}-${stamp}`, fileName: "that.png", body: png });
    created.push(good.key);
    const goodFetched = await fetch(good.url);
    assert(
      goodFetched.headers.get("content-type") === "image/png",
      `PNG thật phải giữ nhãn image/png, đang là ${goodFetched.headers.get("content-type")}`,
    );
    assert(
      goodFetched.headers.get("content-disposition") === null,
      "ảnh thật KHÔNG bị ép tải xuống — nếu không thì mọi ảnh trong sảnh thành link tải",
    );

    for (const key of [evil.key, good.key, stored.key]) await media.deleteObject(key);
    created.length = 0;
    assert((await media.statObject(stored.key)) === null, "xoá rồi thì HEAD phải trả về null, không phải ném");

    console.log(`✔ Vòng đời thật trên OCI (${process.env.OCI_BUCKET}): tải lên → tải công khai đúng byte → xoá sạch.`);
    console.log("✔ Nhãn theo BYTES: HTML tự khai là ảnh vẫn ra octet-stream + ép tải xuống; PNG thật giữ image/png.");
  }

  console.log("");
  console.log(hasRealConfig ? "TẤT CẢ XANH — gồm cả vòng đời thật trên OCI." : "XANH phần không cần mạng.");
} finally {
  // Dọn dấu vết kể cả khi ở giữa có phép thử ném — một object thử sót lại trong kho thật là
  // rác vĩnh viễn, vì không ai biết nó từ đâu ra.
  for (const key of created) {
    await media.deleteObject(key).catch((err) => console.error(`  (không xoá được ${key}: ${err})`));
  }
  media.closeMediaStore();
}
