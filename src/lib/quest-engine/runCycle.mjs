/**
 * Một lượt trọn vẹn: mở trình duyệt, nạp cookie, đi hết các nhiệm vụ đang bật, rồi dọn.
 *
 * Trình duyệt được TIÊM VÀO chứ không import ở đây. Nhờ vậy `src/lib/quest-engine` không hề
 * phụ thuộc Playwright: worker máy nhà và worker trong VM mỗi bên tự nạp bản Chromium của
 * mình rồi đưa vào, còn bundle của Next — vốn chỉ đọc mấy tệp này để gửi sang VM — không
 * bao giờ kéo theo một thư viện trình duyệt nặng nề mà nó không dùng.
 */

import { vipProbe } from "./boardScripts.mjs";
import { createQuestEngine, enabledQuestsInOrder, questsForAccount, QuestAborted } from "./engine.mjs";
import { profileForConfig } from "./profile.mjs";
import { createSession } from "./session.mjs";

/** Tên miền game. Site đổi TLD định kỳ (…mx → …am), nên đây phải là cấu hình, không phải hằng số. */
export const DEFAULT_GAME_BASE_URL = "https://hoathinh3d.am";

/**
 * Chuỗi cookie kiểu `document.cookie` → mảng cookie của Playwright.
 *
 * Người dùng dán đúng thứ họ copy được từ DevTools ("wordpress_logged_in_…=…; wordpress_sec_…=…"),
 * nên chỗ này cố ý dễ tính: bỏ qua mảnh rỗng, chỉ tách ở dấu `=` ĐẦU TIÊN (giá trị cookie
 * của WordPress có chứa `=` bên trong), và giao domain/path cho Playwright suy ra từ `url`.
 */
export function parseCookieString(raw, url) {
  const cookies = [];
  for (const part of String(raw ?? "").split(";")) {
    const chunk = part.trim();
    if (!chunk) continue;

    const eq = chunk.indexOf("=");
    if (eq <= 0) continue;

    const name = chunk.slice(0, eq).trim();
    const value = chunk.slice(eq + 1).trim();
    if (!name) continue;

    cookies.push({ name, value, url });
  }
  return cookies;
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
 * @param {object} deps
 * @param {import('playwright-core').BrowserType} deps.chromium
 * @param {object} deps.config           UserConfig đã giải mã (gameCookie là plaintext)
 * @param {(message: string, level?: string) => Promise<void>|void} deps.say
 * @param {() => boolean} deps.shouldStop  ĐỒNG BỘ — được gọi trong vòng lặp chặt
 * @param {string} [deps.baseUrl]
 * @param {number} [deps.budgetMs]       hết ngân sách thì dừng TỬ TẾ giữa hai nhiệm vụ
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
  } = deps;

  if (!config?.gameCookie?.trim()) {
    return { outcome: "failed", message: "Chưa có pháp khí — hãy dán cookie đăng nhập trước." };
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
    return { outcome: "done", message: "Không có nhiệm vụ nào được bật — kết thúc lượt." };
  }

  for (const note of translationNotes) await say(note, "warn");

  const browser = await chromium.launch({ headless });
  let done = 0;
  let failed = 0;

  try {
    const context = await browser.newContext({
      viewport: { width: 1366, height: 900 },
      locale: "vi-VN",
    });
    await context.addCookies(parseCookieString(config.gameCookie, baseUrl));

    const page = await context.newPage();
    const session = createSession(page, {
      baseUrl,
      log: {
        info: (m) => log.info("Trình duyệt", m),
        warning: (m) => log.warning("Trình duyệt", m),
        debug: (m) => log.debug("Trình duyệt", m),
      },
    });

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
      return {
        outcome: "done",
        message: "Tài khoản thường mà mọi nhiệm vụ đã bật đều là hàng VIP — chưa có gì để chạy.",
      };
    }

    await say(`Sẽ hành sự: ${quests.map((q) => q.name).join(" · ")}.`);

    const engine = createQuestEngine({ log, shouldStop });

    for (const quest of quests) {
      if (shouldStop()) {
        return { outcome: "stopped", message: `Đã thu đàn giữa chừng — xong ${done}/${quests.length}.` };
      }

      if (Date.now() >= deadline) {
        return {
          outcome: "done",
          message: `Hết ngân sách của lát này — xong ${done}/${quests.length}, phần còn lại để lượt sau.`,
        };
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

      const shape = OUTCOME_TEXT[outcome.outcome] ?? OUTCOME_TEXT.skipped;
      await say(`${quest.name}: ${shape.say(outcome)}`, shape.level);

      if (outcome.outcome === "failed") failed++;
      else done++;
    }

    return failed > 0
      ? { outcome: "done", message: `Đi hết một vòng — ${done} thuận, ${failed} trắc trở.` }
      : { outcome: "done", message: `Đi hết một vòng — ${done} nhiệm vụ thuận lợi.` };
  } finally {
    // Đóng trong finally, và nuốt lỗi: một trình duyệt không đóng được không được phép ghi
    // đè lên kết quả thật của lượt chạy.
    await browser.close().catch(() => {});
  }
}
