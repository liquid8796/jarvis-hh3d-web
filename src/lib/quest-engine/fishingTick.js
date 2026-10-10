/**
 * In-page fishing controller, run as one short evaluateJavaScript step per tick.
 * Grounded in the 10/10 recording (DOM + Socket.IO g:act/g:input). It acts via
 * site controls rather than calling private socket events or inventing rewards.
 * The quest engine owns the bounded repeat loop and its cancellation.
 */
() => {
  const sellBelow = Math.max(0, Math.min(30, Number("{{sellBelow}}") || 0));
  const castLimit = Math.max(0, Math.min(10000, Number("{{castLimit}}") || 0));
  const body = document.body;
  const state = window.__jvzFish ??= { casts: 0, ticks: 0, bagChecked: false, lastBagCast: -1, entering: 0, pressed: false, lastPress: 0, pendingSale: false };
  state.ticks++;
  const get = (sel) => document.querySelector(sel);
  const label = (element) => (element?.textContent || "").replace(/\s+/g, " ").trim();
  const visible = (el) => !!el && el.getClientRects().length > 0 && !el.disabled;
  const press = (button) => {
    const common = { bubbles: true, cancelable: true, pointerId: 1, pointerType: "mouse", isPrimary: true };
    button.dispatchEvent(new PointerEvent("pointerdown", { ...common, buttons: 1 }));
    window.setTimeout(() => {
      if (!button.isConnected) return;
      button.dispatchEvent(new PointerEvent("pointerup", { ...common, buttons: 0 }));
    }, 300);
  };
  const finish = (message, error = false) => {
    body.classList.add(error ? "jvz-fish-error" : "jvz-fish-finished");
    return "!" + message;
  };
  if (body.classList.contains("jvz-fish-finished") || body.classList.contains("jvz-fish-error")) return "";
  const room = get(".view.fish-room");
  if (!room) {
    // The fish game is in the Tiên Giới hub's Trò chơi launcher, NOT /nhiem-vu-hang-ngay.
    const sheet = get(".sheet");
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
          return "!Tiên Giới: vào phòng câu cá còn chỗ.";
        }
        return finish("Không có phòng câu cá còn chỗ; sẽ thử lại lượt sau.", true);
      }
      const fish = [...sheet.querySelectorAll("button")].find((b) => /Câu Cá/i.test(label(b)) && visible(b));
      if (fish) { fish.click(); return "fish: mở danh sách phòng"; }
    }
    const launcher = get(".view.hub .launcher-btn");
    if (visible(launcher) && state.entering++ === 0) { launcher.click(); return "fish: mở Trò chơi"; }
    if (state.entering > 8) return finish("Không tìm thấy Câu Cá trong Tiên Giới; không thử click toạ độ đoán.", true);
    return "fish: chờ danh sách Câu Cá";
  }

  const main = get(".fish-room .fish-main");
  if (!main) return finish("Phòng đã vào nhưng không thấy nút câu.", true);
  const badge = label(get(".fish-quick-bag .fish-badge"));
  const bagCount = +(badge.match(/^(\d+)\s*\//)?.[1] || 0);
  const bagCap = +(badge.match(/\/\s*(\d+)/)?.[1] || 30);
  const bag = get(".sheet .fish-bag");
  if (bag) {
    const auto = get(".fish-bag-auto button.notif-toggle");
    if (sellBelow === 0 && visible(auto) &&
        (auto.getAttribute("aria-checked") === "true" || auto.classList.contains("on"))) {
      auto.click();
      return "!Đã tắt tự bán cá mặc định vì ngưỡng bán đang là 0 (giữ toàn bộ cá).";
    }
    if (sellBelow > 0 && visible(auto) && auto.getAttribute("aria-checked") !== "true" && !auto.classList.contains("on")) {
      auto.click();
      return "!Bật tự bán cá cấp thấp của trò chơi.";
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
    if (sellBelow > 0 && eligible.length) {
      const notSelected = eligible.filter((c) => !c.classList.contains("on"));
      if (notSelected.length) {
        notSelected.forEach((card) => card.click());
        state.pendingSale = true;
        return `fish: chọn ${notSelected.length} cá có ngư lực ≤ +${sellBelow}`;
      }
      const sell = [...bag.querySelectorAll(".fish-bag-bar button")].find((b) => visible(b) && /^Bán \d+ con/i.test(label(b)));
      if (sell && state.pendingSale) {
        state.pendingSale = false;
        sell.click();
        return "!Bán cá có ngư lực không quá +" + sellBelow;
      }
    }
    if (bagCount >= bagCap && (sellBelow === 0 || eligible.length === 0))
      return finish("Giỏ cá đầy, không có cá trong ngưỡng bán; dừng để giữ cá quý.", true);
    const close = [...document.querySelectorAll(".sheet-head button")].find((b) => b.getAttribute("aria-label") === "Đóng");
    if (close) { close.click(); state.bagChecked = true; state.lastBagCast = state.casts; }
    return "fish: xong kiểm giỏ";
  }

  if (!state.bagChecked || (state.casts > state.lastBagCast && (state.casts % 5 === 0 || bagCount >= bagCap - 1))) {
    const opener = get(".fish-room .fish-quick-bag");
    if (visible(opener)) { opener.click(); state.bagChecked = true; return "fish: kiểm giỏ"; }
  }

  const mainText = label(main);
  const idle = main.classList.contains("st-idle") || /Ném câu/i.test(mainText);
  const stamina = /([0-9]+)\s*\/\s*([0-9]+)/.exec(label(get(".fish-day .short")));
  if (stamina && +stamina[1] >= +stamina[2] && +stamina[2] > 0) {
    const leave = get(".fish-room .room-top button[aria-label='Rời phòng']");
    if (visible(leave)) leave.click();
    return finish("Đã dùng hết sức câu hôm nay; dừng và rời phòng.");
  }
  if (state.pendingCast && !idle) {
    // The browser sent a cast only after the game changed its own state.
    // Never report a cast merely because a click was dispatched (no spot / net lag).
    state.pendingCast = false;
    state.casts++;
    return `!Game nhận lượt ném câu ${state.casts}${castLimit ? "/" + castLimit : ""}`;
  }
  if (state.pendingCast && idle) {
    if (Date.now() - state.lastCast > 12000)
      return finish("Đã bấm Ném câu nhưng game vẫn idle hơn 12s (chưa chọn điểm câu hoặc mạng lỗi).", true);
    return "fish: đợi game xác nhận ném câu";
  }
  if (castLimit > 0 && state.casts >= castLimit && idle) {
    const leave = get(".fish-room .room-top button[aria-label='Rời phòng']");
    if (visible(leave)) { leave.click(); return finish(`Đã thực hiện ${state.casts} lần ném câu; rời phòng.`); }
    return finish("Đã đến giới hạn lượt câu, nhưng không thấy nút rời phòng.", true);
  }
  if (idle && visible(main)) {
    if (state.casts > 0 && Date.now() - (state.lastCast || 0) < 2200) return "fish: đợi lượt trước";
    // Initial target: the site uses the currently selected Điểm câu; don't guess world coordinates.
    main.click();
    state.pendingCast = true;
    state.lastCast = Date.now();
    return "fish: gửi thao tác Ném câu; đợi trạng thái của game";
  }
  if (/GIỮ|GIẬT|Nhấc cần/i.test(mainText) && visible(main)) {
    if (Date.now() - state.lastPress > 470) {
      if (main.classList.contains("st-bite") || /GIẬT|Nhấc cần/i.test(mainText)) main.click();
      else press(main); // recording: g:input h=1 then h=0, never a long permanent hold
      state.lastPress = Date.now();
    }
  }
  // Safety valve if the game stays stuck in an unknown state for several minutes.
  if (state.lastCast && Date.now() - state.lastCast > 150000 && state.casts > 0)
    return finish("Lượt câu bị kẹt hơn 150 giây; dừng thay vì gửi input vô hạn.", true);
  return "fish: " + mainText.slice(0, 60);
}
