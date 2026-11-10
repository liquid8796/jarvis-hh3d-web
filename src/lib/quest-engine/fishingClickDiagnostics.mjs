/**
 * Passive evidence for FAILED hook clicks only. No retries, page mutations, socket data,
 * URLs, element IDs/attributes/text, or uploads. A process-wide instance serves all jobs.
 */
import { mkdir, lstat, writeFile } from "node:fs/promises";
import path from "node:path";

export const FISHING_HOOK_SELECTOR = ".fish-room .fish-main.st-bite.jvz-fish-press";
const INTERVAL_MS = 60_000;
const BUDGET_MS = 800;
const MAX_IMAGE_BYTES = 96_000;
const RING_SIZE = 4;

/** Keep the chronological actionability trace, but emit only known-safe vocabulary.
 * HTML previews, arbitrary selectors, URLs, credentials and unknown details never survive.
 */
export function sanitizeFishingClickError(error) {
  let message = "";
  try { message = typeof error === "string" ? error : typeof error?.message === "string" ? error.message : ""; }
  catch { /* hostile/nonstandard error object */ }
  const input = message.slice(0, 64_000).split("\n");
  const safe = [];
  for (const raw of input.slice(0, 100)) {
    let line = raw.replace(/\u001b\[[0-9;]*m/g, "").trim().replace(/^-\s*/, "");
    const repeat = line.match(/^(\d{1,5})\s*×\s*/);
    if (repeat) line = line.slice(repeat[0].length);
    if (!line) continue;
    let detail = "[redacted Playwright detail]";
    const timeout = line.match(/^(?:page|locator)\.click: Timeout (\d{1,7})ms exceeded\.$/);
    const wait = line.match(/^waiting (\d{1,7})ms$/);
    const retry = line.match(/^retrying click action(?:, attempt #(\d{1,5}))?$/);
    if (timeout) detail = "click: Timeout " + timeout[1] + "ms exceeded.";
    else if (/^Call log:$/i.test(line)) detail = "Call log:";
    else if (/^waiting for locator\(/.test(line)) detail = "waiting for fishing hook locator";
    else if (/^locator resolved to /.test(line)) detail = "locator resolved to [element preview redacted]";
    else if (line.endsWith(" intercepts pointer events")) detail = "[element preview redacted] intercepts pointer events";
    else if (/^element was detached from the DOM, retrying$/.test(line)) detail = line;
    else if (/^(?:attempting click action|waiting for element to be visible, enabled and stable|element is visible, enabled and stable|element is not (?:visible|enabled|stable)|element is outside of the viewport|scrolling into view if needed|done scrolling|performing click action|click action done|waiting for scheduled navigations to finish|navigations have finished)$/.test(line)) detail = line;
    else if (/Target page, context or browser has been closed$/.test(line)) detail = "page, context or browser closed";
    else if (wait) detail = "waiting " + wait[1] + "ms";
    else if (retry) detail = "retrying click action" + (retry[1] ? ", attempt #" + retry[1] : "");
    safe.push((repeat ? repeat[1] + " x " : "") + detail);
  }
  if (input.length > 100 || message.length > 64_000) safe.push("[call log truncated at safety limit]");
  return safe.join("\n") || "[unavailable Playwright detail]";
}

/** Browser-side fixed-budget observation. Never return text, arbitrary class names or attributes. */
function observeFishingControl() {
  const button = document.querySelector(".fish-room .fish-main");
  const number = value => Number.isFinite(value) && Math.abs(value) <= 1e7 ? Math.round(value * 10) / 10 : null;
  const rect = el => {
    const r = el.getBoundingClientRect();
    return { x: number(r.x), y: number(r.y), width: number(r.width), height: number(r.height) };
  };
  const describe = el => {
    if (!el) return null;
    const css = getComputedStyle(el);
    const tags = ["button", "div", "span", "input", "textarea", "select", "iframe", "dialog", "body", "html", "svg", "canvas"];
    const tag = el.tagName.toLowerCase();
    return {
      tag: tags.includes(tag) ? tag : "other",
      states: ["st-idle", "st-load", "st-wait", "st-bite", "st-reel", "jvz-fish-press",
        "sheet", "pl-gate", "pl-go", "bt-wrap", "fish-spec"].filter(name => el.classList.contains(name)),
      connected: el.isConnected,
      enabled: !el.matches(":disabled") && el.getAttribute("aria-disabled") !== "true",
      display: ["none", "block", "inline", "inline-block", "flex", "grid", "contents"].includes(css.display) ? css.display : "other",
      visibility: ["visible", "hidden", "collapse"].includes(css.visibility) ? css.visibility : "other",
      pointerEvents: css.pointerEvents === "none" ? "none" : "auto",
      opacity: number(Number(css.opacity)),
      bounds: rect(el),
      hasClientRects: el.getClientRects().length > 0
    };
  };
  const state = describe(button);
  const r = state?.bounds;
  const center = r && Object.values(r).every(v => v !== null) ?
    { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
  const hit = center ? document.elementFromPoint(center.x, center.y) : null;
  // Avoid screenshot masking on huge pages. This walk never visits more than 401 elements.
  const walker = document.createTreeWalker(document.documentElement, NodeFilter.SHOW_ELEMENT);
  let count = 0, node = document.documentElement, safeVisuals = true;
  do {
    // Light-DOM masks cannot prove generated/background/shadow pixels are private.
    // Fail closed, even when the suspicious element is outside the crop.
    if (node.shadowRoot || node.tagName.includes("-")) safeVisuals = false;
    for (const pseudo of [null, "::before", "::after"]) {
      const css = getComputedStyle(node, pseudo);
      if (/url\s*\(|image-set\s*\(/i.test(css.backgroundImage) ||
          !["none", "normal", '""', "''"].includes(css.content)) safeVisuals = false;
    }
    count++;
  } while (count <= 400 && (node = walker.nextNode()));
  let clip = null;
  if (button && r && Object.values(r).every(v => v !== null) && r.width > 0 && r.height > 0 &&
      r.width <= 300 && r.height <= 160 && r.x >= 0 && r.y >= 0 &&
      r.x + r.width <= innerWidth && r.y + r.height <= innerHeight && count <= 400 && safeVisuals) {
    const x = Math.max(0, Math.floor(r.x - 6)), y = Math.max(0, Math.floor(r.y - 6));
    clip = { x, y, width: Math.min(innerWidth, Math.ceil(r.x + r.width + 6)) - x,
      height: Math.min(innerHeight, Math.ceil(r.y + r.height + 6)) - y };
  }
  return {
    visibilityState: document.visibilityState === "visible" ? "visible" : "hidden",
    button: state,
    hitTest: { acceptsPointer: !!button && !!hit && (hit === button || button.contains(hit)), element: describe(hit) },
    screenshotSafety: safeVisuals && count <= 400 ? "safe" : "unsafe-visuals-or-size",
    clip
  };
}

/** Treat the main-world result as untrusted. Rebuild a small fixed schema in Node. */
function sanitizeObservation(value) {
  const pick = (v, allowed) => allowed.includes(v) ? v : "unknown";
  const num = v => typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= 1e7 ? Math.round(v * 10) / 10 : null;
  const bool = v => typeof v === "boolean" ? v : null;
  const rect = v => ({ x: num(v?.x), y: num(v?.y), width: num(v?.width), height: num(v?.height) });
  const element = v => {
    if (!v || typeof v !== "object") return null;
    const states = Array.isArray(v.states) ? v.states.slice(0, 20) : [];
    return {
      tag: pick(v.tag, ["button", "div", "span", "input", "textarea", "select", "iframe", "dialog", "body", "html", "svg", "canvas", "other"]),
      states: ["st-idle", "st-load", "st-wait", "st-bite", "st-reel", "jvz-fish-press",
        "sheet", "pl-gate", "pl-go", "bt-wrap", "fish-spec"].filter(name => states.includes(name)),
      connected: bool(v.connected), enabled: bool(v.enabled), hasClientRects: bool(v.hasClientRects),
      display: pick(v.display, ["none", "block", "inline", "inline-block", "flex", "grid", "contents", "other"]),
      visibility: pick(v.visibility, ["visible", "hidden", "collapse", "other"]),
      pointerEvents: pick(v.pointerEvents, ["none", "auto"]),
      opacity: typeof v.opacity === "number" && v.opacity >= 0 && v.opacity <= 1 ? num(v.opacity) : null,
      bounds: rect(v.bounds)
    };
  };
  const result = {
    visibilityState: pick(value?.visibilityState, ["visible", "hidden"]),
    button: element(value?.button),
    hitTest: { acceptsPointer: bool(value?.hitTest?.acceptsPointer), element: element(value?.hitTest?.element) },
    screenshotSafety: pick(value?.screenshotSafety, ["safe", "unsafe-visuals-or-size"]),
    clip: null
  };
  const c = rect(value?.clip), b = result.button?.bounds;
  if (result.screenshotSafety === "safe" && b &&
      Object.values(c).every(v => v !== null) && Object.values(b).every(v => v !== null) &&
      c.x >= 0 && c.y >= 0 && c.width > 0 && c.width <= 312 && c.height > 0 && c.height <= 172 &&
      b.width > 0 && b.width <= 300 && b.height > 0 && b.height <= 160 &&
      c.x <= b.x && b.x - c.x <= 7 && c.y <= b.y && b.y - c.y <= 7 &&
      c.x + c.width >= b.x + b.width && c.x + c.width - b.x - b.width <= 7 &&
      c.y + c.height >= b.y + b.height && c.y + c.height - b.y - b.height <= 7)
    result.clip = c;
  return result;
}

/**
 * Fixed filenames bound disk usage across worker restarts (four <=96KB PNGs + small JSON).
 * Runtime cwd is the repo root or packaged worker directory. No timestamp/player filenames.
 * Options also allow isolated offline tests, without changing the active worker directory.
 */
export function createFishingClickDiagnostics({ directory = path.resolve("diagnostics", "fishing"), now = Date.now } = {}) {
  let lastCapture = -Infinity;
  let inFlight = false;
  return {
    async capture(page, error) {
      if (inFlight) return { status: "busy" };
      try { if (page.isClosed?.()) return { status: "closed" }; } catch { return { status: "closed" }; }
      const current = now();
      if (current - lastCapture < INTERVAL_MS) return { status: "throttled" };
      lastCapture = current;
      inFlight = true;
      let expired = false;
      let timer;
      const slot = ((Math.floor(current / INTERVAL_MS) % RING_SIZE) + RING_SIZE) % RING_SIZE;
      const recordName = "hook-" + slot + ".json", imageName = "hook-" + slot + ".png";
      const record = {
        schema: 1, capturedAt: new Date(current).toISOString(), callLog: sanitizeFishingClickError(error),
        observationStatus: "pending", observation: null, screenshot: null,
        screenshotNote: "Text, forms, media and unrelated elements are masked; image may be mostly blank."
      };
      let documentChanged = false;
      const onClose = () => { documentChanged = true; };
      const onNavigation = frame => {
        if (!page.mainFrame || frame === page.mainFrame()) documentChanged = true;
      };
      const detach = () => {
        try { page.off?.("framenavigated", onNavigation); page.off?.("close", onClose); } catch {}
      };
      try { page.on?.("framenavigated", onNavigation); page.on?.("close", onClose); }
      catch { detach(); inFlight = false; return { status: "unavailable" }; }
      // Do not release inFlight on timeout: one stuck browser read must never accumulate
      // new pending evaluations/screenshots on later failures. A late result is discarded.
      const work = (async () => {
        try {
          await mkdir(directory, { recursive: true });
          if (expired || !(await lstat(directory)).isDirectory() || (await lstat(directory)).isSymbolicLink()) return { status: "unavailable" };
          for (const name of [recordName, imageName]) {
            const existing = await lstat(path.join(directory, name)).catch(e => {
              if (e.code !== "ENOENT") throw e;
              return null;
            });
            if (existing && (!existing.isFile() || existing.isSymbolicLink())) return { status: "unavailable" };
          }
          if (expired) return { status: "timeout" };
          // Clear only our reused image slot. A failed new capture must not point at an old image.
          await writeFile(path.join(directory, imageName), Buffer.alloc(0), { mode: 0o600 });
          if (expired) return { status: "timeout" };
          await writeFile(path.join(directory, recordName), JSON.stringify(record, null, 2) + "\n", { mode: 0o600 });
          if (expired) return { status: "timeout" };
          try {
            const observation = await page.evaluate(observeFishingControl);
            if (expired) return { status: "timeout" };
            record.observation = sanitizeObservation(observation);
            record.observationStatus = "observed";
          } catch {
            if (expired) return { status: "timeout" };
            record.observationStatus = "unavailable";
          }
          const clip = record.observation?.clip;
          if (clip && !documentChanged) {
            try {
              const png = await page.screenshot({
                type: "png", fullPage: false, clip, scale: "css", timeout: 300,
                animations: "allow", // never finish/cancel the game's CSS animations
                maskColor: "#303030",
                mask: [
                  page.locator("xpath=//*[text()[normalize-space(.)!='']]"),
                  page.locator("input, textarea, select, [contenteditable], iframe, img, svg, canvas, video, audio, object, embed"),
                  page.locator("body *:not(:has(.fish-main)):not(.fish-main):not(.fish-main *)"),
                  page.locator("body:not(:has(.fish-room .fish-main))")
                ]
              });
              if (expired) return { status: "timeout" };
              if (documentChanged) record.screenshotNote = "Discarded: page navigated or closed during capture.";
              else if (Buffer.isBuffer(png) && png.length <= MAX_IMAGE_BYTES) {
                await writeFile(path.join(directory, imageName), png, { mode: 0o600 });
                record.screenshot = imageName;
              } else record.screenshotNote = "Skipped: image exceeds safety size limit.";
            } catch { record.screenshotNote = "Unavailable: masked screenshot failed or timed out."; }
          } else record.screenshotNote = "Skipped: unsafe visuals, invalid crop, missing control, or changed document.";
          if (expired) return { status: "timeout" };
          await writeFile(path.join(directory, recordName), JSON.stringify(record, null, 2) + "\n", { mode: 0o600 });
          return { status: "saved", record: recordName, image: record.screenshot };
        } catch { return { status: "unavailable" }; }
        finally { inFlight = false; }
      })();
      const deadline = new Promise(resolve => {
        timer = setTimeout(() => { expired = true; resolve({ status: "timeout" }); }, BUDGET_MS);
      });
      try { return await Promise.race([work, deadline]); }
      finally { clearTimeout(timer); detach(); }
    }
  };
}

const sharedDiagnostics = createFishingClickDiagnostics();

/** The only hook used by session.mjs. Fail-open even if the logger itself throws. */
export async function diagnoseFishingHookFailure(page, error, log) {
  try {
    const trace = sanitizeFishingClickError(error);
    const reasons = [...new Set(trace.split("\n").filter(line =>
      /Timeout|not stable|not visible|not enabled|intercepts pointer events|outside of the viewport|detached|closed/.test(line)))];
    try { log.debug("Fishing hook click failed: " + (reasons.join(" | ") || "actionability detail unavailable")); } catch {}
    const result = await sharedDiagnostics.capture(page, error);
    try {
      log.debug("Fishing hook diagnostics: " + result.status +
        (result.record ? "; local diagnostics/fishing/" + result.record : ""));
    } catch {}
  } catch { /* Diagnostics must not replace the original failed-click result. */ }
}

