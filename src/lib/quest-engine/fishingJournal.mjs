import { FISH_NAMES } from "./fishingNames.mjs";

// Wire contract checked in Chrome on 2026-11-07: fish-TLBXRWCJ.js.
// The game calls the card's +N item.price. The user explicitly wants this
// classification labeled "ngư lực" in the journal; only receipts use currency.
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
  const item = typeof event?.kind === "string" && event.kind !== "FISH";
  const name = Object.hasOwn(FISH_NAMES, event?.f) ? FISH_NAMES[event.f] : item ? "vật phẩm chưa rõ tên" : event?.f ? "cá (chưa rõ tên)" : "cá";
  if (item) return "Câu Cá: Câu được " + name + " (vật phẩm).";
  const price = amount(event?.price);
  return "Câu Cá: Bắt được " + name + (price === null ? " · ngư lực chưa rõ." : " · ngư lực +" + number(price) + ".");
}

/** Passive receipts only: never sends a game request or estimates money from wallet changes. */
export function createFishingSaleJournal(log, now = Date.now) {
  let self = null, bag = new Map(), pendingFish = null, cycle = 0, autoCycle = -1, reeling = false;
  let bagKnown = false, lastAuto = null, lastPending = null, lastGot = null, catchSequence = 0;
  const catches = new Map();
  const sameFish = (a,b) => typeof a?.f === "string" && a.f === b?.f &&
    Number.isFinite(a.w) && Number.isFinite(a.len) && a.w === b.w && a.len === b.len;
  const finishCatch = (token, price = null) => {
    const caught = catches.get(token);
    if (!caught) return;
    catches.delete(token);
    log.info(formatFishingCatch({...caught.event, price}));
  };
  const fromPending = fish => {
    if (amount(fish?.price) === null) return;
    const matching = [...catches].filter(([,caught])=>caught.got === null && sameFish(caught.event,fish));
    if (matching.length === 1) finishCatch(matching[0][0],fish.price);
  };
  const pending = new Map();
  const reset = () => {
    for (const token of catches.keys()) finishCatch(token);
    self = null; bag.clear(); bagKnown = false; lastAuto = null; lastPending = null; lastGot = null;
    pendingFish = null; pending.clear(); cycle = 0; autoCycle = -1; reeling = false;
  };
  const rememberBag = payload => {
    if (!Array.isArray(payload?.items)) return;
    const items = payload.items.filter(f => f && id(f.id)).slice(0,4096);
    for (const [token,caught] of catches) {
      const matching = caught.got !== null ? items.filter(f=>f.id === caught.got && sameFish(caught.event,f)) :
        caught.beforeIds === null ? [] : items.filter(f=>!caught.beforeIds.has(f.id) && sameFish(caught.event,f));
      const competing = [...catches.values()].filter(other=>sameFish(other.event,caught.event));
      if (matching.length === 1 && competing.length === 1 && amount(matching[0].price) !== null)
        finishCatch(token,matching[0].price);
    }
    bag = new Map(items.map(f => [f.id, {f:f.f,w:f.w,len:f.len,price:amount(f.price)}]));
    bagKnown = true;
    pendingFish = payload.pend ? {f:payload.pend.f,w:payload.pend.w,len:payload.pend.len,price:amount(payload.pend.price)} : null;
    fromPending(pendingFish);
  };
  const report = (count, fish, total, automatic = false, stopped = "", released = false) => {
    if (!Number.isSafeInteger(count) || count <= 0) {
      if (stopped === "cap") log.info("Câu Cá: Đã chạm hạn mức bán hôm nay hoặc phần hạn mức còn lại không đủ bán cá đã chọn.");
      return;
    }
    const groups = new Map();
    let unknown = count;
    for (const item of fish.slice(0,count)) {
      if (item?.price === null || item?.price === undefined) continue;
      groups.set(item.price, (groups.get(item.price) || 0) + 1); unknown--;
    }
    const parts = [...groups].sort((a,b)=>a[0]-b[0]).map(([price,n])=>"+"+number(price)+": "+number(n)+" cá");
    if (unknown) parts.push("chưa rõ: "+number(unknown)+" cá");
    const earned = amount(total);
    log.info("Câu Cá: " + (released ? "Đã thả " : automatic ? "Tự bán " : "Đã bán ") + number(count) +
      " cá (ngư lực: " + parts.join("; ") + ")" + (released ? "." : " · " +
      (earned === null ? "chưa rõ số Linh Thạch thu được." : "thu "+number(earned)+" Linh Thạch.")) +
      (stopped === "cap" ? " Đã chạm hạn mức bán hôm nay." : ""));
  };
  return {
    reset,
    caught(event) {
      reeling = false;
      if (typeof event?.kind === "string" && event.kind !== "FISH") {
        log.info(formatFishingCatch(event)); return null;
      }
      if (amount(event?.price) !== null) { log.info(formatFishingCatch(event)); return null; }
      const got = lastGot?.cycle === cycle && now()-lastGot.at < 5000 ? lastGot.id : null;
      if (got === null && lastAuto?.cycle === cycle && lastAuto.f === event?.f && now()-lastAuto.at < 5000) {
        log.info(formatFishingCatch({...event,price:lastAuto.price})); return null;
      }
      if (got === null && lastPending?.cycle === cycle && now()-lastPending.at < 5000 && sameFish(event,lastPending.fish)) {
        log.info(formatFishingCatch({...event,price:lastPending.fish.price})); return null;
      }
      if (!sameFish(event,event)) { log.info(formatFishingCatch(event)); return null; }
      while (catches.size >= 16) finishCatch(catches.keys().next().value);
      const token = ++catchSequence;
      catches.set(token,{event,cycle,got,beforeIds:bagKnown ? new Set(bag.keys()) : null});
      return token;
    },
    finishCatch,
    sent(raw) {
      const packet = decode(raw,"42");
      if (!packet?.ack || self === null) return;
      const [name, action] = packet.data;
      if (name !== "g:act" || !["bag","sell","release","settle"].includes(action?.a)) return;
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
        if (!result || typeof result !== "object" || Array.isArray(result)) return;
        if (request.action === "sell") {
          const sold = Array.isArray(result.sold) ? [...new Set(result.sold.filter(id))] : [];
          // sold is authoritative, not the requested count or the remaining bag size.
          if (!Array.isArray(result.sold) && result.ok === true && amount(result.total) > 0)
            log.info("Câu Cá: Đã bán cá (chưa rõ số cá và ngư lực từng con) · thu " + number(result.total) + " Linh Thạch." +
              (result.stop === "cap" ? " Đã chạm hạn mức bán hôm nay." : ""));
          else report(sold.length, sold.map(key=>request.items.get(key)), result.total, false, result.stop);
          for (const key of sold) bag.delete(key);
        } else if (request.action === "release" && result.ok === true) {
          const released = amount(result.released);
          // A count-only partial receipt does not identify which requested fish left.
          const fish = released === request.items.size ? [...request.items.values()] : [];
          report(released, fish, null, false, "", true);
          if (released === request.items.size) for (const key of request.items.keys()) bag.delete(key);
        } else if (request.action === "settle" && request.how === "sell" && result.ok === true) {
          report(1,[request.fish],result.total);
          pendingFish = null;
        }
        if (result.ok || Array.isArray(result.sold)) rememberBag(result);
        if (["bag","sell","release"].includes(request.action)) return {
          action: request.action,
          ok: result.ok === true,
          stop: request.action === "sell" && result.stop === "cap" ? "cap" : null,
          soldCount: request.action === "sell" && Array.isArray(result.sold) ?
            new Set(result.sold.filter(id)).size : null,
          released: request.action === "release" ? amount(result.released) : null,
          remainingAllowance: amount(result.wallet?.fish?.room),
          at: now(),
        };
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
          if (!reeling) { cycle++; lastAuto = null; lastPending = null; lastGot = null; }
          reeling = true;
        }
        if (event.type === "catch" || event.type === "escaped" || (event.type === "st" && event.s === "idle"))
          reeling = false;
        if (event.type === "bag" && id(event.got) && cycle > 0) {
          // Chrome capture: got is the exact newly stored ID; it contains no price.
          lastGot = {cycle,id:event.got,at:now()};
          const matching = [...catches.values()].filter(caught=>caught.cycle === cycle);
          if (matching.length === 1) matching[0].got = event.got;
        }
        if (event.type === "bag" && amount(event.pend?.price) !== null) {
          lastPending = {cycle,fish:event.pend,at:now()};
          fromPending(event.pend);
        }
        if (event?.type !== "bag" || event.sync || event.auto?.how !== "sold" ||
            cycle === 0 || autoCycle === cycle || (event.uid !== undefined && event.uid !== self)) continue;
        autoCycle = cycle;
        if (event.auto.now === true && amount(event.auto.price) !== null) {
          lastAuto = {cycle,f:event.auto.f,price:event.auto.price,at:now()};
          const matching = [...catches].filter(([,caught])=>caught.got === null && caught.cycle === cycle && caught.event.f === event.auto.f);
          if (matching.length === 1) finishCatch(matching[0][0],event.auto.price);
        }
        report(1,[{price:amount(event.auto.price)}],event.auto.price,true);
      }
    },
  };
}
