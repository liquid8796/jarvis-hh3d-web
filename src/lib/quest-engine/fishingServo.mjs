/**
 * Site physics confirmed against the live fish bundle and 577 g:snap packets:
 * 66ms integration, acceleration +2.6 while held / -2.2 while released,
 * and exponential drag 2.5. A short lookahead compensates for inertia.
 * Never sends packets or modifies the game; trusted Playwright input does that.
 */
export function chooseFishingHold(s, {velocity = 0, last = null, lastSwitchedAt = 0, now = Date.now(), lookaheadSeconds = .26} = {}) {
 if (![s.z,s.f,s.zone].every(Number.isFinite)) return false;
 const zone = Math.max(.06, Math.min(.8, s.zone));
 const h = Math.max(.18, Math.min(.52, lookaheadSeconds));
 const fish = Math.max(.02, Math.min(.98, s.f + Math.max(-.5, Math.min(.5, s.fv || 0)) * h));
 function predict(hold) {
   let z=s.z, v=Math.max(-1.6,Math.min(1.6,velocity));
   for(let i=0;i<4;i++) {
     const dt=h/4;
     v += (hold?2.6:-2.2)*dt;
     v *= Math.exp(-2.5*dt);
     z = Math.max(zone/2,Math.min(1-zone/2,z+v*dt));
   }
   return z;
 }
 const upDist=Math.abs(predict(true)-fish),downDist=Math.abs(predict(false)-fish);
 const preferred=upDist<downDist;
 // The site's anti-tap rule flags 4 sub-150ms holds in 2s.
 if(last!==null&&preferred!==last&&lastSwitchedAt>0&&now-lastSwitchedAt<175
    &&Math.abs(s.f-s.z)<zone*.8) return last;
 return preferred;
}

/**
 * Socket.IO Engine.IO text frame observed in Câu Cá recording:
 * 42["g:snap",{"t":0.07,"z":0.51,"f":0.5,"fv":-0.002,"p":0.313,"zone":0.336}]
 * g:snap is local player state, not other players' world snapshots.
 */
export function parseFishingSnapshotFrame(raw) {
  const frame = typeof raw === "string" ? raw : raw?.toString?.();
  if (!frame?.startsWith('42["g:snap",')) return null;
  try {
    const [name, snap] = JSON.parse(frame.slice(2));
    if (name !== "g:snap" || !snap || typeof snap !== "object") return null;
    if (![snap.t, snap.z, snap.f, snap.zone, snap.p].every((n) =>
      typeof n === "number" && Number.isFinite(n))) return null;
    return { t: snap.t, z: snap.z, f: snap.f, fv: Number.isFinite(snap.fv) ? snap.fv : 0,
      zone: snap.zone, p: snap.p, inside: snap.in === 1 };
  } catch { return null; }
}

/**
 * Estimate relative transport lag without assuming synchronized clocks.
 * The lowest (arrivalMs - serverTimeMs) for a fishing fight is the baseline;
 * excursions above it reveal delayed/batched packets in real recordings.
 * This cannot measure the absolute one-way internet latency.
 *
 * Old frames must never override new ones, and absent telemetry must never
 * leave an untrusted continuous hold in place. All decisions remain read-only;
 * only the outer Playwright driver sends trusted mouse events.
 */
export function createFishingTelemetry() {
  let latest = null;
  let velocity = 0;
  let minOffsetMs = Infinity;

  return {
    ingest(raw, receivedAt = Date.now()) {
      const snap = parseFishingSnapshotFrame(raw);
      if (!snap || !Number.isFinite(receivedAt)) return false;
      if (latest && snap.t <= latest.t) {
        // Server's per-fight clock restarts when a NEW fish is hooked.
        // Small backwards steps are out-of-order frames, not a reset.
        if (latest.t > 1.5 && snap.t < .4 && latest.t - snap.t > 1) {
          latest = null;
          velocity = 0;
          minOffsetMs = Infinity;
        } else {
          return false;
        }
      }

      const offsetMs = receivedAt - snap.t * 1000;
      minOffsetMs = Math.min(minOffsetMs, offsetMs);
      const networkLagMs = Math.max(0, offsetMs - minOffsetMs);
      if (networkLagMs > 520) return false; // late queued packet: ignore

      if (latest && snap.t > latest.t && snap.t - latest.t < .4) {
        velocity = Math.max(-1.6, Math.min(1.6,
          (snap.z - latest.z) / (snap.t - latest.t)));
      } else {
        velocity = 0;
      }
      latest = { ...snap, receivedAt, networkLagMs };
      return true;
    },

    current(now = Date.now()) {
      if (!latest || !Number.isFinite(now)) return null;
      const ageMs = Math.max(0, now - latest.receivedAt);
      const effectiveLagMs = ageMs + latest.networkLagMs;
      // Recording 141700: p99 skew ~250ms, worst burst ~400ms.
      // Release during a burst instead of continuing on a stale position.
      if (ageMs > 340 || effectiveLagMs > 450) return null;
      return {
        ...latest,
        velocity,
        ageMs,
        effectiveLagMs,
        lookaheadSeconds: Math.min(.52, .26 + Math.min(.24, effectiveLagMs / 1000))
      };
    }
  };
}
