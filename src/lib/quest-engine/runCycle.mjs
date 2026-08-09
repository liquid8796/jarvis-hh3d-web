/**
 * Một lượt trọn vẹn: mở trình duyệt, nạp cookie, đi hết các nhiệm vụ đang bật, rồi dọn.
 *
 * Trình duyệt được TIÊM VÀO chứ không import ở đây. Nhờ vậy `src/lib/quest-engine` không hề
 * phụ thuộc Playwright: worker máy nhà và worker trong VM mỗi bên tự nạp bản Chromium của
 * mình rồi đưa vào, còn bundle của Next — vốn chỉ đọc mấy tệp này để gửi sang VM — không
 * bao giờ kéo theo một thư viện trình duyệt nặng nề mà nó không dùng.
 */

import { readinessProbe, vipProbe } from "./boardScripts.mjs";
import { closeBrowserWithin } from "./browserShutdown.mjs";
import { computeNextDelaySeconds } from "./cooldown.mjs";
import { DEFAULT_GAME_BASE_URL, parseCookieString } from "./cookies.mjs";
import { createQuestEngine, enabledQuestsInOrder, questsForAccount, QuestAborted } from "./engine.mjs";
import { profileForConfig } from "./profile.mjs";
import { acquireQuestSlot, isDedicatedPageQuest } from "./questGate.mjs";
import { createReferenceQuiz, DEFAULT_QUIZ_REFERENCE_URL } from "./quizReference.mjs";
import { createSession } from "./session.mjs";

// Base URL + parser cookie sống ở module LÁ cookies.mjs (không import gì, không đụng đĩa)
// để server action của Next dùng được mà không kéo cả engine — và cả profile.json — vào
// bundle. Re-export để mọi nơi đang import từ đây vẫn nguyên, và để gói khôi lỗi chỉ cần
// biết một cửa.
export { DEFAULT_GAME_BASE_URL, parseCookieString } from "./cookies.mjs";

/**
 * UA của một Chrome desktop thật — thế chỗ UA mặc định của headless, vốn tự xưng
 * "HeadlessChrome/…". Site nằm sau Cloudflare, và chuỗi ấy là lời tự thú.
 *
 * Ghim "151" cho khớp bản Chromium mà playwright-core 1.62 tải về: Cloudflare đối chiếu
 * được UA header với client hints (Sec-CH-UA) do chính browser tự khai, nên một UA nói
 * "Chrome 131" trên một engine 151 là một mâu thuẫn dâng tận miệng. Chrome thật từ lâu chỉ
 * khai major version (x.0.0.0), nên dạng này không lệch gì với đời thật.
 */
const DESKTOP_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36";

/**
 * Cấu hình mở trình duyệt — port TRUNG THỰC từ PlaywrightBrowserSession.cs của bản desktop.
 *
 * Bản web trước đây mở `chromium.launch({ headless: true })` trần trụi: UA "HeadlessChrome",
 * cờ automation bật nguyên, không timezone. Không phải thủ phạm của vụ #lobby-overview
 * (thủ phạm là cookie parse ra rỗng), nhưng là món nợ trước sau gì cũng phải trả — và
 * desktop đã trả từ đầu.
 */
function launchProfile(headless) {
  return {
    headless,
    userAgent: DESKTOP_USER_AGENT,
    locale: "vi-VN",
    timezoneId: "Asia/Ho_Chi_Minh",
    viewport: { width: 1366, height: 768 },
    // Tắt cờ `navigator.webdriver` và banner "being controlled by automated software" —
    // hai dấu automation mà desktop cũng đã tắt từ đầu.
    args: ["--disable-blink-features=AutomationControlled"],
    ignoreDefaultArgs: ["--enable-automation"],
  };
}

/** Outcome của engine → câu người đọc, và mức độ để hiện trên Hoạt động. */
const OUTCOME_TEXT = {
  completed: { level: "success", say: (r) => r.message?.trim() || "xong" },
  onCooldown: {
    level: "info",
    say: (r) => `đang chờ${r.cooldownSeconds ? ` — còn ${formatDuration(r.cooldownSeconds)}` : ""}${r.message ? ` (${r.message})` : ""}`,
  },
  alreadyDone: { level: "info", say: (r) => r.message?.trim() || "hôm nay xong rồi" },
  notAvailable: { level: "warn", say: (r) => r.message?.trim() || "không tìm thấy chỗ để bấm" },
  skipped: { level: "info", say: (r) => r.message?.trim() || "bỏ qua" },
  failed: { level: "error", say: (r) => r.message?.trim() || "trắc trở không rõ" },
};

