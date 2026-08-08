#!/usr/bin/env node
/**
 * Kiểm chứng kho GIF — ranh giới cấu hình và phép dịch JSON của GIPHY thành thứ sảnh dùng được.
 *
 * Phần dịch chạy trên dữ liệu mẫu nên KHÔNG cần mạng và không tiêu một lượt hạn mức nào. Có
 * `GIPHY_API_KEY` thì chạy thêm một lượt hỏi thật.
 *
 * Vì sao đáng có: `mapGiphyResults` là chỗ duy nhất dữ liệu của một bên thứ ba đi vào hệ
 * thống, và nó phải chịu được mọi hình thù méo mà một API bên ngoài có quyền trả về — bỏ qua
 * bản ghi hỏng, KHÔNG đánh sập cả lưới vì một ô.
 *
 * Có một bẫy được canh riêng ở đây: **tài liệu GIPHY khai `width`/`height`/`size` là number,
 * còn API thật trả về chuỗi.** Phép thử đóng cả hai dạng lại để lần sau ai đó "dọn cho gọn"
 * thì nó kêu ngay, thay vì mọi kích cỡ lặng lẽ thành NaN.
 */
import { loadEnv } from "./loadEnv.mjs";

loadEnv();

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};

const ENV_KEY = "GIPHY_API_KEY";
const realKey = process.env[ENV_KEY];
const hasRealKey = (realKey ?? "").trim().length > 0;

const gif = await import("../src/lib/services/gif.ts");
const { mapGiphyResults, gifSearchReady, searchGifs } = gif;

/** Một bản ghi GIPHY đủ hình dạng, để mỗi phép thử chỉ bẻ đúng một chỗ. */
const wholeGif = (over: Record<string, unknown> = {}) => ({
  id: "abc123",
  title: "mèo vẫy tay",
  images: {
    fixed_width_small: { url: "https://media.giphy.com/small.gif", width: "100", height: "75", size: "1234" },
    downsized_medium: { url: "https://media.giphy.com/medium.gif", width: "320", height: "240", size: "45678" },
    original: { url: "https://media.giphy.com/original.gif", width: "498", height: "373", size: "999999" },
    preview: { url: "https://media.giphy.com/clip.mp4", width: "150", height: "113", size: "88" },
  },
  ...over,
});

