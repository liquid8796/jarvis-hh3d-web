#!/usr/bin/env node
/**
 * Kiểm chứng NỬA GỬI của bảng usage (`scripts/usagePush.mts`).
 *
 *   npm run verify:usage-push
 *
 * KHÔNG chạm mạng ngoài, KHÔNG cần credential: dựng vài trạm giả bằng `node:http` ngay trong
 * tiến trình rồi bắt chúng cư xử đúng như tầng gương trạm thật — trạm nghỉ 307 sang trạm sống.
 *
 * VÌ SAO PHẢI CÓ TỆP NÀY. Ngày 12/08/2026 lượt Actions đầu tiên đẩy hỏng cả hai trạm với
 * `HTTP 401 — unauthorized`, trong khi bí mật hoàn toàn đúng: `WEB_URL` trỏ vào một trạm ĐÃ
 * NGHỈ, nó 307 sang trạm sống, và `fetch` của Node đi theo nhưng **vứt header `Authorization`
 * vì chuyển hướng đổi origin**. Một lỗi chỉ hiện ra sau một lượt chuyển trạm — tức vài tuần
 * một lần, và lần nào cũng nói dối về nguyên nhân. Phép thử số 3 dưới đây đóng đinh chính cái
 * bẫy nền tảng ấy, để nó không bao giờ còn là một phát hiện bất ngờ nữa.
 */
import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { type Meter, looksLikeStationHop, MAX_STATION_HOPS, pushUsageReport, REPORT_PATH } from "./usagePush.mts";
import { daysUntilExpiry, parseUsageStations, readCookieFile } from "./usageStations.mts";

