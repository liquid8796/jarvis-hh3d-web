/**
 * Một lượt trọn vẹn: mở trình duyệt, nạp cookie, đi hết các nhiệm vụ đang bật, rồi dọn.
 *
 * Trình duyệt được TIÊM VÀO chứ không import ở đây. Nhờ vậy `src/lib/quest-engine` không hề
 * phụ thuộc Playwright: worker máy nhà và worker trong VM mỗi bên tự nạp bản Chromium của
 * mình rồi đưa vào, còn bundle của Next — vốn chỉ đọc mấy tệp này để gửi sang VM — không
 * bao giờ kéo theo một thư viện trình duyệt nặng nề mà nó không dùng.
 */

import { readinessProbe, vipProbe } from "./boardScripts.mjs";
import { computeNextDelaySeconds } from "./cooldown.mjs";
import { DEFAULT_GAME_BASE_URL, parseCookieString } from "./cookies.mjs";
import { createQuestEngine, enabledQuestsInOrder, questsForAccount, QuestAborted } from "./engine.mjs";
import { profileForConfig } from "./profile.mjs";
import { createReferenceQuiz, DEFAULT_QUIZ_REFERENCE_URL } from "./quizReference.mjs";
import { createSession } from "./session.mjs";

// Base URL + parser cookie sống ở module LÁ cookies.mjs (không import gì, không đụng đĩa)
// để server action của Next dùng được mà không kéo cả engine — và cả profile.json — vào
// bundle. Re-export để mọi nơi đang import từ đây vẫn nguyên, và để gói linh sứ chỉ cần
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
 */
async function ensureReady(session, baseUrl, say, log, { context, cookieJar }) {
  /** Vào trang chủ rồi đọc trạng thái, chờ màn Cloudflare tự qua nếu có. */
  async function probeOnce() {
    const nav = await session.navigate(baseUrl);
    if (!nav.ok) return { navError: nav.error };

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
        await say("Trang game đang dựng màn kiểm tra (Cloudflare) — linh sứ đứng chờ trước cổng…", "warn");
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
   * Một cookie đã chết vẫn thoả mãn câu hỏi đó, nên linh sứ ôm cái xác đi tiếp, và trang lò
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

  if (probe.loggedIn == null) {
    log.debug("Sẵn sàng", "Không xác nhận được trạng thái đăng nhập — vẫn đi tiếp.");
  }

  await say("Đã vào được trang game — phiên đăng nhập còn hiệu lực.", "success");
  return { ok: true };
}

/**
 * @param {object} deps
 * @param {import('playwright-core').BrowserType} deps.chromium
 * @param {object} deps.config           UserConfig đã giải mã (gameCookie là plaintext)
 * @param {(message: string, level?: string) => Promise<void>|void} deps.say
 * @param {() => boolean} deps.shouldStop  ĐỒNG BỘ — được gọi trong vòng lặp chặt
 * @param {string} [deps.baseUrl]
 * @param {number} [deps.budgetMs]       hết ngân sách thì dừng TỬ TẾ giữa hai nhiệm vụ
 * @param {string} [deps.profileDir]     hồ sơ Chromium BỀN trên đĩa — xem ghi chú bên dưới
 */
export async function runCycle(deps) {
  const {
    chromium,
    config,
    say,
    shouldStop = () => false,
    baseUrl = process.env.GAME_BASE_URL || DEFAULT_GAME_BASE_URL,
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
    // thất bại đều đổ về VIP: đó là hạng duy nhất mà hồ sơ hiện có được viết cho, và đoán
    // nhầm "thường" nghĩa là lặng lẽ bỏ trống trọn một lượt của người ta.
    let isVip = true;
    const nav = await session.navigate(session.resolveUrl(profile.dailyQuestPath));
    if (nav.ok) {
      const probeDeadline = Date.now() + 20_000;
      while (Date.now() < probeDeadline) {
        const verdict = await session.evaluate(vipProbe);
        if (typeof verdict === "boolean") {
          isVip = verdict;
          break;
        }
        await new Promise((r) => setTimeout(r, 500));
      }
    } else {
      await say(`Không mở được hub để xem hạng tài khoản (${nav.error}) — coi như VIP.`, "warn");
    }

    const quests = questsForAccount(profile, { isVip });
    const leftOut = enabled.length - quests.length;

    if (!isVip) {
      await say(
        leftOut > 0
          ? `Tài khoản thường — để yên ${leftOut} nhiệm vụ VIP; flow nhiệm vụ thường sẽ có sau.`
          : "Tài khoản thường.",
      );
    }

    if (quests.length === 0) {
      return scheduledCycleResult(
        "done",
        "Tài khoản thường mà mọi nhiệm vụ đã bật đều là hàng VIP — vòng này chưa có gì để chạy.",
      );
    }

    await say(`Sẽ hành sự: ${quests.map((q) => q.name).join(" · ")}.`);

    const quiz = createReferenceQuiz({
      url: process.env.QUIZ_DIRECTORY_URL?.trim() || DEFAULT_QUIZ_REFERENCE_URL,
      log,
    });
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

      let outcome;
      try {
        outcome = await engine.run(session, profile, quest);
      } catch (err) {
        if (err instanceof QuestAborted) {
          return { outcome: "stopped", message: `Đã thu đàn giữa chừng — xong ${done}/${quests.length}.` };
        }
        throw err;
      }

      results.push(outcome);

      const shape = OUTCOME_TEXT[outcome.outcome] ?? OUTCOME_TEXT.skipped;
      await say(`${quest.name}: ${shape.say(outcome)}`, shape.level);

      if (outcome.outcome === "failed") failed++;
      else done++;
    }

    return failed > 0
      ? scheduledCycleResult("done", `Đi hết một vòng — ${done} thuận, ${failed} trắc trở.`, results)
      : scheduledCycleResult("done", `Đi hết một vòng — ${done} nhiệm vụ thuận lợi.`, results);
  } finally {
    // Đóng trong finally, và nuốt lỗi: một trình duyệt không đóng được không được phép ghi
    // đè lên kết quả thật của lượt chạy. Với hồ sơ bền thì context CHÍNH LÀ browser.
    await context.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
  }
}
