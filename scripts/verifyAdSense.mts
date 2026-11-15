import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile, access } from "node:fs/promises";
import path from "node:path";
import {
  GOOGLE_ADSENSE_ADS_TXT_LINE,
  GOOGLE_ADSENSE_CLIENT_ID,
  GOOGLE_ADSENSE_PUBLISHER_ID,
  GOOGLE_ADSENSE_SCRIPT_SRC,
  googleAdSenseEnabled,
} from "../src/lib/adsense/config";

const root = path.join(import.meta.dirname, "..");
const read = (relative: string) => readFile(path.join(root, relative), "utf8");

assert.equal(GOOGLE_ADSENSE_PUBLISHER_ID, "pub-7851683096379872");
assert.equal(GOOGLE_ADSENSE_CLIENT_ID, "ca-pub-7851683096379872");
assert.equal(GOOGLE_ADSENSE_ADS_TXT_LINE, "google.com, pub-7851683096379872, DIRECT, f08c47fec0942fa0");
assert.ok(GOOGLE_ADSENSE_SCRIPT_SRC.endsWith("client=ca-pub-7851683096379872"));

assert.equal(googleAdSenseEnabled("auto-hh3d.online", { NODE_ENV: "production" }), true);
assert.equal(googleAdSenseEnabled("www.auto-hh3d.online:443", { NODE_ENV: "production" }), true);
assert.equal(googleAdSenseEnabled("auto-hh3d.vercel.app", { NODE_ENV: "production" }), false);
assert.equal(googleAdSenseEnabled("158.180.59.36.sslip.io", { NODE_ENV: "production" }), false);
assert.equal(googleAdSenseEnabled("auto-hh3d.online", { NODE_ENV: "development" }), false);
assert.equal(googleAdSenseEnabled("auto-hh3d.online", { NODE_ENV: "production", GOOGLE_ADSENSE_DISABLED: "1" }), false);

const [layout, component, adsTxt, css, proxy, envExample, nextConfig, packageJson, footer] = await Promise.all([
  read("src/app/layout.tsx"),
  read("src/components/GoogleAdSense.tsx"),
  read("public/ads.txt"),
  read("src/app/globals.css"),
  read("src/proxy.ts"),
  read(".env.example"),
  read("next.config.ts"),
  read("package.json"),
  read("src/components/SiteFooter.tsx"),
]);

assert.equal(adsTxt.trim(), GOOGLE_ADSENSE_ADS_TXT_LINE);
assert.ok(layout.includes("<GoogleAdSense />"));
assert.ok(layout.includes("<SiteFooter />"));
assert.ok(footer.includes("t.footer.rights"));
assert.ok(!footer.includes("/quyen-rieng-tu"));
await assert.rejects(access(path.join(root, "src/app/quyen-rieng-tu/page.tsx")), { code: "ENOENT" });
assert.ok(component.includes("google-adsense-account"));
assert.ok(component.includes("isOfficialAdSenseHost(host)"));
assert.ok(component.includes("googleAdSenseEnabled(host)"));
assert.ok(component.includes('session?.role !== "admin"'));
assert.ok(component.includes("data-ad-client={GOOGLE_ADSENSE_CLIENT_ID}"));
assert.ok(component.includes('crossOrigin="anonymous"'));
assert.ok(css.includes(".site-footer {"));
assert.ok(!/PROTECTED_PREFIXES[^;]*quyen-rieng-tu/s.test(proxy));
assert.ok(envExample.includes('GOOGLE_ADSENSE_DISABLED="0"'));
assert.ok(!envExample.includes("GOOGLE_ADSENSE_API_KEY"));
assert.ok(nextConfig.includes('source: "/ads.txt"'));
assert.ok(nextConfig.includes("s-maxage=86400"));
assert.equal(JSON.parse(packageJson).scripts["verify:adsense"], "tsx scripts/verifyAdSense.mts");

const apiKeyPrefix = "AIza" + "Sy";
const grep = spawnSync("git", ["grep", "-n", "-I", apiKeyPrefix, "--", "."], { cwd: root, encoding: "utf8" });
assert.equal(grep.status, 1, "tracked Google API key found: " + (grep.stdout || grep.stderr));

console.log("PASS: AdSense code, host gating, ads.txt, removed privacy page and API-key guard are consistent.");