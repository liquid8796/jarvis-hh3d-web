import { FISH_NAMES } from "./fishingNames.mjs";

// Wire contract checked in Chrome on 2026-11-07: fish-TLBXRWCJ.js.
// The card's +N is item.price (Linh Thạch), NOT a fish-power attribute.
const amount = value => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
const number = value => value.toLocaleString("vi-VN");
const id = value => typeof value === "string" || (typeof value === "number" && Number.isSafeInteger(value));
const decode = (raw, type) => {
  const match = new RegExp("^" + type + "(\\d*)\\[").exec(raw);
  if (!match) return null;
  try { return { ack: match[1], data: JSON.parse(raw.slice(type.length + match[1].length)) }; }
  catch { return null; }
};

export function formatFishingCatch(event) {
  const name = Object.hasOwn(FISH_NAMES, event?.f) ? FISH_NAMES[event.f] : event?.f ? "cá (chưa rõ tên)" : "cá";
  const price = amount(event?.price);
  return "Câu Cá: Bắt được " + name + (price === null ? "." : " · giá bán +" + number(price) + " Linh Thạch.");
}

/** Passive receipts only: never sends a game request or estimates money from wallet changes. */
export function createFishingSaleJournal(log, now = Date.now) {
  let self = null, bag = new Map(), pendingFish = null, cycle = 0, autoCycle = -1, reeling = false;
  const pending = new Map();
  const reset = () => { self = null; bag.clear(); pendingFish = null; pending.clear(); cycle = 0; autoCycle = -1; reeling = false; };
  const rememberBag = payload => {
    if (!Array.isArray(payload?.items)) return;
    bag = new Map(payload.items.filter(f => f && id(f.id)).slice(0,4096)
      .map(f => [f.id, {price:amount(f.price)}]));
    pendingFish = payload.pend ? {price:amount(payload.pend.price)} : null;
  };
  const report = (count, fish, total, automatic = false, stopped = "") => {
    if (!Number.isSafeInteger(count) || count <= 0) return;
    const groups = new Map();
    let unknown = count;
    for (const item of fish.slice(0,count)) {
      if (item?.price === null || item?.price === undefined) continue;
      groups.set(item.price, (groups.get(item.price) || 0) + 1); unknown--;
    }
    const parts = [...groups].sort((a,b)=>a[0]-b[0]).map(([price,n])=>"+"+number(price)+": "+number(n)+" cá");
    if (unknown) parts.push("chưa rõ giá: "+number(unknown)+" cá");
    const earned = amount(total);
    log.info("Câu Cá: " + (automatic ? "Tự bán " : "Đã bán ") + number(count) +
      " cá (giá bán, Linh Thạch: " + parts.join("; ") + ") · " +
      (earned === null ? "chưa rõ số Linh Thạch thu được." : "thu "+number(earned)+" Linh Thạch.") +
      (stopped === "cap" ? " Đã chạm hạn mức bán hôm nay." : ""));
  };
  return {
    reset,
    sent(raw) {
      const packet = decode(raw,"42");
      if (!packet?.ack || self === null) return;
      const [name, action] = packet.data;
      if (name !== "g:act" || !["bag","sell","settle"].includes(action?.a)) return;
      const at = now();
      for (const [key, request] of pending) if (at-request.at>60_000) pending.delete(key);
      while (pending.size >= 128) pending.delete(pending.keys().next().value);
      const ids = Array.isArray(action.ids) ? action.ids.filter(id).slice(0,4096) : [];
      pending.set(packet.ack, {at, action:action.a, how:action.how, fish:pendingFish,
        items:new Map(ids.map(key=>[key,bag.get(key)]))});
    },
    received(raw) {
      const response = decode(raw,"43");
      if (response) {
        const request = pending.get(response.ack);
        pending.delete(response.ack);
        if (!request || self === null || now()-request.at>60_000) return;
        const result = response.data[0];
        if (!result || typeof result !== "object") return;
        if (request.action === "sell") {
          const sold = Array.isArray(result.sold) ? [...new Set(result.sold.filter(id))] : [];
          // sold is authoritative, not the requested count or the remaining bag size.
          report(sold.length, sold.map(key=>request.items.get(key)), result.total, false, result.stop);
          if (!Array.isArray(result.sold) && result.ok === true && amount(result.total) > 0)
            log.info("Câu Cá: Đã bán cá (chưa rõ số cá và giá từng con) · thu " + number(result.total) + " Linh Thạch.");
          for (const key of sold) bag.delete(key);
        } else if (request.action === "settle" && request.how === "sell" && result.ok === true) {
          report(1,[request.fish],result.total);
          pendingFish = null;
        }
        if (result.ok || Array.isArray(result.sold)) rememberBag(result);
        return;
      }
      const packet = decode(raw,"42");
      if (!packet) return;
      const [name,payload] = packet.data;
      if (name === "hello") {
        reset();
        self = Number.isSafeInteger(payload?.me?.id) && payload.me.id > 0 ? payload.me.id : null;
        return;
      }
      if (self === null) return;
      const events = name === "g:evts" ? payload : name === "g:evt" ? [payload] : [];
      if (!Array.isArray(events)) return;
      for (const event of events) {
        if (!event || (event.uid !== undefined && event.uid !== self) || event.sync) continue;
        if (event.type === "reel") {
          if (!reeling) cycle++;
          reeling = true;
        }
        if (event.type === "catch" || event.type === "escaped" || (event.type === "st" && event.s === "idle"))
          reeling = false;
        if (event?.type !== "bag" || event.sync || event.auto?.how !== "sold" ||
            cycle === 0 || autoCycle === cycle || (event.uid !== undefined && event.uid !== self)) continue;
        autoCycle = cycle;
        report(1,[{price:amount(event.auto.price)}],event.auto.price,true);
      }
    },
  };
}