function formatDuration(seconds) {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

/**
 * Bao nhiêu tab nhiệm vụ được mở CÙNG LÚC trong một vòng.
 *
 * Vì sao phải có trần, đo được trên khôi lỗi tông môn ngày 05/08: bản đầu của nhịp song song
 * mở MỘT TAB CHO MỖI nhiệm vụ, không giới hạn. Tài khoản thường bật 8 nhiệm vụ, và tám
 * nhiệm vụ ấy là tám TRANG KHÁC NHAU cùng dựng một lúc trên VM 2 nhân — kết quả là 18 dòng
 * lỗi "selector không xuất hiện" rải ngẫu nhiên khắp các nhiệm vụ (Luyện Đan 7 lần, Tế Lễ 4,
 * Vấn Đáp 3, Vòng Quay 3, và một lần trượt cả `.nv-quest` của chính hub). Cùng lúc đó tài
 * khoản VIP chạy 10 nhiệm vụ mà KHÔNG lỗi lần nào — vì 7 trong số đó bấm nút ngay trên hub,
 * tức bảy tab cùng mở một trang đã nằm sẵn trong cache, gần như miễn phí. Không phải hạng
 * tài khoản, không phải trang nào hỏng: chỉ là số trang nặng dựng đồng thời.
 *
 * Ba là con số rút từ chính bằng chứng ấy: VIP sống khoẻ với ~4 trang khác nhau một lúc.
 * Vẫn giữ gần trọn cái lợi của song song — vòng dài bằng đợt chậm nhất chứ không phải tổng
 * cộng dồn. `WORKER_QUEST_TABS` để người vận hành máy khoẻ hơn tự nới; kẹp 1–8 để một dấu
 * phẩy gõ nhầm không mở lại đúng cái bẫy vừa bịt.
 */
const DEFAULT_QUEST_TABS = 3;

function questTabLimit() {
  const raw = Number(process.env.WORKER_QUEST_TABS ?? DEFAULT_QUEST_TABS);
  const wanted = Number.isFinite(raw) ? Math.round(raw) : DEFAULT_QUEST_TABS;
  return Math.max(1, Math.min(8, wanted));
}

/**
 * Chạy `worker` trên từng phần tử, tối đa `limit` cái một lúc, và trả kết quả THEO ĐÚNG THỨ
 * TỰ ĐẦU VÀO — phần tường thuật của một vòng phải đọc như bản tuần tự, dù việc chạy xen kẽ.
 *
 * `cursor++` an toàn không cần khoá: JavaScript chạy một luồng, và giữa lúc đọc và lúc tăng
 * không có `await` nào chen vào được.
 */
export async function mapWithLimit(items, limit, worker) {
  const results = new Array(items.length);
  const lanes = Math.max(1, Math.min(Math.round(limit) || 1, items.length));
  let cursor = 0;

  await Promise.all(
    Array.from({ length: lanes }, async () => {
      for (;;) {
        const index = cursor++;
        if (index >= items.length) return;
        results[index] = await worker(items[index], index);
      }
    }),
  );

  return results;
}

/** Mọi kết quả không-phải-stop đều mang theo lịch vòng kế để server tái xếp đúng nhịp. */
function scheduledCycleResult(outcome, message, results = []) {
  return {
    outcome,
    message,
    nextDelaySeconds: computeNextDelaySeconds(results, { cycleFailed: outcome === "failed" }),
  };
}

/**
 * Cổng sẵn sàng — port của EnsureReadyAsync bên desktop, và là lớp còn thiếu thứ hai.
 *
 * Không có nó, lượt chạy lao thẳng vào quest trên một trang có thể đang là màn Cloudflare
 * hoặc màn đăng nhập, rồi chết ở selector đầu tiên với một thông điệp chẳng nói gì về
 * nguyên nhân. Ở đây: đứng trước cổng, chờ màn kiểm tra tự qua (có hạn), rồi phán rõ —
 * bị chặn là nói bị chặn, hết phiên là nói hết phiên.
 *
 * Trả `{ ok, loginConfirmed }`. `loginConfirmed` là lời thú nhận có chủ ý: cổng này CHỈ đọc
 * được trang chủ, mà trang chủ có thể im lặng về cả hai phía. Nó nói ra mình biết chắc tới
 * đâu thay vì làm tròn thành「xong」, và người gọi — vốn ghé hub ngay sau đó — mới là chỗ có
 * bằng chứng dứt điểm. Đêm 07/08 mất bốn phút mỗi vòng chỉ vì chỗ này từng làm tròn.
 */
async function ensureReady(session, baseUrl, say, log, { context, cookieJar }) {
  /**
   * Tên miền mà lượt điều hướng THẬT SỰ dừng chân, nếu nó khác nơi ta gõ cửa. Site đổi TLD
   * định kỳ (mx → am → …) và tên miền cũ 301 sang tên miền mới; cookie thì gắn chặt vào
   * tên miền, nên chúng KHÔNG đi theo cú nhảy ấy và trang mới nhìn khôi lỗi như khách lạ.
   * Bắt được sự thật này ở đây biến một đêm truy vết thành một dòng nhật ký.
   */
  let movedTo = null;

  /** Vào trang chủ rồi đọc trạng thái, chờ màn Cloudflare tự qua nếu có. */
  async function probeOnce() {
    // Dọn trước mỗi lượt: hàm này chạy tới HAI lần (lượt sau là sau khi tiêm lại cookie),
    // và `movedTo` phải kể về lượt điều hướng CUỐI chứ không giữ lại kết luận của lượt đầu.
    movedTo = null;

    const nav = await session.navigate(baseUrl);
    if (!nav.ok) return { navError: nav.error };

    if (nav.url) {
      try {
        const landed = new URL(nav.url).origin;
        if (landed !== new URL(baseUrl).origin) movedTo = landed;
      } catch {
        // URL không phân tích được thì thôi — đây là phép chẩn đoán thêm, không phải cổng.
      }
    }

    const deadline = Date.now() + 45_000;
    let probe = null;
    let saidChallenge = false;

    while (Date.now() < deadline) {
      probe = await session.evaluate(readinessProbe);
      if (probe == null) {
        await new Promise((r) => setTimeout(r, 1_500));
        continue;
      }

      if (!probe.challenge) break;

      if (!saidChallenge) {
        // Nói MỘT lần rồi chờ trong im lặng — màn kiểm tra dạng managed đôi khi tự qua
        // sau vài giây, nhưng mỗi nhịp poll mà một dòng nhật ký thì thành rác.
        await say("Trang game đang dựng màn kiểm tra (Cloudflare) — khôi lỗi đứng chờ trước cổng…", "warn");
        saidChallenge = true;
      }
      await new Promise((r) => setTimeout(r, 2_000));
    }
    return { probe };
  }

  let { probe, navError } = await probeOnce();
  if (navError) {
    return { ok: false, message: `Không mở được trang game (${navError}).` };
  }

  /**
   * Hồ sơ bền không đăng nhập được thì TIÊM LẠI cookie người dùng đã dán, rồi thử lần nữa.
   *
   * Đây là chỗ vụ 02/08 nổ ra. Hồ sơ bền giữ cookie phiên do site tự làm mới, nên lúc mở
   * ta cố ý KHÔNG đè chuỗi dán-tay lên trên — đè là tự tay đăng xuất một phiên đang lành.
   * Nhưng phép kiểm ấy chỉ hỏi "có cookie đăng nhập không", không hỏi "nó còn sống không".
   * Một cookie đã chết vẫn thoả mãn câu hỏi đó, nên khôi lỗi ôm cái xác đi tiếp, và trang lò
   * render ở dạng chưa đăng nhập — `#ld-app` không bao giờ hiện. Lỗi nổi lên ở tên một
   * selector vô tội, mười bước sau nguyên nhân thật.
   *
   * Cách chữa đúng là ĐỪNG TIN, HÃY THỬ: dùng hồ sơ khi nó còn chạy, quay về chuỗi người
   * dùng dán khi nó chết. Không cần đoán, vì trang vừa trả lời rồi.
   */
  if (context && cookieJar?.length && probe && !probe.challenge && probe.loggedIn !== true) {
    log.debug("Sẵn sàng", "Hồ sơ không đăng nhập được — tiêm lại cookie đã lưu rồi thử lần nữa.");
    await context.clearCookies().catch(() => {});
    await context.addCookies(cookieJar);
    ({ probe, navError } = await probeOnce());
    if (navError) {
      return { ok: false, message: `Không mở được trang game (${navError}).` };
    }
  }

  if (probe == null) {
    return { ok: false, message: "Không đọc được trạng thái trang game sau khi tải." };
  }

  if (probe.challenge) {
    return {
      ok: false,
      message:
        "Màn kiểm tra (Cloudflare) của trang game không tự qua — lượt này đành dừng, lượt sau sẽ thử lại.",
    };
  }

  if (probe.loggedIn === false) {
    return {
      ok: false,
      message:
        "Tài khoản hoathinh3d đã hết phiên đăng nhập — dán chuỗi cookie mới ở Ngọc Giản Cấu Hình rồi khai đàn lại.",
    };
  }

  if (probe.loggedIn !== true) {
    // KHÔNG nói gì ở đây, và tuyệt đối không nói「phiên đăng nhập còn hiệu lực」— đó chính là
    // lỗi đêm 07/08: `loggedIn == null` nghĩa là trang không phát tín hiệu nào về PHÍA NÀO
    // (không dấu đã-đăng-nhập, cũng không form đăng nhập), thế mà cổng vẫn phát ra một dòng
    // xanh khẳng định điều nó chưa hề chứng minh, rồi thả cả vòng chạy vào 9 nhiệm vụ. Mỗi
    // nhiệm vụ chết sau 25 giây ở một selector vô tội — bốn phút đỏ rực mỗi vòng, nửa tiếng
    // một lần, mà nhật ký không một lần nhắc tới nguyên nhân thật.
    //
    // Không cứng rắn hoá thành LỖI ở đây, vì mấy cái dấu kia chỉ là suy đoán: hôm nào site
    // đổi markup của người ĐANG đăng nhập, một phán quyết cứng sẽ chặn đứng mọi automation
    // dù tài khoản hoàn toàn lành. Thay vào đó trả sự thật「chưa xác nhận được」lên trên, để
    // chỗ có bằng chứng TỐT HƠN phân xử: ngay sau đây vòng chạy vốn đã ghé hub và poll
    // `.nv-quest` để dò hạng — bảng nhiệm vụ chỉ dựng cho thành viên đã đăng nhập, nên nó
    // trả lời được đúng câu hỏi này mà không tốn thêm một lượt tải trang nào.
    log.debug("Sẵn sàng", "Không xác nhận được trạng thái đăng nhập — để hub phân xử.");
    return { ok: true, loginConfirmed: false, movedTo };
  }

  await say("Đã vào được trang game — phiên đăng nhập còn hiệu lực.", "success");
  return { ok: true, loginConfirmed: true, movedTo };
}

/**
 * @param {object} deps
 * @param {import('playwright-core').BrowserType} deps.chromium
 * @param {object} deps.config           UserConfig đã giải mã (gameCookie là plaintext)
 * @param {(message: string, level?: string) => Promise<void>|void} deps.say
 * @param {(tier: "vip"|"free") => Promise<void>|void} [deps.reportAccountTier]
 * @param {() => boolean} deps.shouldStop  ĐỒNG BỘ — được gọi trong vòng lặp chặt
 * @param {(progress: {running: string[], done: number, total: number}) => void} [deps.reportProgress]
 *   Vòng này đang chạy nhiệm vụ nào — Hàng Đợi Công Việc hiển thị nó. ĐỒNG BỘ, cùng lý do
 *   với `shouldStop`: nó được gọi ở mỗi lần một nhiệm vụ vào/ra tay, tức trong đường chạy
 *   nóng, và không có gì ở đây đáng để chờ một request. Người gọi chỉ việc gán vào một biến;
 *   nhịp tim sẵn có sẽ mang nó đi.
 * @param {string} [deps.baseUrl]
 * @param {number} [deps.budgetMs]       hết ngân sách thì dừng TỬ TẾ giữa hai nhiệm vụ
 * @param {string} [deps.profileDir]     hồ sơ Chromium BỀN trên đĩa — xem ghi chú bên dưới
 */
export async function runCycle(deps) {
  const {
    chromium,
    config,
    say,
    reportAccountTier = async () => {},
    reportProgress = () => {},
    shouldStop = () => false,
    // Thứ tự nguồn có chủ ý: người gọi truyền thẳng (smoke) > tên miền server gửi kèm job >
    // env của máy chạy khôi lỗi > hằng số trong mã nguồn. Server đứng TRÊN env vì đó là chỗ
    // duy nhất trưởng môn sửa được mà không phải đụng vào từng máy; env vẫn giữ nguyên quyền
    // phủ quyết cục bộ cho ai muốn trỏ khôi lỗi nhà mình đi chỗ khác để thử.
    baseUrl = deps.config?.gameBaseUrl?.trim() || process.env.GAME_BASE_URL || DEFAULT_GAME_BASE_URL,
    budgetMs = 0,
    headless = true,
    profileDir = process.env.BROWSER_PROFILE_DIR || "",
  } = deps;

  if (!config?.gameCookie?.trim()) {
    return scheduledCycleResult(
      "failed",
      "Chưa có tài khoản hoathinh3d — hãy dán chuỗi cookie đăng nhập trước.",
    );
  }

  // Parse NGAY và coi số không là lỗi to — không bao giờ để browser đi tay trắng rồi chết
  // ở một selector vô tội mười bước sau (đúng kịch bản 02/08).
  const cookieJar = parseCookieString(config.gameCookie, baseUrl);
  if (cookieJar.length === 0) {
    return scheduledCycleResult(
      "failed",
      (
        "Chuỗi cookie đã lưu không đọc được — vào Ngọc Giản Cấu Hình dán lại tài khoản " +
        "hoathinh3d (dạng 'a=1; b=2' từ DevTools hoặc bản xuất JSON đều được)."
      ),
    );
  }

  const deadline = budgetMs > 0 ? Date.now() + budgetMs : Infinity;

  // Nhật ký hai tầng, y như bản desktop. Info trở lên đi lên Hoạt động cho người đọc; Debug
  // chỉ vào console của máy đang chạy. Không có tầng này thì mỗi lượt Mê Cung đổ hàng nghìn
  // dòng selector vào bảng job_events và chôn mất phần kể chuyện.
  const log = {
    info: (scope, message) => { void say(`${scope}: ${message}`); },
    warning: (scope, message) => { void say(`${scope}: ${message}`, "warn"); },
    debug: (scope, message) => { console.log(`  [debug] ${scope}: ${message}`); },
  };

  const translationNotes = [];
  const profile = profileForConfig(config, (m) => translationNotes.push(m));
  const enabled = enabledQuestsInOrder(profile);

  if (enabled.length === 0) {
    return scheduledCycleResult("done", "Không có nhiệm vụ nào được bật — sẽ kiểm tra lại ở vòng kế.");
  }

  for (const note of translationNotes) await say(note, "warn");

  // Hồ sơ BỀN trên đĩa khi có chỗ đặt nó (worker truyền vào; smoke và các lượt một-lần thì
  // không). Đây là lớp thứ ba học từ desktop: token cf_clearance mà Cloudflare cấp sau một
  // lần kiểm tra SỐNG TRONG HỒ SƠ — context ẩn danh mở mới mỗi lượt là mỗi lượt lại trình
  // diện trước Cloudflare như người lạ, còn hồ sơ bền thì một lần qua cửa là những lượt sau
  // đi thẳng. Cookie phiên được site làm mới cũng nhờ vậy mà không bị chuỗi dán-tay cũ dần.
  const fingerprint = launchProfile(headless);
  let browser = null;
  let context;
  if (profileDir) {
    context = await chromium.launchPersistentContext(profileDir, fingerprint);
  } else {
    browser = await chromium.launch({
      headless,
      args: fingerprint.args,
      ignoreDefaultArgs: fingerprint.ignoreDefaultArgs,
    });
    context = await browser.newContext({
      userAgent: fingerprint.userAgent,
      locale: fingerprint.locale,
      timezoneId: fingerprint.timezoneId,
      viewport: fingerprint.viewport,
    });
  }

  let done = 0;
  let failed = 0;
  const results = [];

  try {
    // Chỉ tiêm cookie khi hồ sơ CHƯA có phiên đăng nhập — đúng luật của desktop
    // (InjectCookiesIfNeededAsync): site tự làm mới cookie phiên trong hồ sơ bền, và đè
    // chuỗi dán-tay cũ hơn lên trên là tự tay đăng xuất một phiên đang lành lặn.
    const existing = profileDir ? await context.cookies(baseUrl) : [];
    const hasLogin = existing.some((c) => c.name.startsWith("wordpress_logged_in"));
    if (hasLogin) {
      // Chỉ là phỏng đoán ban đầu, KHÔNG phải phán quyết: có cookie đăng nhập không có
      // nghĩa là nó còn sống. `ensureReady` sẽ hỏi thẳng trang, và tự tiêm lại chuỗi đã lưu
      // nếu hồ sơ hoá ra đang ôm một cái xác.
      log.debug("Trình duyệt", "Hồ sơ đã có phiên đăng nhập — thử dùng lại trước.");
    } else {
      await context.addCookies(cookieJar);
    }

    const page = context.pages().length > 0 ? context.pages()[0] : await context.newPage();
    const session = createSession(page, {
      baseUrl,
      log: {
        info: (m) => log.info("Trình duyệt", m),
        warning: (m) => log.warning("Trình duyệt", m),
        debug: (m) => log.debug("Trình duyệt", m),
      },
    });

    // Cổng sẵn sàng TRƯỚC mọi quest: bị Cloudflare chặn hay hết phiên đăng nhập phải được
    // gọi đúng tên ở đây, không phải chết ở selector đầu tiên của một quest vô tội. Đưa cả
    // context và cookieJar vào để nó tự chữa được một hồ sơ mang cookie đã chết.
    const ready = await ensureReady(session, baseUrl, say, log, { context, cookieJar });
    if (!ready.ok) {
      return scheduledCycleResult("failed", ready.message);
    }

    // Hạng tài khoản quyết định kế hoạch, nên đọc nó TRƯỚC khi hứa hẹn gì. Ghé hub một lần —
    // trang duy nhất mang tín hiệu — và poll thay vì đọc một phát: hub render làm hai đợt,
    // probe tự trả null chừng nào chưa chứng minh được sự vắng mặt (xem vipProbe). Mọi ngả
    // thất bại giữ bằng chứng của cookie này từ vòng trước; cookie chưa từng được dò mới
    // mặc định VIP để tương thích với hồ sơ cũ.
    let isVip = config?.accountTier !== "free";
    // Hub có DỰNG NỔI bảng nhiệm vụ không — hỏi tiện thể trong đúng vòng poll dò hạng, vì
    // `vipProbe` chỉ trả boolean khi `.nv-quest` đã có mặt. Trước đây vòng lặp này hết giờ
    // trong im lặng: nó vừa bỏ ra 20 giây CHỨNG MINH hub không dựng, rồi không nói với ai.
    let hubRendered = false;
    const nav = await session.navigate(session.resolveUrl(profile.dailyQuestPath));
    if (nav.ok) {
      const probeDeadline = Date.now() + 20_000;
      while (Date.now() < probeDeadline) {
        const verdict = await session.evaluate(vipProbe);
        if (typeof verdict === "boolean") {
          hubRendered = true;
          isVip = verdict;
          await reportAccountTier(verdict ? "vip" : "free");
          break;
        }
        await new Promise((r) => setTimeout(r, 500));
      }
    } else {
      await say(
        `Không mở được hub để xem hạng tài khoản (${nav.error}) — giữ hạng ${isVip ? "VIP" : "thường"} đã biết.`,
        "warn",
      );
    }

    // Hai nhân chứng cùng câm thì DỪNG, đừng đoán. Cổng sẵn sàng không tìm thấy dấu đăng
    // nhập nào, và hub cũng không dựng nổi bảng nhiệm vụ — cộng lại nghĩa là thứ đang mở
    // không phải trang game của một thành viên đã đăng nhập. Chạy tiếp là đốt 25 giây mỗi
    // nhiệm vụ để rồi kể một câu chuyện sai về selector, đúng như đêm 07/08.
    //
    // Phải là PHÉP HỘI của hai điều kiện, không phải phép tuyển: hub không dựng mà phiên
    // vẫn xác nhận được thì đó là site trở chứng chứ không phải chuyện đăng nhập, và các
    // nhiệm vụ có trang riêng vẫn có thể chạy ngon — cắt vòng lúc ấy là phá hoại.
    if (!hubRendered && !ready.loginConfirmed) {
      return scheduledCycleResult(
        "failed",
        ready.movedTo
          ? `Site đã dời tên miền: ${baseUrl} chuyển hướng sang ${ready.movedTo}. Cookie gắn theo ` +
            "tên miền nên KHÔNG đi theo — trang mới nhìn khôi lỗi như khách lạ. Cần cập nhật tên " +
            "miền game rồi dán lại chuỗi cookie lấy từ tên miền mới ở Ngọc Giản Cấu Hình."
          : "Không xác nhận được phiên đăng nhập, và hub cũng không dựng nổi bảng nhiệm vụ — " +
            "nhiều khả năng cookie đã hết hạn hoặc site đang chắn khôi lỗi. Dán chuỗi cookie mới ở " +
            "Ngọc Giản Cấu Hình; lượt sau khôi lỗi vẫn sẽ tự thử lại.",
      );
    }

    if (!ready.loginConfirmed) {
      // Hub dựng được = thành viên đã đăng nhập, vì bảng nhiệm vụ không bao giờ hiện cho
      // khách. Giờ mới được phép nói câu này — và nó là câu THẬT.
      await say("Đã vào được trang game — phiên đăng nhập còn hiệu lực.", "success");
    } else if (!hubRendered) {
      await say(
        "Hub không dựng xong bảng nhiệm vụ trong 20 giây — phiên đăng nhập vẫn còn, nên cứ đi " +
          "tiếp; nhiệm vụ nào có trang riêng thì không phụ thuộc hub.",
        "warn",
      );
    }

    const quests = questsForAccount(profile, { isVip });
    const leftOut = enabled.length - quests.length;

    if (!isVip) {
      await say(
        leftOut > 0
          ? `Tài khoản thường — để yên ${leftOut} flow VIP; dùng các flow riêng ở tab cùng tên.`
          : "Tài khoản thường.",
      );
    }

    if (quests.length === 0) {
      return scheduledCycleResult(
        "done",
        "Không có nhiệm vụ nào được bật cho hạng tài khoản này — vòng này chưa có gì để chạy.",
      );
    }

    await say(`Sẽ hành sự: ${quests.map((q) => q.name).join(" · ")}.`);

    // Tiến độ vòng này, cho Hàng Đợi Công Việc. `runningNow` là SỐ NHIỀU vì nhánh song song
    // có thể cầm tới ba nhiệm vụ cùng lúc — báo cáo một cái là nói dối về hai cái kia.
    //
    // `finished` đếm nhiệm vụ đã RỜI TAY, thuận hay trắc trở đều tính: câu hỏi trên màn hình
    // là "còn bao nhiêu nữa", không phải "bao nhiêu cái thành công" (dòng kết quả cuối vòng
    // mới là chỗ trả lời câu đó). Nó phải là biến riêng chứ không tái dùng `done`/`failed`:
    // hai biến ấy chỉ được cộng SAU khi cả nhóm song song đã xong, nên chúng đứng im suốt
    // quãng người dùng thật sự cần nhìn.
    // Khoá theo ID chứ không theo TÊN, dù thứ hiện ra màn hình là tên: tên nhiệm vụ không
    // hứa hẹn là duy nhất — cặp twin VIP/thường trong hồ sơ CỐ Ý trùng tên nhau. Hôm nay
    // `questsForAccount` lọc theo hạng nên mỗi vòng chỉ còn một bản, nhưng một Set khoá theo
    // tên đặt cược cả tính đúng đắn vào phép lọc ấy: ngày nào hai nhiệm vụ cùng tên cùng
    // hạng gặp nhau, cái xong trước sẽ xoá tên của cái đang chạy. ID là khoá chính của hồ sơ.
    const runningNow = new Map();
    let finished = 0;
    const publishProgress = () =>
      reportProgress({ running: [...runningNow.values()], done: finished, total: quests.length });

    // Phát ngay một lần: từ đây tới lúc nhiệm vụ đầu tiên vào tay còn cả quãng mở tab và
    // dựng trang, và trong quãng đó hàng đợi nên nói "0/8" thay vì không nói gì.
    publishProgress();

    const quiz = createReferenceQuiz({
      url: process.env.QUIZ_DIRECTORY_URL?.trim() || DEFAULT_QUIZ_REFERENCE_URL,
      log,
    });

    // Hai nhịp hành sự. SONG SONG (mặc định): mỗi nhiệm vụ một tab riêng trong CÙNG phiên
    // đăng nhập — vòng dài bằng nhiệm vụ chậm nhất thay vì tổng cộng dồn, đáng giá nhất khi
    // Mê Cung (~35 phút) đứng chung hàng với các nhiệm vụ một phút. TUẦN TỰ (tắt trong Ngọc
    // Giản): đúng nhịp bản desktop, cho ngày site trở chứng với nhiều tab. Lượt có ngân sách
    // lát (budgetMs) luôn đi tuần tự: "hết giờ thì dừng giữa danh sách" chỉ có nghĩa khi
    // danh sách được đi từng bước một.
    const runParallel = config?.parallelQuests !== false && quests.length > 1 && deadline === Infinity;

    if (runParallel) {
      const tabs = Math.min(questTabLimit(), quests.length);
      await say(`Chạy song song ${quests.length} nhiệm vụ — tối đa ${tabs} tab cùng lúc.`);

      // Kế hoạch CHẠY xếp nhiệm vụ trang riêng ra cuối (phần tường thuật vẫn theo thứ tự
      // hồ sơ — xem chỗ đọc `settled`). Lý do: trang riêng có thể phải xếp hàng ở cổng toàn
      // cục sau trang riêng của một đàn khác, và một lane của pool bị waiter chiếm là một
      // lane không chạy được nhiệm vụ hub nào — tệ nhất là cả ba lane cùng đứng xếp hàng
      // trong khi đống nhiệm vụ hub phía sau hoàn toàn có thể chạy ngay.
      const executionPlan = [
        ...quests.filter((quest) => !isDedicatedPageQuest(profile, quest)),
        ...quests.filter((quest) => isDedicatedPageQuest(profile, quest)),
      ];

      let sawAbort = false;
      const settledByPlan = await mapWithLimit(executionPlan, tabs, async (quest) => {
        // Thu đàn giữa chừng: nhiệm vụ còn nằm trong hàng đợi của pool thấy cờ này và rút
        // lui ngay, không mở thêm tab nào nữa.
        if (shouldStop()) return { quest, aborted: true };

        // Cổng toàn cục TRƯỚC mọi thứ, kể cả trước lúc mở tab: dựng trang đã là tiêu CPU,
        // và luật nhường đường tính từ byte đầu tiên chứ không từ cú click đầu tiên.
        const slot = await acquireQuestSlot({
          dedicated: isDedicatedPageQuest(profile, quest),
          name: quest.name,
          shouldStop,
          onWait: ({ holder }) =>
            log.debug(
              `Quest:${quest.name}`,
              holder
                ? `nhường tài nguyên cho「${holder}」đang giữ trang riêng — xếp hàng chờ lượt.`
                : "xếp hàng ở cổng điều phối — một nhiệm vụ trang riêng đang đợi phía trước.",
            ),
        });
        if (slot.aborted) return { quest, aborted: true };

        // Vào tay từ ĐÂY, trước cả lúc mở tab: dựng trang là phần chậm nhất của một nhiệm
        // vụ ngắn, và một nhiệm vụ đang dựng trang vẫn là một nhiệm vụ đang được làm.
        let aborted = false;
        runningNow.set(quest.id, quest.name);
        publishProgress();

        try {
          let questPage;
          try {
            questPage = await context.newPage();
          } catch (err) {
            return { quest, outcome: { outcome: "failed", message: `không mở được tab riêng (${err.message})` } };
          }

          // Session log mang tên nhiệm vụ: mấy tab cùng kể "Trình duyệt: …" thì không ai
          // biết dòng nào của ai.
          const questSession = createSession(questPage, {
            baseUrl,
            log: {
              info: (m) => log.info(`Trình duyệt·${quest.name}`, m),
              warning: (m) => log.warning(`Trình duyệt·${quest.name}`, m),
              debug: (m) => log.debug(`Trình duyệt·${quest.name}`, m),
            },
          });
          const questEngine = createQuestEngine({ log, shouldStop, quiz });

          try {
            return { quest, outcome: await questEngine.run(questSession, profile, quest) };
          } catch (err) {
            if (err instanceof QuestAborted) {
              aborted = true;
              return { quest, aborted: true };
            }
            return { quest, outcome: { outcome: "failed", message: `trắc trở bất ngờ: ${err.message}` } };
          } finally {
            // Đóng tab NGAY khi nhiệm vụ xong — đó là điều khiến cái trần tab có nghĩa: chỗ
            // vừa trống được nhường cho nhiệm vụ kế trong hàng đợi.
            await questPage.close().catch(() => {});
          }
        } finally {
          // Trả slot cổng toàn cục TRƯỚC hết — đàn khác đang xếp hàng sau slot này.
          slot.release();
          // Rời tay dù đi bằng ngả nào — kể cả ngả "không mở được tab riêng" ở trên, vốn
          // return thẳng và sẽ để tên nhiệm vụ mắc kẹt trong `runningNow` tới hết vòng.
          // Bị Thu Đàn thì KHÔNG tính là đã làm xong: nó chưa từng chạy tới nơi.
          runningNow.delete(quest.id);
          if (!aborted) finished++;
          publishProgress();
        }
      });

      // mapWithLimit trả theo thứ tự executionPlan; tường thuật thì theo thứ tự HỒ SƠ như
      // mọi khi — người đọc không cần biết kế hoạch chạy đã xếp trang riêng ra cuối.
      const byQuestId = new Map(settledByPlan.map((entry) => [entry.quest.id, entry]));
      const settled = quests.map((quest) => byQuestId.get(quest.id));

      for (const entry of settled) {
        if (entry.aborted) {
          sawAbort = true;
          continue;
        }
        results.push(entry.outcome);
        const shape = OUTCOME_TEXT[entry.outcome.outcome] ?? OUTCOME_TEXT.skipped;
        await say(`${entry.quest.name}: ${shape.say(entry.outcome)}`, shape.level);
        if (entry.outcome.outcome === "failed") failed++;
        else done++;
      }

      if (sawAbort || shouldStop()) {
        return { outcome: "stopped", message: `Đã thu đàn giữa chừng — xong ${done}/${quests.length}.` };
      }
    } else {
      const engine = createQuestEngine({ log, shouldStop, quiz });

      for (const quest of quests) {
        if (shouldStop()) {
          return { outcome: "stopped", message: `Đã thu đàn giữa chừng — xong ${done}/${quests.length}.` };
        }

        if (Date.now() >= deadline) {
          return scheduledCycleResult(
            "done",
            `Hết ngân sách của lát này — xong ${done}/${quests.length}, phần còn lại để vòng sau.`,
            results,
          );
        }

        // Tuần tự trong đàn NÀY không có nghĩa là một mình trên máy: các đàn khác của cùng
        // khôi lỗi vẫn chạy cạnh bên, nên nhánh này cũng phải qua cổng toàn cục như ai.
        const slot = await acquireQuestSlot({
          dedicated: isDedicatedPageQuest(profile, quest),
          name: quest.name,
          shouldStop,
          onWait: ({ holder }) =>
            log.debug(
              `Quest:${quest.name}`,
              holder
                ? `nhường tài nguyên cho「${holder}」đang giữ trang riêng — xếp hàng chờ lượt.`
                : "xếp hàng ở cổng điều phối — một nhiệm vụ trang riêng đang đợi phía trước.",
            ),
        });
        if (slot.aborted) {
          return { outcome: "stopped", message: `Đã thu đàn giữa chừng — xong ${done}/${quests.length}.` };
        }

        runningNow.set(quest.id, quest.name);
        publishProgress();

        let outcome;
        try {
          outcome = await engine.run(session, profile, quest);
        } catch (err) {
          if (err instanceof QuestAborted) {
            return { outcome: "stopped", message: `Đã thu đàn giữa chừng — xong ${done}/${quests.length}.` };
          }
          throw err;
        } finally {
          slot.release();
          // Rời tay ở mọi ngả. Hai ngả bất thường (Thu Đàn, lỗi ném ra) đều kết thúc cả vòng
          // ngay sau đây, nên `finished` chỉ cộng trên đường đi bình thường bên dưới.
          runningNow.delete(quest.id);
        }

        finished++;
        publishProgress();

        results.push(outcome);

        const shape = OUTCOME_TEXT[outcome.outcome] ?? OUTCOME_TEXT.skipped;
        await say(`${quest.name}: ${shape.say(outcome)}`, shape.level);

        if (outcome.outcome === "failed") failed++;
        else done++;
      }
    }

    return failed > 0
      ? scheduledCycleResult("done", `Đi hết một vòng — ${done} thuận, ${failed} trắc trở.`, results)
      : scheduledCycleResult("done", `Đi hết một vòng — ${done} nhiệm vụ thuận lợi.`, results);
  } finally {
    // Đóng trong finally, có HẠN GIỜ, và không bao giờ ném: một trình duyệt không đóng được
    // không được phép ghi đè lên kết quả thật của lượt chạy — mà cũng không được phép treo
    // luôn cả cái ghế của worker. Xem browserShutdown.mjs cho lý do đầy đủ.
    await closeBrowserWithin({ context, browser, profileDir, log });
  }
}