try {
  // ---- Ranh giới cấu hình ----------------------------------------------------------
  delete process.env[ENV_KEY];
  assert(!gifSearchReady(), "không có khoá thì kho GIF phải báo chưa khai mở");

  process.env[ENV_KEY] = "   ";
  assert(!gifSearchReady(), "khoá toàn khoảng trắng cũng là chưa khai mở");

  let threw: unknown = null;
  delete process.env[ENV_KEY];
  await searchGifs("mèo").catch((err) => (threw = err));
  assert(threw instanceof Error, "gọi tìm khi chưa có khoá phải ném, không được trả mảng rỗng");
  assert(String((threw as Error).message).includes(ENV_KEY), "lời báo lỗi phải gọi tên biến còn thiếu");

  process.env[ENV_KEY] = "khoa-thu";
  assert(gifSearchReady(), "có khoá thì phải báo sẵn sàng");
  console.log("✔ Cấu hình: không khoá = chưa khai mở, gọi tìm lúc ấy thì ném kèm tên biến.");

  // ---- Dịch bản ghi lành -----------------------------------------------------------
  const [one] = mapGiphyResults({ data: [wholeGif()] });
  assert(one !== undefined, "bản ghi đủ hình dạng phải qua được");
  assert(one.id === "abc123", "id phải giữ nguyên");
  assert(one.name === "mèo vẫy tay", "title phải thành tên đính kèm");
  assert(one.previewUrl.endsWith("small.gif"), `ô xem trước phải lấy bản NHỎ nhất, đang là ${one.previewUrl}`);
  assert(one.url.endsWith("medium.gif"), `bản gửi đi phải là downsized_medium, đang là ${one.url}`);
  assert(one.size === 45678, "kích thước phải lấy theo bản GỬI, không phải bản xem trước");
  assert(one.width === 100 && one.height === 75, "kích cỡ phải lấy theo bản xem trước");
  console.log("✔ Dịch bản lành: xem trước lấy bản nhỏ, gửi lấy bản vừa, kích thước theo đúng bản.");

  // ---- Chuỗi hay số: GIPHY trả chuỗi, tài liệu khai number -------------------------
  const asNumbers = mapGiphyResults({
    data: [
      wholeGif({
        images: {
          fixed_width_small: { url: "https://x/s.gif", width: 100, height: 75, size: 1234 },
          downsized_medium: { url: "https://x/m.gif", width: 320, height: 240, size: 45678 },
        },
      }),
    ],
  });
  assert(asNumbers[0]?.width === 100, "dạng number phải đọc được");
  assert(asNumbers[0]?.size === 45678, "size dạng number phải đọc được");

  const asStrings = mapGiphyResults({ data: [wholeGif()] });
  assert(asStrings[0]?.width === 100, "dạng CHUỖI (thứ API thật trả) phải đọc được");
  assert(typeof asStrings[0]?.width === "number", "đọc xong phải là số, không phải chuỗi");

  const junkDims = mapGiphyResults({
    data: [
      wholeGif({
        images: {
          fixed_width_small: { url: "https://x/s.gif", width: "rất to", height: null, size: "1234" },
          downsized_medium: { url: "https://x/m.gif" },
        },
      }),
    ],
  });
  assert(junkDims[0] !== undefined, "số rác không được làm rơi cả bản ghi");
  assert(junkDims[0].width === 0 && junkDims[0].height === 0, "số rác/thiếu phải về 0, không phải NaN");
  assert(junkDims[0].size === 0, "thiếu size phải về 0 — schema đính kèm đòi số nguyên không âm");
  console.log("✔ Số của GIPHY: đọc được cả chuỗi lẫn number, rác và thiếu đều về 0 chứ không NaN.");

  // ---- Thiếu rendition: lùi theo thứ tự, hoặc bỏ hẳn ------------------------------
  const noSmall = mapGiphyResults({
    data: [wholeGif({ images: { preview_gif: { url: "https://x/p.gif" }, downsized: { url: "https://x/d.gif" } } })],
  });
  assert(noSmall[0]?.previewUrl.endsWith("p.gif"), "thiếu fixed_width_small thì phải lùi tiếp trong chuỗi");
  assert(noSmall[0]?.url.endsWith("d.gif"), "thiếu downsized_medium thì bản gửi phải lùi xuống downsized");

  // `preview` của GIPHY là MP4 — nhận nhầm nó là ảnh thì bong bóng ra một ô vỡ.
  const onlyVideo = mapGiphyResults({ data: [wholeGif({ images: { preview: { url: "https://x/a.mp4" } } })] });
  assert(onlyVideo.length === 0, "chỉ còn rendition MP4 thì phải bỏ, không dựng URL bịa");
  console.log("✔ Thiếu rendition: lùi đúng thứ tự, chỉ còn MP4 thì bỏ bản ghi.");

  // ---- Vá đúng trần của attachmentSchema bên chat.ts -------------------------------
  const noName = mapGiphyResults({ data: [wholeGif({ title: "" })] });
  assert(noName[0]?.name === "gif", `title rỗng phải có đường lui (schema đòi tên dài ≥1), đang là "${noName[0]?.name}"`);

  const noNameField = mapGiphyResults({ data: [wholeGif({ title: undefined })] });
  assert(noNameField[0]?.name === "gif", "thiếu hẳn trường title cũng phải có đường lui");

  const longName = mapGiphyResults({ data: [wholeGif({ title: "ô".repeat(500) })] });
  assert(longName[0] !== undefined && longName[0].name.length === 200, `tên phải cắt còn 200, đang là ${longName[0]?.name.length}`);

  const huge = mapGiphyResults({
    data: [
      wholeGif({
        images: {
          fixed_width_small: { url: "https://x/s.gif", size: "900" },
          downsized_medium: { url: "https://x/m.gif", size: String(99 * 1024 * 1024) },
          downsized: { url: "https://x/d.gif", size: "5000" },
        },
      }),
    ],
  });
  assert(huge[0]?.url.endsWith("d.gif"), `bản gửi quá trần phải bị bỏ qua, đang gửi ${huge[0]?.url}`);
  assert(huge[0]?.size === 5000, "kích thước phải theo bản thực sự được chọn");

  const longUrl = `https://media.giphy.com/${"u".repeat(2100)}.gif`;
  const tooLong = mapGiphyResults({
    data: [wholeGif({ images: { fixed_width_small: { url: longUrl }, downsized_medium: { url: longUrl } } })],
  });
  assert(tooLong.length === 0, "URL vượt trần 2048 của schema phải bị loại Ở ĐÂY, không để vỡ lúc gửi");
  console.log("✔ Trần của schema: tên rỗng có đường lui, tên dài bị cắt, URL và bản gửi quá khổ bị loại sớm.");

  // ---- Dữ liệu méo ------------------------------------------------------------------
  const mixed = mapGiphyResults({
    data: [
      { id: 42 },
      null,
      "chuỗi lạc",
      { id: "ok", images: { fixed_width_small: { url: "https://x/s.gif" }, downsized_medium: { url: "https://x/m.gif" } } },
    ],
  });
  assert(mixed.length === 1 && mixed[0].id === "ok", `bản ghi hỏng phải bị bỏ mà không kéo theo bản lành, còn lại ${mixed.length}`);

  assert(mapGiphyResults({}).length === 0, "payload thiếu data phải cho mảng rỗng");
  assert(mapGiphyResults(null).length === 0, "payload null phải cho mảng rỗng");
  assert(mapGiphyResults("không phải JSON object").length === 0, "payload lạ phải cho mảng rỗng");
  assert(mapGiphyResults({ data: [] }).length === 0, "không kết quả thì mảng rỗng");
  console.log("✔ Dữ liệu méo: bỏ đúng bản hỏng, giữ bản lành, payload lạ không làm nổ gì.");

  // ---- Cách gọi ra ngoài: thay tạm `fetch` để soi mà không cần khoá ----------------
  // Hai hành vi dưới đây chỉ lộ ra ở LÚC GỌI, không nằm trong phép dịch — mà cả hai đều là
  // kiểu hỏng âm thầm: một cái biến lỗi khoá thành "không tìm thấy gì", một cái để GIPHY từ
  // chối vì câu quá dài. Bắt chúng bằng một `fetch` giả thì không tốn lượt hạn mức nào.
  const realFetch = globalThis.fetch;
  try {
    process.env[ENV_KEY] = "khoa-thu";
    let seenUrl = "";
    const reply = (body: unknown) =>
      new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      seenUrl = String(input);
      return reply({ data: [], meta: { status: 200, msg: "OK" } });
    }) as typeof fetch;

    await searchGifs("x".repeat(400));
    const sentQuery = new URL(seenUrl).searchParams.get("q") ?? "";
    assert(
      sentQuery.length === 50,
      `câu tìm phải bị cắt còn 50 ký tự trước khi gửi (trần của GIPHY), đang gửi ${sentQuery.length}`,
    );

    await searchGifs("");
    assert(seenUrl.includes("/trending"), "câu rỗng phải hỏi bảng thịnh hành, không phải /search");
    assert(!new URL(seenUrl).searchParams.has("q"), "hỏi thịnh hành thì không được kèm q rỗng");
    assert(new URL(seenUrl).searchParams.get("rating") === "g", "phải luôn xin mức nội dung sạch nhất");

    globalThis.fetch = (async () =>
      reply({ data: [], meta: { status: 403, msg: "Invalid authentication credentials" } })) as typeof fetch;

    let metaError: unknown = null;
    await searchGifs("mèo").catch((err) => (metaError = err));
    assert(metaError instanceof Error, "HTTP 200 mà meta.status=403 vẫn PHẢI là lỗi, không phải 'không có kết quả'");
    assert(String((metaError as Error).message).includes("403"), "lời báo lỗi phải mang mã GIPHY trả về");
    console.log("✔ Cách gọi: câu dài bị cắt còn 50, câu rỗng hỏi thịnh hành, lỗi giấu trong meta bị bắt.");
  } finally {
    globalThis.fetch = realFetch;
  }

  // ---- Hỏi GIPHY thật ---------------------------------------------------------------
  if (!hasRealKey) {
    console.log("");
    console.log(`⚠ BỎ QUA lượt hỏi thật: chưa có ${ENV_KEY}. Những gì trên đây KHÔNG chứng minh`);
    console.log("  rằng GIPHY chấp nhận khoá hay trả về đúng hình dạng ta đang chờ.");
  } else {
    process.env[ENV_KEY] = realKey!;

    const trending = await searchGifs("");
    assert(trending.length > 0, "bảng thịnh hành phải có ít nhất một GIF");
    assert(trending.every((g) => g.url.startsWith("https://")), "mọi URL trả về phải là https");
    assert(trending.every((g) => g.name.length >= 1 && g.name.length <= 200), "mọi tên phải vừa trần schema");
    assert(trending.every((g) => Number.isInteger(g.size) && g.size >= 0), "mọi size phải là số nguyên không âm");
    assert(trending.every((g) => !g.url.endsWith(".mp4")), "không được lọt rendition MP4 nào vào đường gửi");

    const found = await searchGifs("cat");
    assert(found.length > 0, "tìm 'cat' phải ra kết quả");

    // Câu dài hơn trần 50 ký tự của GIPHY phải bị cắt ở service, không để API trả lỗi.
    const longQuery = await searchGifs("mèo ".repeat(40));
    assert(Array.isArray(longQuery), "câu tìm quá dài phải được cắt chứ không làm ném");

    // Ảnh xem trước phải TẢI ĐƯỢC thật — một URL đúng cú pháp mà 404 thì lưới vẫn trống trơn.
    const head = await fetch(trending[0].previewUrl, { method: "HEAD" });
    assert(head.ok, `ảnh xem trước phải tải được, đang là HTTP ${head.status}`);

    console.log(`✔ Hỏi GIPHY thật: thịnh hành ${trending.length} GIF, tìm 'cat' ${found.length} GIF, câu dài bị cắt, ảnh xem trước tải được.`);
  }

  console.log("");
  console.log(hasRealKey ? "TẤT CẢ XANH — gồm cả lượt hỏi GIPHY thật." : "XANH phần không cần mạng.");
} finally {
  if (realKey === undefined) delete process.env[ENV_KEY];
  else process.env[ENV_KEY] = realKey;
}