const results: string[] = [];
const check = (name: string, ok: boolean, detail = "") => {
  results.push(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const METERS: Meter[] = [
  { title: "Fluid Active CPU", used: "1h 12m", limit: "4h" },
  { title: "Edge Requests", used: "303K", limit: "1M" },
];
const SECRET = "bi-mat-chi-de-thu";

type Hit = { auth: string | null; method: string; path: string; body: string };

/** Một trạm giả: ghi lại mọi cú gõ cửa, trả lời theo `reply`. */
type Station = { url: string; hits: Hit[]; close: () => Promise<void> };

async function station(
  reply: (req: IncomingMessage, res: ServerResponse, hits: Hit[]) => void,
): Promise<Station> {
  const hits: Hit[] = [];
  const server: Server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      hits.push({
        auth: req.headers.authorization ?? null,
        method: req.method ?? "?",
        path: req.url ?? "?",
        body,
      });
      reply(req, res, hits);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address == null || typeof address === "string") throw new Error("không mở được trạm giả");
  return {
    url: `http://127.0.0.1:${address.port}`,
    hits,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

const okJson = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};

const open: Station[] = [];
const track = async (pending: Promise<Station>): Promise<Station> => {
  const opened = await pending;
  open.push(opened);
  return opened;
};

try {
  // ---- 1. Đường thẳng: trạm sống nhận đủ chìa và đủ thân -------------------------------
  {
    const live = await track(station((_req, res) => okJson(res, 200, { ok: true, meters: 2 })));
    const sent = await pushUsageReport({
      origin: live.url,
      secret: SECRET,
      siteId: "auto-hh3d-1",
      readAt: "2026-08-12T04:00:00.000Z",
      meters: METERS,
    });

    check("đẩy thẳng lên trạm sống → thuận", sent.ok && sent.status === 200, `${sent.status} ${sent.detail}`);
    check("chỉ gõ đúng một cửa", sent.hops.length === 1, sent.hops.join(" → "));
    check("cửa nhận đúng đường", live.hits[0]?.path === REPORT_PATH, live.hits[0]?.path);
    check("cửa nhận được chìa", live.hits[0]?.auth === `Bearer ${SECRET}`, String(live.hits[0]?.auth));
    const parsed = JSON.parse(live.hits[0]?.body ?? "{}") as { siteId?: string; meters?: Meter[] };
    check(
      "thân giữ nguyên mã trạm và đủ meter",
      parsed.siteId === "auto-hh3d-1" && parsed.meters?.length === 2,
      `${parsed.siteId} / ${parsed.meters?.length}`,
    );
  }

  // ---- 2. LỖI GỐC: trạm nghỉ 307 sang trạm sống, chìa phải sang theo --------------------
  {
    const live = await track(station((_req, res) => okJson(res, 200, { ok: true })));
    const retired = await track(
      station((req, res) => {
        res.writeHead(307, { location: `${live.url}${req.url}` });
        res.end();
      }),
    );

    const sent = await pushUsageReport({
      origin: retired.url,
      secret: SECRET,
      siteId: "auto-hh3d-1",
      readAt: "2026-08-12T04:00:00.000Z",
      meters: METERS,
    });

    check("qua trạm nghỉ vẫn tới nơi", sent.ok && sent.status === 200, `${sent.status} ${sent.detail}`);
    check("kể lại đủ hai chặng đã đi", sent.hops.length === 2, sent.hops.join(" → "));
    check(
      "TRẠM SỐNG NHẬN ĐƯỢC CHÌA sau chuyển hướng",
      live.hits[0]?.auth === `Bearer ${SECRET}`,
      String(live.hits[0]?.auth),
    );
    check(
      "chặng hai vẫn là POST và vẫn đủ thân",
      live.hits[0]?.method === "POST" && (JSON.parse(live.hits[0]?.body ?? "{}") as { meters?: Meter[] }).meters?.length === 2,
      `${live.hits[0]?.method} ${live.hits[0]?.body.length}B`,
    );
  }

  // ---- 3. Cái bẫy nền tảng — lý do tồn tại của cả module -------------------------------
  {
    const live = await track(station((_req, res) => okJson(res, 200, { ok: true })));
    const retired = await track(
      station((req, res) => {
        res.writeHead(307, { location: `${live.url}${req.url}` });
        res.end();
      }),
    );

    // `fetch` mặc định (redirect: "follow") — đúng thứ bản đầu đã dùng.
    await fetch(`${retired.url}${REPORT_PATH}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${SECRET}`, "Content-Type": "application/json" },
      body: JSON.stringify({ siteId: "auto-hh3d-1", meters: METERS }),
    });

    check(
      `fetch mặc định VẪN vứt chìa khi chuyển hướng đổi origin (node ${process.version})`,
      live.hits[0]?.auth == null,
      live.hits[0]?.auth == null
        ? "đúng như đo ngày 12/08/2026"
        : `node đã đổi nết: nay nó giữ「${live.hits[0]?.auth}」— đọc lại bình chú usagePush.mts`,
    );
    check("… mà thân và method thì vẫn nguyên (nên trạm đích trả 401 chứ không 400)", live.hits[0]?.method === "POST");
  }

  // ---- 4. Vòng lặp chuyển hướng: dừng, và nói ra mình đã đi đâu ------------------------
  {
    const loop = await track(
      station((req, res) => {
        res.writeHead(307, { location: req.url ?? REPORT_PATH });
        res.end();
      }),
    );
    const sent = await pushUsageReport({
      origin: loop.url,
      secret: SECRET,
      siteId: "auto-hh3d-1",
      readAt: "2026-08-12T04:00:00.000Z",
      meters: METERS,
    });

    check("trỏ vòng thì dừng, không quay mãi", !sent.ok, sent.detail);
    check(
      `dừng đúng sau ${MAX_STATION_HOPS} chặng`,
      loop.hits.length === MAX_STATION_HOPS + 1,
      `gõ ${loop.hits.length} lần`,
    );
    check("lời hỏng chỉ ra đường đã đi", sent.detail.includes("→"), sent.detail);
  }

  // ---- 5. Cửa từ chối: giữ nguyên lời của nó, đừng dịch lại ----------------------------
  {
    const closed = await track(station((_req, res) => okJson(res, 401, { error: "unauthorized" })));
    const sent = await pushUsageReport({
      origin: closed.url,
      secret: "chia-sai",
      siteId: "auto-hh3d-1",
      readAt: "2026-08-12T04:00:00.000Z",
      meters: METERS,
    });
    check("401 về thành hỏng, kèm nguyên văn", !sent.ok && sent.status === 401 && sent.detail.includes("unauthorized"), sent.detail);
  }

  // ---- 6. Trạm tắt lửa: hỏng có chữ, không ném ------------------------------------------
  {
    const gone = await track(station((_req, res) => okJson(res, 200, { ok: true })));
    const url = gone.url;
    await gone.close();
    const sent = await pushUsageReport({
      origin: url,
      secret: SECRET,
      siteId: "auto-hh3d-1",
      readAt: "2026-08-12T04:00:00.000Z",
      meters: METERS,
    });
    check("gọi không được → hỏng có lời giải thích, không ném", !sent.ok && sent.status === null && sent.detail.length > 0, sent.detail);
  }

  // ---- 7. Luật đi theo chuyển hướng, xét thẳng trên hàm thuần --------------------------
  {
    const from = `https://auto-hh3d.vercel.app${REPORT_PATH}`;
    const live = `https://auto-hh3d-1.vercel.app${REPORT_PATH}`;
    const hop = (status: number, location: string | null, at = from) => looksLikeStationHop(status, location, at);

    check("307 sang trạm khác thì đi", hop(307, live).ok);
    check("308 cũng đi", hop(308, live).ok);
    // 302/303 nghĩa là「GET chỗ kia」— đẩy tiếp một POST theo đó là tự dịch lại ý của server.
    const seen302 = hop(302, live);
    check("302 thì KHÔNG", !seen302.ok, seen302.ok ? "" : seen302.why);
    check("303 thì KHÔNG", !hop(303, live).ok);
    check("thiếu Location thì KHÔNG", !hop(307, null).ok);
    check("Location tương đối vẫn ghép được", hop(307, REPORT_PATH).ok);
    check("đổi sang đường khác thì KHÔNG", !hop(307, "https://auto-hh3d-1.vercel.app/thu-gom").ok);
    check("tụt https → http thì KHÔNG", !hop(307, `http://auto-hh3d-1.vercel.app${REPORT_PATH}`).ok);
    check("lược đồ lạ thì KHÔNG", !hop(307, "javascript:void 0").ok);
    check("Location rác thì KHÔNG", !hop(307, "http://[không-phải-url").ok);
    // Một Location TUYỆT ĐỐI vẫn ghép được dù chỗ đang đứng là rác, nên nhánh này phải tự
    // chặn — nếu không, phép so lược đồ bên dưới sẽ ném ra ngoài đúng cái hàm hứa không ném.
    check("chỗ đang đứng là rác thì KHÔNG, và không ném", !hop(307, live, "khong-phai-mot-url").ok);
    // Trạm dưới máy chạy http; đi tiếp trong cùng hạng http là KHÔNG tụt hạng.
    check("http → http thì vẫn đi", hop(307, `http://127.0.0.1:3001${REPORT_PATH}`, `http://127.0.0.1:3000${REPORT_PATH}`).ok);
  }
} finally {
  await Promise.all(open.map((s) => s.close()));
}

