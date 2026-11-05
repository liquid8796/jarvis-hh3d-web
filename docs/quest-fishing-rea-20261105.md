# Tiên Giới fishing — REA analysis, 2026-11-05

## Shipped source evidence
- Game: https://hoathinh3d.pw/game/
- Source: game/assets/chunks/fish-TLBXRWCJ.js
- Source SHA-256: 7598abb83f6bdfd35a0fbbb5a866a5d037e39bb7a7cd76ef2c551a91d22b47c3
- REA analyze_javascript_application: 5 parsed JS files, 190,772 source bytes, 63,124 AST nodes, 434 findings. Semantic graph status is partial, not complete.
- Source and adjacent dependencies retained locally in .tmp-watch/rea-fishing-20261105.

## Game logic and conditions observed
- button.fish-main.st-idle has pointerdown handler fa and pointerup handler async _i. No ordinary DOM click handler casts.
- Ge(event) permits only trusted events (rejects isTrusted=false).
- fa returns without preparing the cast when spectator/scene gates fail, or the local angler / spot To() is unavailable. When eligible it stores a pointer state Bt.
- _i requires prior Bt, a valid angler, selected fishing spot mt and phase idle; it transmits g:act with action cast and x/y. A failed server reply can revert to idle.
- Window Space keydown/keyup calls fa/_i through the game's own input handlers and is a legitimate keyboard fallback.
- Hook path Ec sends g:act with action hook. A long generic human delay can miss the transient bite phase.
- Reel inputs are g:input, and the live compact -3 snapshots were addressed in 1.3.232. The source also exposes legacy/-2 variants and advanced duel/pull/line modes.

## Quest failure and changes
- Previously fishingTick.js set pendingCast=true before Playwright had actually emitted or the game had accepted a cast, resulting in fictional 12s wait loops.
- The new Web driver sends native mouse press/release, watches client state and outgoing cast frames, and falls back to native Space when no cast was emitted. Only an observed state change marks the cast pending.
- Failed attempts clear pending state and report the concrete failure with retry backoff, avoiding useless idle waits.
- Web and PC fishing skips generic humanDelay for both VIP and standard fishing, preserving delays on other quests.
- Browser regressions cover trusted pointer, keyboard fallback, input failure and hook timing.

## Limitations
- REA saw shipped client source, not server validation. The precise reason for any specific rejected cast may still require a live server reply.
- Regression confirms browser-side input, not a successful real-fish catch. New worker code takes effect on subsequent GitHub Actions runs.
