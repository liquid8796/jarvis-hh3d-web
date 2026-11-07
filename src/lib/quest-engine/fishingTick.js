/**
 * In-page fishing controller, run as one short evaluateJavaScript step per tick.
 * Grounded in the 10/10 recording (DOM + Socket.IO g:act/g:input). It acts via
 * site controls for bag/rooms. Fishing input itself MUST run as a trusted
 * Playwright click: the game rejects synthetic PointerEvent (isTrusted=false).
 * The quest engine owns the bounded repeat loop and its cancellation.
 */
() => {
  const sellBelow = Math.max(0, Math.min(30, Number("{{sellBelow}}") || 0));
  const castLimit = Math.max(0, Math.min(10000, Number("{{castLimit}}") || 0));
  const body = document.body;
  const state = window.__jvzFish ??= { casts: 0, ticks: 0, bagChecked: false, lastBagCast: -1, entering: 0, pressed: false, lastPress: 0, pendingSale: false };
  state.spot = "{{spot}}";
  state.ticks++;
  // Detail-only basket reads must not trigger the normal sale/cast branch.
  if (state.journalReading)
    return "fish: đang đọc chi tiết cá vừa bắt";
  // Lượt câu không giới hạn: NEVER finish the job on room/basket/network
  // issues. Retry in the same worker/browser so no five-minute cycle break.
  if (state.castFailure) {
    state.castFailure = "";
    return "!Chưa ném được câu. Sẽ thử lại sau 5 giây.";
  }
  if (state.retryAfter > Date.now()) return "fish: chờ hồi phục";
  const get = (sel) => document.querySelector(sel);
  const label = (element) => (element?.textContent || "").replace(/\s+/g, " ").trim();
  const visible = (el) => !!el && el.getClientRects().length > 0 && !el.disabled;
  const finish = (message, error = false) => {
    if (castLimit === 0) {
      // Temporary blockers should not become a finished quest. The operator's
      // Thu Đàn is the only normal exit; the engine still checks cancellation.
      state.retryAfter = Date.now() + (error ? 30_000 : 60_000);
      state.pendingCast = false;
      state.lastCast = 0;
      state.entering = 0;
      return "!" + message + ` Sẽ thử lại sau ${error ? 30 : 60} giây.`;
    }
    body.classList.add(error ? "jvz-fish-error" : "jvz-fish-finished");
    return "!" + message;
  };
  if (body.classList.contains("jvz-fish-finished") || body.classList.contains("jvz-fish-error")) return "";

  // REA: the hub can be mounted BEHIND the Tiên Giới preloader.
  // DOM clicks on its hidden menu work, but real mouse down/up are blocked
  // until the official .pl-go entry invokes the game's enter() callback.
  const gateGo = get(".pl-go");
  const loader = get(".bt-wrap");
  const gate = get(".pl-gate");
  const splashVisible = [gateGo, gate, loader].some((el) => {
    if (!el || !el.getClientRects().length) return false;
    const style = getComputedStyle(el);
    return style.display !== "none" && style.visibility !== "hidden"
      && Number(style.opacity || "1") > 0.01;
  });
  if (splashVisible) {
    if (!state.gateStartedAt) state.gateStartedAt = Date.now();
    if (visible(gateGo)) {
      gateGo.classList.add("jvz-fish-enter");
      return "fish: cần bấm Vào Ngay để đóng màn chào Tiên Giới";
    }
    if (Date.now() - state.gateStartedAt > 30_000 &&
        Date.now() - (state.gateWarnedAt || 0) > 30_000) {
      state.gateWarnedAt = Date.now();
      return "!Tiên Giới vẫn đang tải. Chờ tải xong để câu cá.";
    }
    return "fish: đợi màn tải Tiên Giới hiển thị Vào Ngay";
  }
  state.gateStartedAt = 0;
  const room = get(".view.fish-room");
  if (!room) {
    // The fish game is in the Tiên Giới hub's Trò chơi launcher, NOT /nhiem-vu-hang-ngay.
    // The launcher sheet stays mounted behind the fishing-room sheet.
    // Use the foremost sheet carrying actual room listings, not querySelector first.
    const sheets = [...document.querySelectorAll(".sheet")].filter(visible);
    const sheet = sheets.find((s) => s.querySelector(".room-item")) ?? sheets.at(-1);
    if (sheet) {
      const rooms = [...sheet.querySelectorAll(".room-item")];
      if (rooms.length) {
        const available = rooms.find((r) => {
          const people = /([0-9]+)\s*\/\s*([0-9]+)\s*người/i.exec(label(r));
          return people && +people[1] < +people[2] &&
            [...r.querySelectorAll("button")].some((b) => visible(b) && /^Vào$/i.test(label(b)));
        });
        if (available) {
          [...available.querySelectorAll("button")].find((b) => /^Vào$/i.test(label(b)))?.click();
          state.entering = 0;
          return "!Đang vào phòng câu cá.";
        }
        return finish("Chưa có phòng câu cá nào vào được.", true);
      }
      // The launcher opens on recruitment when there are active adverts.
      // Its games panel stays mounted but hidden until this tab is selected.
      const games = sheet.querySelector('.rc-tab[data-t="games"]');
      if (visible(games) && games.getAttribute("aria-selected") === "false") {
        games.click();
        state.entering = 0;
        return "fish: chuyển sang danh sách Trò chơi";
      }
      const fish = [...sheet.querySelectorAll("button")].find((b) => /Câu Cá/i.test(label(b)) && visible(b));
      if (fish) { fish.click(); return "fish: mở danh sách phòng"; }
    }
    const launcher = get(".view.hub .launcher-btn");
    if (visible(launcher) && state.entering++ === 0) { launcher.click(); return "fish: mở Trò chơi"; }
    if (state.entering > 8) return finish("Chưa tìm thấy Câu Cá trong Tiên Giới.", true);
    return "fish: chờ danh sách Câu Cá";
  }

  const main = get(".fish-room .fish-main");
  if (!main) return finish("Đã vào phòng nhưng chưa thấy nút Ném câu.", true);
  main.classList.remove("jvz-fish-press");
  const badge = label(get(".fish-quick-bag .fish-badge"));
  const bagCount = +(badge.match(/^(\d+)\s*\//)?.[1] || 0);
  const bagCap = +(badge.match(/\/\s*(\d+)/)?.[1] || 30);
  const pendingBag = [...document.querySelectorAll(".sheet .fish-bag-pend")].find(visible);
  if (pendingBag) {
    const open = [...pendingBag.querySelectorAll("button")].find(b => visible(b) && /^Mở giỏ dọn chỗ$/i.test(label(b)));
    if (open) { open.click(); state.bagChecked = false; return "fish: mở giỏ để dọn chỗ cho cá đang chờ"; }
    return finish("Giỏ cá đầy, chưa mở được giỏ để kiểm tra. Giữ nguyên cá đang chờ.", true);
  }
  const bag = [...document.querySelectorAll(".sheet .fish-bag")].find(visible);
  if (bag) {
    if (!bag.querySelector(".fish-bag-head, .fish-bag-item, .fish-bag-empty")) {
      state.bagLoadingAt ||= Date.now();
      if (Date.now() - state.bagLoadingAt > 12_000) {
        bag.closest(".sheet")?.querySelector('.sheet-head button[aria-label="Đóng"]')?.click();
        state.bagChecked = false; state.bagLoadingAt = 0;
        return finish("Chưa đọc được giỏ cá.", true);
      }
      return "fish: đợi dữ liệu giỏ cá";
    }
    state.bagLoadingAt = 0;
    const auto = get(".fish-bag-auto button.notif-toggle");
    if (sellBelow === 0 && visible(auto) &&
        (auto.getAttribute("aria-checked") === "true" || auto.classList.contains("on"))) {
      auto.click();
      return "!Đã tắt tự bán cá. Giữ lại toàn bộ cá.";
    }
    if (sellBelow > 0 && visible(auto) && auto.getAttribute("aria-checked") !== "true" && !auto.classList.contains("on")) {
      auto.click();
      return "!Đã bật tự bán cá cấp thấp.";
    }
    const cards = [...bag.querySelectorAll(".fish-bag-item.fish-card")];
    const eligible = cards.filter((card) => {
      const strengths = [...label(card).matchAll(/\+(\d+)\b/g)].map((m) => +m[1]);
      return strengths.length > 0 && strengths[strengths.length - 1] <= sellBelow;
    });
    // A user might have selected a rare fish before automation resumed. Clear
    // those selections BEFORE submitting the game's single bulk-sale button.
    const eligibleSet = new Set(eligible);
    const unsafeSelected = cards.filter((card) => card.classList.contains("on") && !eligibleSet.has(card));
    if (unsafeSelected.length) {
      unsafeSelected.forEach((card) => card.click());
      return "fish: bỏ chọn cá vượt ngưỡng hoặc không xác định được ngư lực";
    }
    const inventorySignature = () => JSON.stringify(
      [...bag.querySelectorAll(".fish-bag-item.fish-card")].map(label).sort(),
    );
    // The sale button stays mounted until the request completes. Do not
    // resubmit or close the bag before the game renders its new selection.
    if (state.saleRequestedAt) {
      if (!state.saleConfirmationSent && bag.querySelector(".fish-bag-ask")) {
        state.saleRequestedAt = 0; // delayed confirmation is not a submitted sale
      } else if (inventorySignature() === state.saleInventory) {
        if (Date.now() - state.saleRequestedAt < 12_000)
          return "fish: chờ trò chơi cập nhật giỏ sau yêu cầu bán";
        bag.closest(".sheet")?.querySelector('.sheet-head button[aria-label="Đóng"]')?.click();
        state.saleRequestedAt = 0;
        state.pendingSale = false;
        state.bagChecked = false;
        state.retryAfter = Date.now() + 30_000;
        return "!Chưa xác nhận được kết quả bán cá. Sẽ đọc lại giỏ sau 30 giây.";
      }
      state.saleRequestedAt = 0;
      state.pendingSale = false;
    }
    if (sellBelow > 0 && eligible.length) {
      const notSelected = eligible.filter((c) => !c.classList.contains("on"));
      if (notSelected.length) {
        notSelected.forEach((card) => card.click());
        state.pendingSale = true;
        return `fish: chọn ${notSelected.length} cá có ngư lực ≤ +${sellBelow}`;
      }
      const sell = [...bag.querySelectorAll(".fish-bag-bar button")].find((b) => visible(b) && /^Bán \d+ con/i.test(label(b)));
      if (sell) {
        const confirming = !!bag.querySelector(".fish-bag-ask");
        state.saleInventory = inventorySignature();
        state.saleConfirmationSent = confirming;
        sell.click();
        // Manual Chrome capture 2026-11-07: the first click for rare fish
        // only opens .fish-bag-ask. Revalidate the selection before confirming.
        if (!confirming && bag.querySelector(".fish-bag-ask")) {
          state.pendingSale = true;
          return "fish: kiểm tra lại cá đã chọn trước khi xác nhận bán cá hiếm";
        }
        state.pendingSale = false;
        state.saleRequestedAt = Date.now();
        return "fish: đã gửi yêu cầu bán cá, chờ trò chơi xác nhận";
      }
    }
    if (bagCount >= bagCap && bag.querySelector(".fish-bag-capnote"))
      return finish("Ngư Ông đã mua đủ hôm nay. Giữ nguyên cá trong giỏ; không tự thả cá.", true);
    if (bagCount >= bagCap && (sellBelow === 0 || eligible.length === 0))
      return finish("Giỏ cá đã đầy. Không có cá phù hợp với ngưỡng bán đã chọn.", true);
    const close = bag.closest(".sheet")?.querySelector('.sheet-head button[aria-label="Đóng"]');
    if (close) { close.click(); state.bagChecked = true; state.lastBagCast = state.casts; }
    return "fish: xong kiểm giỏ";
  }

  if (!state.bagChecked || bagCount >= bagCap || (state.casts > state.lastBagCast && (state.casts % 5 === 0 || bagCount >= bagCap - 1))) {
    const opener = get(".fish-room .fish-quick-bag");
    if (visible(opener)) { opener.click(); state.bagChecked = true; return "fish: kiểm giỏ"; }
  }

  const mainText = label(main);
  const idle = main.classList.contains("st-idle") || /Ném câu/i.test(mainText);
  const stamina = /([0-9]+)\s*\/\s*([0-9]+)/.exec(label(get(".fish-day .short")));
  if (stamina && +stamina[1] >= +stamina[2] && +stamina[2] > 0) {
    const leave = get(".fish-room .room-top button[aria-label='Rời phòng']");
    if (castLimit > 0 && visible(leave)) leave.click();
    return finish("Đã dùng hết sức câu hôm nay.");
  }
  if (state.pendingCast && !idle) {
    // The browser sent a cast only after the game changed its own state.
    // Never report a cast merely because a click was dispatched (no spot / net lag).
    state.pendingCast = false;
    state.casts++;
    return `!Đã ném câu lần ${state.casts}${castLimit ? "/" + castLimit : ""}.`;
  }
  if (state.pendingCast && idle) {
    if (Date.now() - state.lastCast > 12000)
      return finish("Trò chơi chưa phản hồi sau 12 giây. Hãy kiểm tra kết nối Tiên Giới.", true);
    return "fish: đợi game xác nhận ném câu";
  }
  if (castLimit > 0 && state.casts >= castLimit && idle) {
    const leave = get(".fish-room .room-top button[aria-label='Rời phòng']");
    if (visible(leave)) { leave.click(); return finish(`Đã câu đủ ${state.casts} lượt. Rời phòng câu.`); }
    return finish("Đã câu đủ lượt nhưng chưa rời được phòng.", true);
  }
  if (idle && visible(main)) {
    if (state.casts > 0 && Date.now() - (state.lastCast || 0) < 2200) return "fish: đợi lượt trước";
    // The trusted session driver selects the configured habitat before casting.
    // Playwright Click step below will deliver trusted pointerdown/up.
    main.classList.add("jvz-fish-press");
    // Only the trusted input driver may set pendingCast AFTER the game
    // actually leaves idle. A skipped optional click is not a cast.
    state.pendingCast = false;
    return "fish: chuẩn bị nhấn/thả chuột thật để Ném câu (chưa xác nhận game nhận)";
  }
  if (main.classList.contains("st-reel"))
    return "fish: servo đang bám thanh lực theo g:snap (f, z, zone, p)";
  if (/GIẬT|Nhấc cần/i.test(mainText) && visible(main)) {
    if (Date.now() - state.lastPress > 470) {
      // Trusted hook click, then the native servo takes over in st-reel.
      main.classList.add("jvz-fish-press");
      state.lastPress = Date.now();
    }
  }
  // Safety valve if the game stays stuck in an unknown state for several minutes.
  if (state.lastCast && Date.now() - state.lastCast > 150000 && state.casts > 0)
    return finish("Lượt câu chưa có kết quả sau 2 phút 30 giây.", true);
  return "fish: " + mainText.slice(0, 60);
}
