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
  const sellEveryCasts = Math.max(1, Math.min(10000, Math.trunc(Number("{{sellEveryCasts}}")) || 5));
  const releaseBelow = Math.max(0, Math.min(30, Number("{{releaseBelow}}") || 0));
  const releaseEveryCasts = Math.max(1, Math.min(10000, Math.trunc(Number("{{releaseEveryCasts}}")) || 5));
  const body = document.body;

  const state = window.__jvzFish ??= { casts: 0, ticks: 0, bagChecked: false, lastBagCast: -1, entering: 0, pressed: false, lastPress: 0, pendingSale: false };
  state.spot = "{{spot}}";
  state.ticks++;
  // Correlated, passive Socket.IO receipts are supplied by the session driver.
  // The daily cap is a value allowance: 999/1000 can reject a +4 fish.
  for (const receipt of (window.__jvzFishReceipts?.splice(0) || [])) {
    if (!Number.isFinite(receipt.at) || Date.now() - receipt.at > 60_000) continue;
    if (receipt.ok && Number.isSafeInteger(receipt.remainingAllowance) && receipt.remainingAllowance >= 0)
      state.saleAllowance = receipt.remainingAllowance;
    if (receipt.action === "sell" && receipt.stop === "cap") {
      if (!Number.isSafeInteger(receipt.remainingAllowance)) state.saleAllowance = 0;
      state.saleCapNotice = true;
    }
    if (state.bagRequest && receipt.action === state.bagRequest.kind && receipt.at >= state.bagRequest.at)
      state.bagRequest.receipt = receipt;
  }

  // Detail-only basket reads must not trigger the normal sale/cast branch.
  if (state.journalReading)
    return "fish: đang đọc chi tiết cá vừa bắt";
  // Lượt câu không giới hạn: NEVER finish the job on room/basket/network
  // issues. Retry in the same worker/browser so no five-minute cycle break.
  if (state.castFailure) {
    state.castFailure = "";
    return "!Chưa ném được câu. Sẽ thử lại sau 5 giây.";
  }
  if (state.saleCapNotice) {
    state.saleCapNotice = false;
    return "!Đã chạm hạn mức bán cá hôm nay. Bỏ qua cá vượt phần hạn mức còn lại; chỉ thả khi đã bật tùy chọn thả cá.";
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
  const mainText = label(main);
  const idle = main.classList.contains("st-idle") || /Ném câu/i.test(mainText);
  main.classList.remove("jvz-fish-press");
  const badge = label(get(".fish-quick-bag .fish-badge"));
  const bagCount = +(badge.match(/^(\d+)\s*\//)?.[1] || 0);
  const bagCap = +(badge.match(/\/\s*(\d+)/)?.[1] || 30);
  const castsSinceSale = state.casts - Math.max(0, state.lastSaleCast ?? state.lastBagCast ?? 0);
  const castsSinceRelease = state.casts - Math.max(0, state.lastReleaseCast ?? 0);
  const castsSinceBag = state.casts - Math.max(0, state.lastBagCast ?? 0);
  const safetyDue = bagCount >= bagCap || (castsSinceBag > 0 && bagCount >= bagCap - 1);
  const saleDue = !state.bagChecked || safetyDue || castsSinceSale >= sellEveryCasts;
  const releaseDue = releaseBelow > 0 && (!state.bagChecked || safetyDue || castsSinceRelease >= releaseEveryCasts);
  const pendingBag = [...document.querySelectorAll(".sheet .fish-bag-pend")].find(visible);
  if (pendingBag) {
    const open = [...pendingBag.querySelectorAll("button")].find(b => visible(b) && /^Mở giỏ dọn chỗ$/i.test(label(b)));
    if (open) { open.click(); state.bagChecked = false; return "fish: mở giỏ để dọn chỗ cho cá đang chờ"; }
    return finish("Giỏ cá đầy, chưa mở được giỏ để kiểm tra. Giữ nguyên cá đang chờ.", true);
  }
  const bag = [...document.querySelectorAll(".sheet .fish-bag")].find(visible);
  if (bag) {
    if (state.bagRefreshRequired) {
      bag.closest(".sheet")?.querySelector('.sheet-head button[aria-label="Đóng"]')?.click();
      state.bagRefreshRequired = false;
      return "fish: đọc lại giỏ sau khi kết nối thay đổi";
    }
    state.bagOpeningAt = 0; state.bagOpenStartedAt = 0;
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
    // Native star-based auto-sale runs after every catch and ignores both the
    // configured interval and our ngư lực threshold. Batch sales own this flow.
    const auto = bag.querySelector(".fish-bag-auto button.notif-toggle");
    if (visible(auto) && (auto.getAttribute("aria-checked") === "true" || auto.classList.contains("on"))) {
      auto.click();
      return sellBelow === 0 && releaseBelow === 0 ? "!Đã tắt tự bán cá. Giữ lại toàn bộ cá."
        : "!Đã tắt tự bán tức thời của game; sẽ bán/thả cá theo ngưỡng và số lượt đã chọn.";
    }
    state.bagWork ??= { sale: saleDue, release: releaseDue };
    if (bag.querySelector(".fish-bag-capnote")) state.saleAllowance = 0;
    const inventorySignature = () => JSON.stringify(
      [...bag.querySelectorAll(".fish-bag-item.fish-card")].map(label).sort(),
    );
    // Never change selection, close the basket or retry an unresolved action.
    const request = state.bagRequest;
    if (request) {
      const receipt = request.receipt;
      if (!request.confirmationSent && bag.querySelector(".fish-bag-ask")) {
        state.bagRequest = null; // a delayed rare-fish prompt is not submission
      } else if (receipt && (!receipt.ok || (receipt.stop === "cap" && receipt.soldCount === 0))) {
        state.bagRequest = null;
        if (!receipt.ok) {
          state.bagWork = null;
          state.bagChecked = false;
          return finish("Trò chơi chưa chấp nhận yêu cầu " + (request.kind === "sell" ? "bán" : "thả") + " cá.", true);
        }
      } else if (inventorySignature() === request.inventory) {
        if (Date.now() - request.at < 12_000)
          return "fish: chờ trò chơi cập nhật giỏ sau yêu cầu " + (request.kind === "sell" ? "bán" : "thả");
        bag.closest(".sheet")?.querySelector('.sheet-head button[aria-label="Đóng"]')?.click();
        state.bagRequest = null; state.bagWork = null; state.bagChecked = false;
        state.retryAfter = Date.now() + 30_000;
        return "!Chưa xác nhận được kết quả " + (request.kind === "sell" ? "bán" : "thả") + " cá. Sẽ đọc lại giỏ sau 30 giây.";
      } else {
        state.bagRequest = null;
      }
    }
    const cards = [...bag.querySelectorAll(".fish-bag-item.fish-card")];
    const strength = card => {
      const values = [...label(card).matchAll(/\+(\d+)\b/g)].map(m => +m[1]);
      return values.length ? values.at(-1) : null;
    };
    const releaseEligible = state.bagWork.release && releaseBelow > 0
      ? cards.filter(card => strength(card) !== null && strength(card) <= releaseBelow) : [];
    const releaseSet = new Set(releaseEligible);
    const saleCandidates = sellBelow > 0 ? cards.filter(card =>
      strength(card) !== null && strength(card) <= sellBelow &&
      (state.bagWork.sale || releaseSet.has(card))) : [];
    let allowance = Number.isSafeInteger(state.saleAllowance) ? state.saleAllowance : Infinity;
    const saleEligible = saleCandidates.slice().sort((a,b) => strength(a)-strength(b)).filter(card => {
      const value = strength(card);
      if (value > allowance) return false;
      allowance -= value;
      return true;
    });
    // Sale wins overlap, including a release check before the next sale check.
    const kind = saleEligible.length ? "sell" : releaseEligible.length ? "release" : "";
    const eligible = kind === "sell" ? saleEligible : releaseEligible;
    const eligibleSet = new Set(eligible);
    if (!kind && bagCount >= bagCap) {
      bag.closest(".sheet")?.querySelector('.sheet-head button[aria-label="Đóng"]')?.click();
      state.bagChecked = false;
      state.bagWork = null;
      if (Number.isSafeInteger(state.saleAllowance) && saleCandidates.length)
        return finish("Hạn mức bán hôm nay không đủ cho cá trong giỏ. Không có cá phù hợp với tùy chọn thả đã bật.", true);
      if (bag.querySelector(".fish-bag-capnote"))
        return finish("Ngư Ông đã mua đủ hôm nay. Giữ nguyên cá không phù hợp với tùy chọn thả.", true);
      return finish("Giỏ cá đã đầy. Không có cá phù hợp với ngưỡng bán hoặc thả đã chọn.", true);
    }
    const unsafeSelected = cards.filter(card => card.classList.contains("on") && !eligibleSet.has(card));
    if (unsafeSelected.length) {
      unsafeSelected.forEach(card => card.click());
      return "fish: bỏ chọn cá vượt ngưỡng hoặc không xác định được ngư lực";
    }
    if (kind) {
      const notSelected = eligible.filter(card => !card.classList.contains("on"));
      if (notSelected.length) {
        notSelected.forEach(card => card.click());
        return `fish: chọn ${notSelected.length} cá để ${kind === "sell" ? "bán" : "thả"} theo ngưỡng ngư lực`;
      }
      const action = [...bag.querySelectorAll(".fish-bag-bar button")].find(button =>
        visible(button) && (kind === "sell" ? /^Bán \d+ con/i : /^Thả về hồ$/i).test(label(button)));
      if (!action) return finish("Chưa tìm thấy nút " + (kind === "sell" ? "bán" : "thả") + " cá phù hợp.", true);
      const confirming = !!bag.querySelector(".fish-bag-ask");
      const inventory = inventorySignature();
      action.click();
      if (!confirming && bag.querySelector(".fish-bag-ask"))
        return "fish: kiểm tra lại cá đã chọn trước khi xác nhận " + (kind === "sell" ? "bán" : "thả") + " cá hiếm";
      state.bagRequest = { kind, at: Date.now(), inventory, confirmationSent: confirming };
      return "fish: đã gửi yêu cầu " + (kind === "sell" ? "bán" : "thả") + " cá, chờ trò chơi xác nhận";
    }
    const close = bag.closest(".sheet")?.querySelector('.sheet-head button[aria-label="Đóng"]');
    if (close) {
      close.click();
      if (state.bagWork.sale) state.lastSaleCast = state.casts;
      if (state.bagWork.release) state.lastReleaseCast = state.casts;
      state.bagWork = null; state.bagChecked = true; state.lastBagCast = state.casts;
    }
    return "fish: xong kiểm giỏ";
  }

  state.bagRefreshRequired = false;
  const bagDue = saleDue || releaseDue;
  // Count only accepted casts, then wait for their result before opening a
  // basket. A safety sale starts a fresh interval rather than a global modulo.
  if (idle && bagDue) {
    const opener = get(".fish-room .fish-quick-bag");
    if (!visible(opener)) return finish("Chưa mở được giỏ cá để kiểm tra trước khi câu.", true);
    state.bagOpenStartedAt ||= Date.now();
    if (Date.now() - state.bagOpenStartedAt > 12_000) {
      state.bagOpenStartedAt = 0; state.bagOpeningAt = 0;
      return finish("Trò chơi chưa mở được giỏ cá.", true);
    }
    if (!state.bagOpeningAt || Date.now() - state.bagOpeningAt >= 1500) {
      opener.click(); state.bagOpeningAt = Date.now();
      return "fish: kiểm giỏ";
    }
    // Only closing a loaded, processed basket sets bagChecked. In particular,
    // a delayed first open may never allow the first cast to slip through.
    return "fish: chờ mở giỏ cá trước khi tiếp tục câu";
  }

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
