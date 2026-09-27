import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  DOMAIN_CATALOG,
  OFFICIAL_DOMAIN,
  OFFICIAL_ORIGIN,
  RETIRED_DOMAIN,
  isRetiredDomainHost,
  normalizeDomainHost,
  officialUrlFor,
} from "../src/lib/domains/catalog";
import {
  RETIRED_DOMAIN_REDIRECT_SECONDS,
  RETIREMENT_PROTOTYPE_ID,
  renderRetiredDomainPage,
} from "../src/lib/domains/retiredDomainPage";

const root = path.join(import.meta.dirname, "..");
const read = (relative: string) => readFile(path.join(root, relative), "utf8");

assert.deepEqual(
  DOMAIN_CATALOG.map(({ hostname, status, statusLabel }) => ({ hostname, status, statusLabel })),
  [
    { hostname: "auto-hh3d.online", status: "active", statusLabel: "hoạt động" },
    { hostname: "auto-hh3d.vercel.app", status: "dead", statusLabel: "đã chết" },
  ],
);
assert.equal(OFFICIAL_ORIGIN, "https://auto-hh3d.online");
assert.equal(normalizeDomainHost("AUTO-HH3D.VERCEL.APP:443"), RETIRED_DOMAIN);
assert.equal(normalizeDomainHost(" auto-hh3d.vercel.app. "), RETIRED_DOMAIN);
assert.equal(isRetiredDomainHost("auto-hh3d.vercel.app"), true);
assert.equal(isRetiredDomainHost(OFFICIAL_DOMAIN), false);
assert.equal(officialUrlFor("dashboard", "tab=auto"), "https://auto-hh3d.online/dashboard?tab=auto");

const target = "https://auto-hh3d.online/dashboard?tab=auto&amp;x=%3Cunsafe%3E";
const html = renderRetiredDomainPage("/dashboard", "?tab=auto&x=%3Cunsafe%3E");
assert.match(html, new RegExp(`data-prototype="${RETIREMENT_PROTOTYPE_ID}"`));
assert.match(html, /<title>Tên miền đã đóng · Auto HH3D<\/title>/);
assert.match(html, /Gương trạm đã khép cửa/);
assert.doesNotMatch(html, /T\?n mi\?n/);
assert.match(html, /auto-hh3d\.vercel\.app/);
assert.match(html, /auto-hh3d\.online/);
assert.match(html, />đã chết</);
assert.match(html, />hoạt động</);
assert.ok(html.includes(`content="${RETIRED_DOMAIN_REDIRECT_SECONDS};url=${target}"`));
assert.match(html, /Tự động chuyển sau 8 giây/);
assert.match(html, /location\.replace\(target\)/);
assert.match(html, /navigator\.clipboard\.writeText\(target\)/);
assert.doesNotMatch(html, /<unsafe>/);

const prototypeHtml = await read("docs/prototypes/domain-retirement-prototype.html");
assert.equal(
  prototypeHtml.replace(/\r\n/g, "\n"),
  renderRetiredDomainPage("/", "").replace(/\r\n/g, "\n"),
  "the committed HTML prototype must remain byte-for-byte equivalent to the runtime page",
);

const [proxy, adminPage, panel, workflow, setup, installerSh, installerPs1, vercel] = await Promise.all([
  read("src/proxy.ts"),
  read("src/app/admin/page.tsx"),
  read("src/app/admin/DomainsPanel.tsx"),
  read("deploy/github/linh-su.yml"),
  read("deploy/oracle/setup.sh"),
  read("public/linh-su/install.sh"),
  read("public/linh-su/install.ps1"),
  read("vercel.json"),
]);
assert.match(proxy, /isRetiredDomainHost\(requestedHost\)/);
assert.match(proxy, /status: 410/);
assert.match(proxy, /renderRetiredDomainPage/);
assert.match(proxy, /PROTECTED_PREFIXES/);
assert.match(proxy, /decideRequest/);
assert.match(proxy, /message: "Tên miền này đã đóng\. Vui lòng truy cập auto-hh3d\.online\."/);
assert.match(adminPage, /key: "tenMien"/);
assert.match(adminPage, /label: "Tên miền"/);
assert.match(panel, /1 hoạt động · 1 đã chết/);
for (const [label, text] of [
  ["GitHub workflow", workflow],
  ["OCI setup", setup],
  ["Linux installer", installerSh],
  ["Windows installer", installerPs1],
] as const) {
  assert.match(text, /https:\/\/auto-hh3d\.online/, `${label} must use the official domain`);
  assert.doesNotMatch(text, /auto-hh3d\.vercel\.app/, `${label} must not call the retired domain`);
}
assert.doesNotMatch(vercel, /"crons"/, "the retired Vercel deployment must not run worker cron");

console.log("PASS: domain catalog, prototype-based tombstone, safe redirect, and official worker endpoints are consistent.");
