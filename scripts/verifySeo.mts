import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { robots } from "../src/app/robots.ts";
import { sitemap } from "../src/app/sitemap.ts";
import {
  SITE_URL,
  SITE_NAME,
  SITE_TITLE,
  SITE_DESCRIPTION,
  SITE_KEYWORDS,
  OG_IMAGE,
  PUBLIC_SITEMAP_ROUTES,
  ROBOTS_DISALLOW,
  LANDING_FAQ,
  LANDING_FEATURES,
  LANDING_STEPS,
  buildLandingJsonLd,
  serializeJsonLd,
  absoluteUrl,
} from "../src/lib/seo/site";
import { OFFICIAL_ORIGIN } from "../src/lib/domains/catalog";

const root = path.join(import.meta.dirname, "..");
const read = (rel: string) => fs.readFile(path.join(root, rel), "utf8");

// 1. Site Constants Integrity
assert.equal(SITE_URL, OFFICIAL_ORIGIN, "SITE_URL must equal OFFICIAL_ORIGIN");
assert.ok(SITE_NAME.length > 0, "SITE_NAME must not be empty");
assert.ok(SITE_TITLE.includes(SITE_NAME), "SITE_TITLE must include SITE_NAME");
assert.ok(SITE_DESCRIPTION.length > 50, "SITE_DESCRIPTION must be descriptive");
assert.ok(SITE_KEYWORDS.length >= 10, "SITE_KEYWORDS must have at least 10 keywords");

// 2. Consistency: No sitemap route should be disallowed in robots
for (const sitemapRoute of PUBLIC_SITEMAP_ROUTES) {
  for (const disallow of ROBOTS_DISALLOW) {
    assert.ok(
      !sitemapRoute.path.startsWith(disallow),
      `Conflict: Sitemap route ${sitemapRoute.path} is disallowed by ${disallow}`
    );
  }
}

// 3. Robots.txt Route Generation
const robotsOutput = robots();
assert.ok(robotsOutput.rules, "robots() must return rules");
const defaultRule = Array.isArray(robotsOutput.rules) ? robotsOutput.rules[0] : robotsOutput.rules;
assert.equal(defaultRule.userAgent, "*");
assert.equal(defaultRule.allow, "/");
assert.deepEqual(defaultRule.disallow, [...ROBOTS_DISALLOW]);
assert.equal(robotsOutput.sitemap, `${SITE_URL}/sitemap.xml`);
assert.equal(robotsOutput.host, SITE_URL);

// 4. Sitemap.xml Route Generation
const sitemapOutput = sitemap();
assert.equal(sitemapOutput.length, PUBLIC_SITEMAP_ROUTES.length);
for (const item of sitemapOutput) {
  assert.ok(item.url.startsWith(SITE_URL), `Sitemap item ${item.url} must start with ${SITE_URL}`);
  assert.ok(item.priority && item.priority > 0, "Priority must be set");
  assert.ok(item.changeFrequency, "changeFrequency must be set");
}
assert.ok(sitemapOutput.some((r) => r.url === absoluteUrl("/")));
assert.ok(sitemapOutput.some((r) => r.url === absoluteUrl("/quyen-rieng-tu")));
assert.ok(sitemapOutput.some((r) => r.url === absoluteUrl("/ten-mien")));
assert.ok(sitemapOutput.some((r) => r.url === absoluteUrl("/login")));
assert.ok(sitemapOutput.some((r) => r.url === absoluteUrl("/register")));

// 5. JSON-LD Graph Validity
const jsonLd = buildLandingJsonLd();
assert.equal(jsonLd["@context"], "https://schema.org");
const graph = jsonLd["@graph"] as Array<{ "@type": string; [k: string]: unknown }>;
assert.ok(Array.isArray(graph));
const org = graph.find((node) => node["@type"] === "Organization");
const website = graph.find((node) => node["@type"] === "WebSite");
const webApp = graph.find((node) => node["@type"] === "WebApplication");
const faqPage = graph.find((node) => node["@type"] === "FAQPage") as unknown as {
  mainEntity: Array<{ name: string; acceptedAnswer: { text: string } }>;
};

assert.ok(org, "Organization must be present in JSON-LD");
assert.ok(website, "WebSite must be present in JSON-LD");
assert.ok(webApp, "WebApplication must be present in JSON-LD");
assert.ok(faqPage, "FAQPage must be present in JSON-LD");

assert.equal(faqPage.mainEntity.length, LANDING_FAQ.length);
for (let i = 0; i < LANDING_FAQ.length; i++) {
  assert.equal(faqPage.mainEntity[i].name, LANDING_FAQ[i].question);
  assert.equal(faqPage.mainEntity[i].acceptedAnswer.text, LANDING_FAQ[i].answer);
}

// 6. JSON-LD Serialization safety
const serialized = serializeJsonLd(jsonLd);
assert.ok(!serialized.includes("<script>"), "JSON-LD must escape '<'");
assert.doesNotThrow(() => JSON.parse(serialized.replace(/\\u003c/g, "<")));

// 7. Verify RootLayout & Landing Page Files
const [layoutSource, pageSource, proxySource, packageJsonSource] = await Promise.all([
  read("src/app/layout.tsx"),
  read("src/app/page.tsx"),
  read("src/proxy.ts"),
  read("package.json"),
]);

assert.match(layoutSource, /metadataBase:\s*new URL\(SITE_URL\)/);
assert.match(layoutSource, /canonical:\s*"\.\/"/);
assert.match(layoutSource, /openGraph:\s*\{/);
assert.match(layoutSource, /twitter:\s*\{/);
assert.match(layoutSource, /summary_large_image/);
assert.match(layoutSource, /robots:\s*\{/);
assert.match(layoutSource, /googleBot:\s*\{/);
assert.match(layoutSource, /icons:\s*\{/);
assert.match(layoutSource, /OG_IMAGE/);
assert.match(layoutSource, /\/icon\.png/);
assert.match(layoutSource, /\/favicon\.ico/);

assert.match(pageSource, /application\/ld\+json/);
assert.match(pageSource, /buildLandingJsonLd/);
assert.match(pageSource, /LANDING_FEATURES/);
assert.match(pageSource, /LANDING_STEPS/);
assert.match(pageSource, /LANDING_FAQ/);

// Proxy matcher must allow static asset formats
assert.match(proxySource, /png|webp|jpg|jpeg|gif|svg|ico|txt|xml/);

// 8. Physical Asset Verification
const [ogStat, iconStat, favStat] = await Promise.all([
  fs.stat(path.join(root, "public", "og-image.jpg")),
  fs.stat(path.join(root, "public", "icon.png")),
  fs.stat(path.join(root, "public", "favicon.ico")),
]);

assert.ok(ogStat.size > 20_000, `og-image.jpg too small: ${ogStat.size} bytes`);
assert.ok(iconStat.size > 10_000, `icon.png too small: ${iconStat.size} bytes`);
assert.ok(favStat.size > 1_000, `favicon.ico too small: ${favStat.size} bytes`);

// 9. package.json script check
const pkg = JSON.parse(packageJsonSource);
assert.equal(pkg.scripts["verify:seo"], "tsx scripts/verifySeo.mts");

console.log("PASS: SEO metadata, JSON-LD Schema, robots.txt, sitemap.xml, landing enrichment and static assets verified.");
