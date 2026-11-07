/** Read the normal basket UI once without selecting fish, selling, or changing settings. */
export async function readFishingCatchBag(page) {
  await page.evaluate(async () => {
    const main = document.querySelector(".fish-room .fish-main");
    const opener = document.querySelector(".fish-room .fish-quick-bag");
    const visible = el => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden";
    const existing = new Set(document.querySelectorAll(".sheet"));
    if (!main || !opener || opener.disabled || [...existing].some(visible)) return;
    const state = window.__jvzFish;
    if (!state || state.journalReading) return;
    state.journalReading = Date.now();
    let ownSheet = null;
    try {
      opener.click();
      for (let i=0;i<30;i++) {
        const panel = [...document.querySelectorAll(".sheet .fish-bag")]
          .find(el=>!existing.has(el.closest(".sheet")));
        if (panel) ownSheet = panel.closest(".sheet");
        if (panel?.querySelector(".fish-bag-head")) break;
        await new Promise(resolve=>setTimeout(resolve,50));
      }
    } finally {
      ownSheet?.querySelector('.sheet-head button[aria-label="Đóng"]')?.click();
      state.journalReading = 0;
    }
  }).catch(()=>{});
}