// ---- 8. Bảng trạm của workflow, và tệp cookie ------------------------------------------------
//
// `usage:cookie` ghi cookie vào secret theo bảng này. Đọc hụt một dòng nghĩa là ghi cookie của
// tài khoản A vào ô của tài khoản B — và triệu chứng KHÔNG phải「sai cookie」mà là「thiếu cột」
// sau 90 giây chờ, sáu tiếng sau, trong một lượt CI đỏ. Nên bảng phải đọc từ chính workflow, và
// phép đọc ấy phải có chỗ đóng đinh.
{
  const yml = readFileSync(new URL("../.github/workflows/vercel-usage.yml", import.meta.url), "utf8");
  const that = parseUsageStations(yml);
  check("đọc được bảng trạm từ chính workflow đang chạy", that.length > 0, `${that.length} trạm`);
  check(
    "mỗi dòng đủ ba cột và không cột nào rỗng",
    that.every((s) => s.siteId && s.team && s.secret),
    that.map((s) => `${s.siteId}→${s.secret}`).join(" · "),
  );
  // Chính chỗ khiến không thể suy tên secret bằng luật: trạm gốc KHÔNG dùng VERCEL_COOKIE_AUTO_HH3D.
  const goc = that.find((s) => s.siteId === "auto-hh3d");
  check(
    "trạm gốc dùng secret KHÁC lệ đặt tên — bằng chứng phải đọc bảng chứ không suy",
    goc?.secret === "VERCEL_COOKIE_MAIN",
    String(goc?.secret),
  );

  const dung = 'stations="a|t1|S_A\n  b|t2|S_B"';
  check("bóc đúng hai dòng", parseUsageStations(dung).length === 2);
  const nem = (yaml: string, vi: string) => {
    try {
      parseUsageStations(yaml);
      check(vi, false, "KHÔNG ném");
    } catch {
      check(vi, true);
    }
  };
  nem("khong co khoi nao", "workflow đổi hình dạng → ném, không đoán");
  nem('stations="a|t1|S_A', "thiếu nháy đóng → ném");
  nem('stations="a|t1"', "dòng thiếu cột → ném, và không lẳng lặng bỏ qua");
  nem('stations="a||S_A"', "cột rỗng → ném");
  nem('stations=""', "bảng rỗng → ném");
  nem('stations="a|t1|S_A\n  a|t2|S_B"', "mã trạm lặp → ném, vì ghi cookie sẽ vào nhầm ô");
  check(
    "dòng trống và dòng chú thích bị bỏ qua như vòng lặp trong workflow",
    parseUsageStations('stations="a|t1|S_A\n\n  # ghi chu\n  b|t2|S_B"').length === 2,
  );
}

