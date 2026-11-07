/**
 * Pick the configured habitat through the game's UI. The client chooses a
 * legal in-habitat point for the current seat; screen/world coordinates are not
 * interchangeable and no within-habitat hotspot has been established.
 */
export async function prepareFishingSpot(page) {
  const inspect = (ownSpotSheet = false) => page.evaluate((ownSpotSheet) => {
    const visible = el => {
      if (!el || !el.getClientRects().length) return false;
      const css = getComputedStyle(el);
      return css.display !== "none" && css.visibility !== "hidden" && Number(css.opacity || "1") > .01;
    };
    const room = document.querySelector(".fish-room");
    const main = room?.querySelector(".fish-main");
    const spot = room?.querySelector(".fish-spot");
    const label = (spot?.querySelector("b")?.textContent || "").trim();
    const hunt = room?.querySelector(".fish-tide.hunt");
    return {
      idle: !!main?.classList.contains("st-idle") && !main.disabled,
      spectator: visible(room?.querySelector(".fish-spec")),
      blocked: [...document.querySelectorAll(".sheet")].some(el => visible(el) && !(ownSpotSheet && el.querySelector(".fish-spots"))),
      hasSpot: visible(spot) && !spot.disabled,
      current: label,
      // The same .hunt class is used for the upcoming countdown. Only the
      // active "Cá Săn · <habitat>" (mobile "Săn ·") chip preserves the aim.
      hunt: visible(hunt) && /^(?:Cá\s+)?Săn\s*·\s*\S/u.test(hunt.textContent?.trim() || ""),
    };
  }, ownSpotSheet);
  let state = await inspect();
  if (!state.idle || state.spectator) return { ready: false, reason: "Trò chơi chưa sẵn sàng đổi điểm câu." };
  if (state.blocked) return { ready: false, reason: "Còn cửa sổ che hồ; chưa ném câu." };
  if (state.hunt) return { ready: true, reason: "Giữ điểm hiện tại trong đợt Cá Săn." };
  if (!state.hasSpot) return { ready: true, reason: "Không thấy Điểm câu; giữ chỗ ném do game chọn." };
  const label = await page.evaluate(() => {
    // IDs and labels from the game's habitat catalog; random means one of
    // these four destinations on each cast, never a guessed world point.
    const habitats = { nong: "Bờ nông", sen: "Bãi sen", giua: "Giữa hồ", cau: "Dưới cầu đá" };
    const selected = window.__jvzFish?.spot;
    const labels = Object.values(habitats);
    return selected === "random" ? labels[Math.floor(Math.random() * labels.length)]
      : Object.hasOwn(habitats, selected) ? habitats[selected] : habitats.giua;
  });
  if (state.current === label) return { ready: true, label };

  let sheet;
  try {
    await page.locator(".fish-room .fish-spot").click({ timeout: 1500 });
    sheet = page.locator(".sheet").filter({ has: page.locator(".fish-spots") }).last();
    await sheet.waitFor({ state: "visible", timeout: 1500 });
    const target = sheet.locator("button.fish-hab").filter({
      has: page.locator(".fish-hab-text b", { hasText: new RegExp("^" + label + "$", "u") }),
    });
    // Recheck the idle state after opening a sheet. Never change habitat in a
    // bite/fight, or replace a hunt destination that appeared during selection.
    state = await inspect(true);
    if (!state.idle || state.spectator || state.blocked || state.hunt || await target.count() !== 1)
      return { ready: false, reason: `Chưa xác định được điểm ${label} an toàn.` };
    await target.click({ timeout: 1500 }); // Ge(event) requires a trusted click.
    await page.waitForFunction((label) => {
      const spot = document.querySelector(".fish-room .fish-spot b");
      const open = [...document.querySelectorAll(".fish-spots")].some(el => el.getClientRects().length);
      return !document.querySelector(".fish-room .fish-main.st-idle") ||
        (spot?.textContent?.trim() === label && !open);
    }, label, { timeout: 2500 });
    state = await inspect();
    return state.idle && !state.spectator && !state.blocked
      ? { ready: true, changed: true, label }
      : { ready: false, reason: "Điểm câu đã đổi nhưng trò chơi chưa sẵn sàng ném." };
  } catch {
    return { ready: false, reason: `Game chưa xác nhận điểm ${label}; sẽ thử lại.` };
  } finally {
    // Close only the spot sheet opened by this call. Never dismiss another
    // dialog or let Space cast through a failed spot selection.
    if (sheet && await sheet.isVisible().catch(() => false)) {
      await sheet.locator('.sheet-head button[aria-label="Đóng"]').click({ timeout: 750 }).catch(() => {});
    }
  }
}
