import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { build } from "esbuild";
import { chromium } from "playwright-core";

const src=readFileSync("src/app/dashboard/ConfigForm.tsx","utf8");
assert.match(src,/import \{[^}]*startTransition/);
assert.match(src,/<form[\s\S]*?action=\{action\}[\s\S]*?noValidate[\s\S]*?onSubmit=\{\(event\) => \{[\s\S]*?event.preventDefault\(\);[\s\S]*?new FormData\(event.currentTarget\);[\s\S]*?startTransition\(\(\) => \{[\s\S]*?action\(values\)/);
assert.ok(src.includes('hidden={questTab !== "free"}'),"hidden free form values remain mounted");
assert.ok(src.includes('hidden={questTab !== "vip"}'),"hidden VIP form values remain mounted");
assert.ok(src.includes("useActionState<ActionResult | null, FormData>"),"submission must use existing server action");

const bundle = await build({
  entryPoints: ["scripts/fixtures/configSubmitReact19.tsx"],
  bundle:true, platform:"browser", format:"iife", write:false,
  logLevel:"silent",
});
const browser=await chromium.launch({headless:true,channel:"chrome"});
try {
  const page=await browser.newPage();
  await page.setContent('<!doctype html><html><body><div id="root"></div></body></html>');
  await page.addScriptTag({content:bundle.outputFiles[0].text});
  await page.locator('input[name="vipTier"]').fill("9");
  await page.locator('input[name="hiddenFreeCap"]').evaluate(el => { (el as HTMLInputElement).value = "17"; });
  await page.locator('input[name="freeEnabled"]').check();
  await page.locator('input[type="checkbox"]:not([name])').check();
  await page.getByRole("button",{name:"Save"}).click();
  await page.getByRole("status").getByText("SAVED").waitFor({timeout:10000});
  assert.equal(await page.locator('input[name="vipTier"]').inputValue(),"9");
  assert.equal(await page.locator('input[name="hiddenFreeCap"]').inputValue(),"17");
  assert.equal(await page.locator('input[name="freeEnabled"]').isChecked(),true);
  assert.equal(await page.locator('input[type="checkbox"]:not([name])').isChecked(),true);
  assert.equal(await page.locator('input[name="q_diemDanh"]').count(),1);
  assert.deepEqual(await page.evaluate(()=>(window as unknown as Window & {__configTestSubmissions: Array<Record<string,string>>}).__configTestSubmissions),[
    {vipTier:"9",freeEnabled:"on",hiddenFreeCap:"17",q_diemDanh:"on"}
  ]);
  console.log("PASS: React 19 browser submit preserves visible, hidden, uncontrolled and controlled quest values; one action");
} finally { await browser.close(); }
