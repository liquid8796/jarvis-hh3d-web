import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  GOOGLE_TAG_ID,
  GOOGLE_TAG_SCRIPT_SRC,
  googleTagEnabled,
  isOfficialGoogleTagHost,
} from "../src/lib/google-tag/config";

const root = path.join(import.meta.dirname, "..");
const read = (relative: string) => readFile(path.join(root, relative), "utf8");

// 1. Tag ID & Script URL
assert.equal(GOOGLE_TAG_ID, "G-CPEZWQKMNB");
assert.equal(GOOGLE_TAG_SCRIPT_SRC, "https://www.googletagmanager.com/gtag/js?id=G-CPEZWQKMNB");

// 2. Official Host Gating
assert.equal(isOfficialGoogleTagHost("auto-hh3d.online"), true);
assert.equal(isOfficialGoogleTagHost("www.auto-hh3d.online:443"), true);
assert.equal(isOfficialGoogleTagHost("auto-hh3d.vercel.app"), false);
assert.equal(isOfficialGoogleTagHost("158.180.59.36.sslip.io"), false);

// 3. Environment & Disabled Switch Gating
assert.equal(googleTagEnabled("auto-hh3d.online", { NODE_ENV: "production" }), true);
assert.equal(googleTagEnabled("www.auto-hh3d.online:443", { NODE_ENV: "production" }), true);
assert.equal(googleTagEnabled("auto-hh3d.vercel.app", { NODE_ENV: "production" }), false);
assert.equal(googleTagEnabled("158.180.59.36.sslip.io", { NODE_ENV: "production" }), false);
assert.equal(googleTagEnabled("auto-hh3d.online", { NODE_ENV: "development" }), false);
assert.equal(googleTagEnabled("auto-hh3d.online", { NODE_ENV: "development", GOOGLE_TAG_DEV: "1" }), true);
assert.equal(googleTagEnabled("auto-hh3d.online", { NODE_ENV: "production", GOOGLE_TAG_DISABLED: "1" }), false);

// 4. Component & Layout Verification
const [layout, component, envExample, packageJson] = await Promise.all([
  read("src/app/layout.tsx"),
  read("src/components/GoogleTag.tsx"),
  read(".env.example"),
  read("package.json"),
]);

assert.ok(layout.includes('import { GoogleTag } from "@/components/GoogleTag";'));
assert.ok(layout.includes("<head>\n        <GoogleTag />") || layout.includes("<head>\r\n        <GoogleTag />"));
assert.ok(component.includes("GOOGLE_TAG_SCRIPT_SRC"));
assert.ok(component.includes("window.dataLayer = window.dataLayer || [];"));
assert.ok(component.includes("function gtag(){dataLayer.push(arguments);}"));
assert.ok(component.includes("gtag('js', new Date());"));
assert.ok(component.includes("gtag('config', '${GOOGLE_TAG_ID}');"));
assert.ok(envExample.includes('GOOGLE_TAG_DISABLED="0"'));
assert.equal(JSON.parse(packageJson).scripts["verify:google-tag"], "tsx scripts/verifyGoogleTag.mts");

console.log("PASS: Google Tag ID, script src, host gating, component markup and layout placement verified.");
