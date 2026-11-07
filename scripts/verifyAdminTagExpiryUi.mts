#!/usr/bin/env node
/** Real React/browser regression fixture. No database, live users or jobs are touched. */
import assert from "node:assert/strict";
import { readFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { build } from "esbuild";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { chromium } from "playwright-core";

const root = process.cwd();
const output = resolve(root, ".tmp-watch/tag-expiry-qa");
mkdirSync(output, { recursive: true });
const bundled = await build({
  stdin: { contents: `
    import React from 'react';
    import { createRoot } from 'react-dom/client';
    import { UserTable } from './src/app/admin/UserTable';
    const users = Array.from({length: 100}, (_, i) => ({ id: 'fixture-' + i,
      username: 'fixture' + i, displayName: 'Đạo hữu kiểm thử ' + i,
      email: 'fixture' + i + '@example.invalid', roles: ['de-tu'], status: 'active',
      tags: ['VIP', 'Thánh nữ'], tagExpirations: i === 1 ? {vip:'2020-01-01T00:00:00.000Z'} : {},
      tagAssignments: [{label:'VIP', expiresAt:i === 1 ? '2020-01-01T00:00:00.000Z' : null}, {label:'Thánh nữ', expiresAt:null}],
      createdAt: '2026-01-01T00:00:00Z' }));
    const viewer = {...users[0], id: 'fixture-owner', roles: ['gia-chu']};
    createRoot(document.getElementById('root')).render(React.createElement(UserTable,
      {viewer, users, query: '', status: '', frameLabels: []}));
  `, resolveDir: root, loader: "tsx" },
  bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
  plugins: [{ name: "isolated-admin-fixture", setup(b) {
    b.onResolve({ filter: /^(next\/navigation|@\/app\/actions\/admin)$/ }, args => ({ path: args.path, namespace: "fixture" }));
    b.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ contents: args.path === "next/navigation"
      ? `const router = { replace() {} }; const params = new URLSearchParams(); export const useRouter = () => router; export const useSearchParams = () => params;`
      : `export const deleteUserAction = async () => ({ok:true}); export const setStatusAction = async () => ({ok:true}); export const updateUserAction = async (_, data) => { window.__submitted = Object.fromEntries(data); if (window.__delay) await new Promise(resolve => window.__finish = resolve); if (window.__throw) throw new Error('fixture network'); return {ok:!!window.__success, message:'Fixture validation error'}; };`, loader: "js" }));
  } }],
});
const css = await postcss([tailwind({ base: root })]).process(readFileSync(resolve(root, "src/app/globals.css"), "utf8"), { from: resolve(root, "src/app/globals.css") });
const browser = await chromium.launch({ headless: true, channel: "chromium" });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, timezoneId: "America/New_York" });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.setContent(`<style>${css.css}</style><div id="root" style="padding:24px"></div>`);
  await page.addScriptTag({ content: bundled.outputFiles[0].text });
  await page.locator("tbody tr").first().waitFor();
  await page.getByRole("button", { name: "Sửa", exact: true }).first().click();
  const dialog = page.getByRole("dialog");
  const rect = await dialog.boundingBox();
  assert.ok(rect && rect.y >= 0 && rect.y + rect.height <= 900, `dialog must fit viewport: ${JSON.stringify(rect)}`);
  assert.ok(Math.abs(rect.y + rect.height / 2 - 450) < 3, `dialog must center in viewport: ${JSON.stringify(rect)}`);
  await page.screenshot({ path: resolve(output, "desktop.png") });
  const expiry = page.getByRole("checkbox", { name: "Đặt thời hạn VIP", exact: true });
  assert.equal(await expiry.isChecked(), false, "legacy tag defaults to unlimited");
  await expiry.check();
  const date = page.getByLabel("Hết hạn VIP", { exact: true });
  assert.equal(await date.evaluate((el: HTMLInputElement) => el.checkValidity()), false, "empty selected deadline is required");
  await date.fill("2030-11-08T10:30");
  const payload = () => page.locator('input[name="tagExpirations"]').inputValue().then(JSON.parse);
  assert.deepEqual(await payload(), { vip: "2030-11-08T03:30:00.000Z", "thánh nữ": null }, "each tag has independent expiry in Vietnam time even in a New York browser");
  await page.getByRole("button", { name: "Lưu", exact: true }).click();
  await page.getByRole("alert").waitFor();
  assert.equal(await date.inputValue(), "2030-11-08T10:30", "failed save retains form values");
  await page.screenshot({ path: resolve(output, "desktop-expiry.png") });
  await expiry.uncheck();
  assert.deepEqual(await payload(), { vip: null, "thánh nữ": null }, "uncheck restores unlimited");
  await expiry.check();
  await date.fill("2030-11-08T10:30");
  await page.locator("#edit-tags").fill("Thánh nữ");
  await page.locator("#edit-tags").fill("Thánh nữ, VIP");
  assert.equal(await expiry.isChecked(), false, "removed/readded tag must not resurrect hidden deadline");
  await page.locator("#edit-tags").fill("constructor, __proto__");
  assert.equal(await page.getByRole("checkbox", {name:"Đặt thời hạn constructor", exact:true}).isChecked(), false, "arbitrary labels default unlimited, without inherited object properties");
  assert.equal(await page.getByRole("checkbox", {name:"Đặt thời hạn __proto__", exact:true}).isChecked(), false);
  await page.keyboard.press("Escape");
  assert.equal(await dialog.count(), 0, "Escape dismisses modal");
  assert.equal(await page.evaluate(() => document.activeElement?.textContent?.trim()), "Sửa", "focus returns to trigger");
  assert.equal(await page.evaluate(() => document.body.style.overflow), "", "body scroll restored");
  await page.getByRole("button", { name: "Sửa", exact: true }).nth(1).click();
  assert.equal(await page.getByText("Đã hết hạn", { exact: true }).count(), 1, "expired assignment stays editable");
  assert.equal(await date.inputValue(), "2020-01-01T07:00", "saved UTC deadline is shown as Vietnam time");
  await page.getByRole("button", { name: "Thôi", exact: true }).click();
  await page.getByRole("button", { name: "Sửa", exact: true }).first().click();
  await page.evaluate(() => { (window as any).__delay = true; });
  await page.getByRole("button", { name: "Lưu", exact: true }).click();
  await page.getByRole("button", { name: "Đang lưu…", exact: true }).waitFor();
  assert.equal(await page.locator("#edit-tags").isDisabled(), true, "pending save blocks edits instead of losing unsaved changes");
  await page.keyboard.press("Escape");
  assert.equal(await dialog.count(), 1, "pending save cannot close prematurely");
  await page.evaluate(() => { (window as any).__finish(); (window as any).__delay = false; });
  await page.getByRole("button", { name: "Lưu", exact: true }).waitFor();
  await page.evaluate(() => { (window as any).__success = true; });
  await page.getByRole("button", { name: "Lưu", exact: true }).click();
  await dialog.waitFor({state:"detached"});
  await page.evaluate(() => { (window as any).__success = false; });
  await page.locator("select").filter({has: page.locator('option[value="100"]')}).selectOption("100");
  assert.equal(await page.locator("tbody tr").count(), 100);
  await page.getByRole("button", { name: "Sửa", exact: true }).last().click();
  const scrolledRect = await dialog.boundingBox();
  assert.ok(scrolledRect && Math.abs(scrolledRect.y + scrolledRect.height / 2 - 450) < 3, "viewport centering survives 100 rows and bottom scroll");
  await page.keyboard.press("Shift+Tab");
  assert.equal(await page.evaluate(() => document.querySelector("dialog")?.contains(document.activeElement)), true, "keyboard focus stays in modal");
  await page.keyboard.press("Escape");
  for (const width of [390, 320]) {
    await page.setViewportSize({width, height:740});
    await page.getByRole("button", { name: "Sửa", exact: true }).first().click();
    await expiry.check();
    await date.fill("2030-11-08T10:30");
    const mobileRect = await dialog.boundingBox();
    assert.ok(mobileRect && mobileRect.x >= 0 && mobileRect.x + mobileRect.width <= width && mobileRect.y >= 0 && mobileRect.y + mobileRect.height <= 740, "mobile dialog fits viewport");
    assert.equal(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth), true, "no horizontal overflow in mobile dialog");
    await page.screenshot({ path: resolve(output, `mobile-${width}.png`) });
    await page.getByRole("button", { name: "Thôi", exact: true }).click();
  }
  assert.deepEqual(errors, []);
  console.log("PASS admin dialog: 100 rows, scrolled table, desktop/mobile, focus, Escape, Cancel, independent expiry, timezone, unlimited reset, retained expired tags and failed saves");
} finally { await browser.close(); }
