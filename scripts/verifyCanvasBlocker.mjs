import assert from "node:assert/strict";
import { getCanvasBlockerInitScript } from "./obscuraCanvasBlocker.mjs";

const script = getCanvasBlockerInitScript(12345);
assert.ok(typeof script === "string" && script.length > 500, "Script must be a non-empty string");
assert.match(script, /__obscura_canvas_blocker__/, "Script must define flag");
assert.match(script, /getImageData/, "Script must patch getImageData");
assert.match(script, /toDataURL/, "Script must patch toDataURL");
assert.match(script, /toBlob/, "Script must patch toBlob");
assert.match(script, /readPixels/, "Script must patch readPixels");
assert.match(script, /\[native code\]/, "Script must mask function string representation");

// Kiểm tra cú pháp hợp lệ bằng Function constructor
const fn = new Function(script);
assert.equal(typeof fn, "function", "Init script must be valid JavaScript syntax");

console.log("PASS: obscuraCanvasBlocker produces valid anti-fingerprinting init script.");
