# REA evidence: Tiên Giới Vào Ngay gateway (2026-11-05)

- User-provided logs: fishing enters a room, toggles auto sale, registers cast 1, then reports a 150-second stall.
- Live page: https://hoathinh3d.pw/game/
- Shipped entry module: game/assets/chunks/preload-gate-O4IU7EXX.js
- SHA-256: ae0f8d11f89fa9f1840abaec3c078a09cd9ceda91fef25b8ebccedc118edc7af
- REA CLI analyzed this asset together with the active fish bundle as inert JavaScript. Static semantic graph partial; direct function text and live DOM provide additional proof.
- On page load the visible .pl-gate contains button.pl-go (Vào Ngay), inside the preloader .bt-wrap. The underlying .view.hub and .launcher-btn are already present and accessible to document.querySelector, despite being covered.
- Source: m.onclick is bound to a function that calls o.enter(), which removes the loader. We verified in Chrome that activating Vào Ngay makes .pl-gate and .bt-wrap disappear.
- Old controller called Element.click() on hidden hub menu and room entries, bypassing actual pointer hit-testing. Since a real mouse cannot reach the underlying fish button, the later cast/reel can stall. Keyboard Space could nevertheless cast through window handlers, amplifying false success.
- Fix: detect any visible preloader before opening the fish room; use an explicit trusted click on .pl-go; confirm its removal on subsequent ticks. Defense in depth rejects native cast and reel while loader is present.
- Scope: both normal and VIP, Web/GitHub workers and local PC source. No forged Socket.IO packets.
- Verify using scripts/verifyFishingController.mjs, scripts/verifyFishingCast.mjs and scripts/verifyFishingQuest.mts. A full successful catch in live production is not asserted by static analysis or these browser fixtures.