{
  const tep = (cookies: unknown) => JSON.stringify({ cookies });
  const auth = { name: "authorization", value: "v" };
  const good = readCookieFile(tep([auth, { name: "x", value: "y" }]));
  check("tệp cookie hợp lệ → đọc được", good.ok && good.cookies.length === 2);
  check("thiếu `authorization` → từ chối", !readCookieFile(tep([{ name: "x", value: "y" }])).ok);
  check("không phải JSON → từ chối, không ném", !readCookieFile("{").ok);
  check("thiếu mảng cookies → từ chối", !readCookieFile('{"a":1}').ok);
  // Mục rác bị bỏ nhưng phải ĐẾM ra, vì im lặng vứt cookie là cách êm ái nhất để thiếu mảnh cần.
  const lan = readCookieFile(tep([auth, { name: "x" }, { value: "z" }]));
  check("mục thiếu name/value bị bỏ và ĐẾM ra", lan.ok && lan.cookies.length === 1 && lan.boQua === 2, lan.ok ? `bỏ ${lan.boQua}` : "");

  const ngay = 86_400_000;
  const moc = Date.UTC(2026, 7, 13);
  check(
    "hạn phiên quy ra ngày còn lại",
    daysUntilExpiry([{ name: "authorization", value: "v", expirationDate: (moc + 10 * ngay) / 1000 }], moc) === 10,
  );
  check(
    "hạn đã qua → số âm, để chỗ gọi chặn được",
    (daysUntilExpiry([{ name: "authorization", value: "v", expirationDate: (moc - 3 * ngay) / 1000 }], moc) ?? 0) < 0,
  );
  // Cắt về phía 0, không làm tròn xuống: `floor` kể một cookie hết hạn 3 ngày + 1 giây thành
  // 「4 ngày trước」— đo được lúc chạy thử 13/08/2026.
  check(
    "hết hạn 3 ngày 1 giây → kể là 3, không phải 4",
    daysUntilExpiry([{ name: "authorization", value: "v", expirationDate: (moc - 3 * ngay - 1000) / 1000 }], moc) === -3,
  );
  check(
    "còn 29 ngày 23 giờ → kể là 29, không làm tròn lên",
    daysUntilExpiry([{ name: "authorization", value: "v", expirationDate: (moc + 30 * ngay - 3_600_000) / 1000 }], moc) === 29,
  );
  check("cookie phiên thuần (không khai hạn) → null, không đoán", daysUntilExpiry([auth]) === null);
}

for (const line of results) console.log(`  ${line}`);
const failed = results.filter((r) => r.startsWith("✗"));
if (failed.length > 0) {
  console.error(`\n✗ ${failed.length}/${results.length} phép thử hỏng.`);
  process.exit(1);
}
console.log(`\n✔ Đẩy bảng usage: ${results.length} phép thử thuận.`);
