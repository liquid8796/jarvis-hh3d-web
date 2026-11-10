import assert from "node:assert/strict";
import { globSync, mkdirSync, readFileSync } from "node:fs";
import { build } from "esbuild";
import { chromium } from "playwright-core";

const formSource = readFileSync("src/app/dashboard/ConfigForm.tsx", "utf8");
assert.match(formSource, /<FishingSpotOptions/, "dashboard must use the multi-spot control");
assert.ok(!formSource.includes('<option value="random">'), "no random option");
const bundle = await build({
  stdin: { contents: `
    import React from "react";
    import { createRoot } from "react-dom/client";
    import { FishingSpotOptions } from "./src/app/dashboard/FishingSpotOptions";
    const root = createRoot(document.getElementById("root"));
    window.renderSpots = (value = ["sen"], disabled = false) => root.render(
      <form onSubmit={e => { e.preventDefault(); window.savedSpots = new FormData(e.currentTarget).getAll("cauCaSpot"); }}>
        <FishingSpotOptions key={JSON.stringify([value, disabled])} defaultValue={value} disabled={disabled} />
        <button type="submit">Save</button>
      </form>);
    window.renderSpots();
  `, resolveDir: process.cwd(), loader: "tsx" },
  bundle: true, platform: "browser", format: "iife", write: false, logLevel: "silent",
});
const browser = await chromium.launch({ headless: true, channel: "chrome" });
try {
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.setContent('<!doctype html><div id="root"></div>');
  // Run after a production build to exercise the actual Tailwind theme/layout.
  const cssFiles = globSync(".next/static/**/*.css");
  assert.ok(cssFiles.length, "build the app before checking the styled UI");
  await page.addStyleTag({ content: cssFiles.map(file => readFileSync(file, "utf8")).join("\n") });
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  assert.equal(await page.getByRole("group", { name: "Điểm câu" }).count(), 1);
  assert.equal(await page.getByRole("checkbox").count(), 4);
  assert.equal(await page.getByLabel("Bãi sen", { exact: true }).isChecked(), true);
  await page.getByLabel("Dưới cầu đá", { exact: true }).check();
  await page.getByRole("button", { name: "Save" }).click();
  assert.deepEqual(await page.evaluate(() => (window as any).savedSpots), ["sen", "cau"]);
  await page.getByLabel("Bãi sen", { exact: true }).uncheck();
  await page.getByLabel("Dưới cầu đá", { exact: true }).click();
  assert.equal(await page.getByLabel("Dưới cầu đá", { exact: true }).isChecked(), true, "last selected spot is retained");
  await page.getByRole("button", { name: "Save" }).click();
  assert.deepEqual(await page.evaluate(() => (window as any).savedSpots), ["cau"]);
  await page.evaluate(() => (window as any).renderSpots(["nong", "sen", "giua", "cau"]));
  await page.waitForFunction(() => document.querySelectorAll('input:checked').length === 4);
  if (process.argv.includes("--screenshots")) {
    mkdirSync(".tmp-watch", { recursive: true });
    await page.screenshot({ path: ".tmp-watch/fishing-spots-desktop.png" });
  }
  await page.setViewportSize({ width: 375, height: 812 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  if (process.argv.includes("--screenshots")) await page.screenshot({ path: ".tmp-watch/fishing-spots-mobile.png" });
  await page.evaluate(() => (window as any).renderSpots(["sen", "cau"], true));
  await page.waitForFunction(() => document.querySelector("fieldset")?.disabled);
  for (const input of await page.getByRole("checkbox").all()) assert.equal(await input.isDisabled(), true);
  await page.getByRole("button", { name: "Save" }).click();
  assert.deepEqual(await page.evaluate(() => (window as any).savedSpots), []);
  assert.deepEqual(errors, []);
  console.log("PASS fishing spot UI: four checkboxes, multiple form values, one minimum, restored selections, mobile and access gate");
} finally { await browser.close(); }
