/* Maze participant: runs inside the authenticated game page through the existing
   quest-engine evaluateJavaScript action. No direct authenticated fetch/write API. */
() => {
  const now = Date.now();
  const key = '__jvz_maze_participant_state';
  const chestKey = '__jvz_mc_participant_chest';
  const mode = '{{mode}}'.replace(/^is-/, '');
  const code = '{{roomCode}}'.replace(/\D/g, '').slice(0, 6);
  const waitSec = Math.max(30, Math.min(3600, Number('{{hostWaitSec}}') || 180));
  const checkCap = !'{{capCheck}}'.includes('\u00ab');
  const visible = (el) => {
    if (!el || !el.isConnected) return false;
    for (let at = el; at && at.nodeType === 1; at = at.parentElement) {
      if (at.hidden || at.classList.contains('hidden')) return false;
    }
    const style = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && r.width > 0 && r.height > 0;
  };
  const get = (selector) => document.querySelector(selector);
  const body = document.body;
  if (!body) return '';
  for (const cls of ['jvz-mc-join-target','jvz-mc-join-ready','jvz-mc-join-leave','jvz-mc-join-confirm','jvz-mc-join-next','jvz-mc-join-attack','jvz-mc-join-auto-ready','jvz-mc-join-auto-next','jvz-mc-join-auto-chest']) {
    document.querySelectorAll('.' + cls).forEach(el => el.classList.remove(cls));
  }
  let state = {};
  try { state = JSON.parse(sessionStorage.getItem(key) || '{}') || {}; } catch (_) {}
  if (typeof state !== 'object' || !state) state = {};
  if (!state.avoided || typeof state.avoided !== 'object') state.avoided = {};
  if (state.mode !== mode || state.requestedCode !== code ||
      !Number.isFinite(state.startedAt) || now - state.startedAt > 45 * 60_000) {
    state = {mode, requestedCode: code, startedAt: now, avoided: {}, room: '', waitingAt: 0, lastJoinAt: 0, lastRefreshAt: 0};
  }
  const save = () => { try { sessionStorage.setItem(key, JSON.stringify(state)); } catch (_) {} };
  const avoid = (value) => {
    // A kick/disband/AFK exit always requires another room, including when
    // the original room was selected by its explicit six-digit code.
    if (value) state.avoided[value] = now + 90_000;
  };
  const roomCode = () => String(get('#room-code')?.textContent || '').replace(/\D/g, '').slice(0, 6) || state.room;
  const chest = (() => {
    try { return JSON.parse(sessionStorage.getItem(chestKey) || 'null'); }
    catch (_) { return null; }
  })();

  // Observe only the authoritative boss-5 chest result. Preserve fetch and its response.
  if (!window.__jvzMcJoinChestHook && typeof window.fetch === 'function') {
    const original = window.fetch;
    window.fetch = function(input) {
      const promise = original.apply(this, arguments);
      try {
        const url = String(input && input.url ? input.url : (input || ''));
        if (!url.includes('/me-cung/v1/claim-boss5-chest')) return promise;
        return promise.then(response => {
          try {
            response.clone().json().then(data => {
              const reward = data && data.reward;
              if (reward) sessionStorage.setItem(chestKey, JSON.stringify({
                total: Number(reward.huyen_tinh_daily_total) || 0,
                cap: Number(reward.huyen_tinh_daily_cap) || 0,
                at: Date.now()
              }));
            }).catch(() => {});
          } catch (_) {}
          return response;
        });
      } catch (_) { return promise; }
    };
    window.__jvzMcJoinChestHook = true;
  }

  const room = visible(get('#room-panel'));
  const lobby = visible(get('#lobby-overview'));
  const battle = visible(get('#screen-battle')) || visible(get('#party-battle-panel'));
  const totalText = String(get('.mc-ht-daily-text')?.textContent || '');
  const numbers = totalText.match(/(\d[\d., ]*)\s*\/\s*(\d[\d., ]*)/);
  const total = numbers ? Number(numbers[1].replace(/\D/g,'')) : -1;
  const cap = numbers ? Number(numbers[2].replace(/\D/g,'')) : -1;
  // The chest reward is cached by the page, but the game resets daily on
  // Vietnam time (UTC+7). Yesterday's 300/300 must never stop today's run.
  const vietnamDay = (timestamp) => new Date(timestamp + 7 * 3600_000).toISOString().slice(0, 10);
  const chestAt = Number(chest?.at);
  const sameDayChest = Number.isFinite(chestAt) && chestAt > 0 && chestAt <= now &&
    vietnamDay(chestAt) === vietnamDay(now);
  const dailyFull = (sameDayChest && chest.cap > 0 && chest.total >= chest.cap) ||
    (cap > 0 && total >= cap);

  // Never finish an in-progress boss fight or declare success while a room's
  // leave-confirm dialog remains open. Completing the quest in that state
  // closes the browser before the official leave request has been sent.
  // Keep battle auto-actions running; finish only once back in the lobby.
  if (checkCap && dailyFull && !battle) {
    if (room) {
      state.leaving = true;
      const confirm = get('#confirm-overlay .confirm-btn-ok');
      if (visible(confirm)) confirm.classList.add('jvz-mc-join-confirm');
      else {
        const leave = get('#btn-leave-room');
        if (visible(leave)) leave.classList.add('jvz-mc-join-leave');
      }
      save();
      return '';
    }
    if (lobby) {
      body.classList.add('jvz-mc-join-done');
      save();
      return '';
    }
  }
  body.classList.remove('jvz-mc-join-done');

  // Confirm leaving only for our own AFK/cap exit, not unrelated game dialogs.
  if (state.leaving && visible(get('#confirm-overlay .confirm-btn-ok'))) {
    get('#confirm-overlay .confirm-btn-ok').classList.add('jvz-mc-join-confirm');
    save();
    return '';
  }

  if (lobby && !room && !battle) {
    if (state.room) { avoid(state.room); state.room = ''; state.waitingAt = 0; state.leaving = false; }
    if (now - (state.lastJoinAt || 0) < 7_000) { save(); return ''; }
    const list = get('#room-list');
    // Prefer the entered code initially. If that room kicked us (or failed to
    // start), temporarily fall back to another suitable public room.
    const preferredCode = code && !(state.avoided[code] > now) ? code : '';
    let candidates = [...(list?.querySelectorAll('.room-item') || [])].filter(row => {
      if (!visible(row) || !row.classList.contains('room-item--' + mode)) return false;
      const text = String(row.textContent || '');
      const found = text.match(/Mã\s*#\s*(\d+)/i);
      const id = found ? found[1] : '';
      if (preferredCode && id !== preferredCode) return false;
      if (id && state.avoided[id] > now) return false;
      if (row.classList.contains('is-locked') || row.querySelector('.fa-lock')) return false;
      if (/đang chiến|đã đầy|full/i.test(text)) return false;
      const btn = row.querySelector('button.btn-join-room');
      return visible(btn) && !btn.disabled;
    });
    candidates.sort((a,b) => Number(b.classList.contains('is-join-priority')) -
                               Number(a.classList.contains('is-join-priority')));
    const target = candidates[0];
    if (target) {
      const found = String(target.textContent || '').match(/Mã\s*#\s*(\d+)/i);
      state.pendingCode = found ? found[1] : '';
      target.querySelector('button.btn-join-room').classList.add('jvz-mc-join-target');
      state.lastJoinAt = now;
      save();
      return '';
    }
    if (preferredCode && /^\d{6}$/.test(preferredCode)) {
      const input = get('#room-id-input');
      const quick = get('.room-search-tools button.btn-join-room');
      if (input && visible(quick) && !quick.disabled) {
        const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
        descriptor?.set?.call(input, code);
        input.dispatchEvent(new Event('input', {bubbles: true}));
        quick.classList.add('jvz-mc-join-target');
        state.pendingCode = code;
        state.lastJoinAt = now;
        save();
        return '';
      }
    }
    if (now - (state.lastRefreshAt || 0) > 15000) {
      state.lastRefreshAt = now;
      if (typeof window.manualRefreshLobby === 'function') window.manualRefreshLobby();
    }
    save();
    return '';
  }
  // Site saves toggles per account but they may be OFF on a newly added account.
  // Mark only actionable, visible, currently-off switches. Playwright clicks them.
  if (room) {
    for (const [row, track, cls] of [
      ['#auto-ready-row', '#auto-ready-track', 'jvz-mc-join-auto-ready'],
      ['#auto-next-stage-row', '#auto-next-stage-track', 'jvz-mc-join-auto-next'],
      ['#auto-open-chest-row', '#auto-open-chest-track', 'jvz-mc-join-auto-chest']
    ]) {
      const button = get(row + ' .auto-ready-toggle');
      if (visible(button) && !get(track)?.classList.contains('on')) button.classList.add(cls);
    }
  }
  if (room) {
    const current = roomCode() || state.pendingCode;
    if (current && state.room !== current) {
      state.room = current;
      state.waitingAt = now;
      state.leaving = false;
      state.pendingCode = '';
    }
    if (!state.waitingAt) state.waitingAt = now;
    const readyButton = get('#btn-start');
    const label = String(readyButton?.textContent || '').trim().toUpperCase();
    if (!battle && visible(readyButton) && /SẴN SÀNG/.test(label) && !/HỦY/.test(label)) {
      readyButton.classList.add('jvz-mc-join-ready');
    }
    if (!battle && now - state.waitingAt > waitSec * 1000) {
      avoid(current);
      state.leaving = true;
      const leave = get('#btn-leave-room');
      if (visible(leave)) leave.classList.add('jvz-mc-join-leave');
      save();
      return '';
    }
    if (state.leaving && visible(get('#confirm-overlay .confirm-btn-ok'))) {
      get('#confirm-overlay .confirm-btn-ok').classList.add('jvz-mc-join-confirm');
    }
  }
  if (battle) {
    const attack = get('#auto-attack-track');
    if (visible(attack) && !attack.classList.contains('on')) attack.classList.add('jvz-mc-join-attack');
    state.waitingAt = now;
    state.leaving = false;
    const next = get('#btn-next-stage');
    if (visible(next) && !next.disabled) next.classList.add('jvz-mc-join-next');
  }
  save();
  return '';
}