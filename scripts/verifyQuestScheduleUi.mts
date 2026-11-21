import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import tailwindcss from "@tailwindcss/postcss";
import { build, type Plugin } from "esbuild";
import postcss from "postcss";
import { chromium } from "playwright-core";
import type { QuestScheduleRule } from "../src/lib/validation/questSchedules";

type FixtureState = {
  admin: boolean;
  guards: number;
  writes: QuestScheduleRule[][];
  invalidated: string[];
  finishSave?: () => void;
  saveError?: Error;
};

const fixtureModules: Record<string, string> = {
  "@/lib/auth/guards": `export async function requireAdmin() {
    window.questFixture.guards++;
    if (!window.questFixture.admin) throw new Error("Forbidden");
  }`,
  "@/lib/services/settings": `export async function saveQuestSchedules(rules) {
    if (window.questFixture.saveError) throw window.questFixture.saveError;
    window.questFixture.writes.push(structuredClone(rules));
    await new Promise((resolve) => { window.questFixture.finishSave = resolve; });
  }`,
  "next/cache": `export function revalidatePath(path) {
    window.questFixture.invalidated.push(path);
  }`,
};
const offlineSettings: Plugin = {
  name: "offline-quest-settings",
  setup(plugin) {
    plugin.onResolve({ filter: /^(next\/cache|@\/lib\/(auth\/guards|services\/settings))$/ }, ({ path }) => ({
      path,
      namespace: "quest-ui-fixture",
    }));
    plugin.onLoad({ filter: /.*/, namespace: "quest-ui-fixture" }, ({ path }) => ({
      contents: fixtureModules[path],
      loader: "js",
    }));
  },
};

const bundle = await build({
  stdin: {
    contents: `
      import { createRoot } from "react-dom/client";
      import { AdminTabs } from "./src/app/admin/AdminTabs";
      import { QuestScheduleForm } from "./src/app/admin/QuestScheduleForm";
      import { saveQuestSchedulesAction } from "./src/app/actions/questSchedules";
      import { QuestScheduleLegacyJobsError } from "./src/lib/validation/questSchedules";
      window.questFixture = { admin: true, guards: 0, writes: [], invalidated: [] };
      window.invokeQuestSave = saveQuestSchedulesAction;
      window.blockQuestSaveForLegacyWorkers = () => {
        window.questFixture.saveError = new QuestScheduleLegacyJobsError();
      };
      createRoot(document.getElementById("root")).render(
        <main className="mx-auto w-full max-w-6xl px-4 pb-24 sm:px-6">
        <AdminTabs initialKey={new URL(window.location.href).searchParams.get("tab") ?? undefined} tabs={[
          { key:"monDo", label:"Môn Đồ", pane:<p>Sổ bộ môn đồ</p> },
          { key:"damDao", label:"Đàm Đạo", pane:null },
          { key:"giaoDien", label:"Giao Diện", pane:null },
          { key:"baoTri", label:"Bảo Trì", pane:null },
          { key:"quest", label:"Quest", pane:<QuestScheduleForm initialRules={[
            {questKey:"meCung", enabled:true, windows:[{start:"23:00",end:"02:00"}]},
          ]} /> },
          { key:"banTin", label:"Bản Tin", pane:null },
        ]} />
        </main>
      );
    `,
    resolveDir: process.cwd(),
    loader: "tsx",
  },
  bundle: true,
  jsx: "automatic",
  platform: "browser",
  format: "iife",
  write: false,
  plugins: [offlineSettings],
});
const appCssPath = "src/app/globals.css";
const appCss = await postcss([tailwindcss()]).process(readFileSync(appCssPath, "utf8"), { from: appCssPath });
const mobileCss = readFileSync("src/app/mobile.css", "utf8");
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.route("http://quest-schedule.test/**", (route) => route.fulfill({
    contentType: "text/html",
    body: '<!doctype html><html lang="vi"><body><div id="root"></div></body></html>',
  }));
  await page.goto("http://quest-schedule.test/admin?tab=quest");
  await page.addStyleTag({ content: appCss.css + mobileCss });
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const waitForVisibleSelectedTab = () => page.waitForFunction(() => {
    const strip = document.querySelector('[aria-label="Các mục quản trị"]');
    const selected = strip?.querySelector('button[aria-pressed="true"]');
    if (!strip || !selected || strip.scrollWidth <= strip.clientWidth) return false;
    const viewport = strip.getBoundingClientRect();
    const tab = selected.getBoundingClientRect();
    return tab.left >= viewport.left - 1 && tab.right <= viewport.right + 1;
  }, undefined, { timeout: 3_000 });
  await waitForVisibleSelectedTab();
  const mobileLayout = await page.locator("form").evaluate(form => {
    const root = document.documentElement;
    const formBox = form.getBoundingClientRect();
    const controls = [...form.querySelectorAll("input[type=time], select")];
    return {
      overflow: root.scrollWidth - root.clientWidth,
      fitsForm: controls.every(control => {
        const controlBox = control.getBoundingClientRect();
        return controlBox.left >= formBox.left && controlBox.right <= formBox.right;
      }),
      outlined: controls.every(control => Number.parseFloat(getComputedStyle(control).borderLeftWidth) > 0),
    };
  });
  assert.deepEqual(mobileLayout, { overflow: 0, fitsForm: true, outlined: true });
  const getFixture = () => page.evaluate(() => {
    const state = (window as Window & { questFixture?: FixtureState }).questFixture!;
    return { guards: state.guards, writes: state.writes, invalidated: state.invalidated };
  });
  const maze = page.getByRole("group", { name: "Mê Cung", exact: true });
  await maze.getByLabel("Giờ bắt đầu 1").waitFor();
  assert.equal(await maze.getByLabel("Giờ bắt đầu 1").inputValue(), "23:00");
  assert.equal(await maze.getByLabel("Giờ kết thúc 1").inputValue(), "02:00");

  const resultWithoutPayload = await page.evaluate(() => {
    const host = window as Window & {
      invokeQuestSave?: (state: null, data: FormData) => Promise<{ ok: boolean }>;
    };
    return host.invokeQuestSave!(null, new FormData());
  });
  assert.equal(resultWithoutPayload.ok, false, "missing form data cannot clear schedules");

  const forbidden = await page.evaluate(async () => {
    const host = window as Window & {
      questFixture?: FixtureState;
      invokeQuestSave?: (state: null, data: FormData) => Promise<unknown>;
    };
    host.questFixture!.admin = false;
    try {
      await host.invokeQuestSave!(null, new FormData());
      return false;
    } catch (error) {
      return error instanceof Error && error.message === "Forbidden";
    } finally {
      host.questFixture!.admin = true;
    }
  });
  assert.equal(forbidden, true, "authorization runs even when the form data is malformed");

  await page.getByLabel("Chọn nhiệm vụ").selectOption("cauCa");
  await page.getByRole("button", { name: "Thêm nhiệm vụ" }).click();
  const fishing = page.getByRole("group", { name: "Câu Cá", exact: true });
  await fishing.getByLabel("Giờ bắt đầu 1").fill("08:15");
  await fishing.getByLabel("Giờ kết thúc 1").fill("08:15");
  const save = page.getByRole("button", { name: /Lưu lịch/ });
  await save.click();
  const feedback = page.getByRole("status");
  await feedback.waitFor();
  await page.waitForFunction(() => Boolean(document.querySelector('[role="status"]')?.textContent));
  assert.equal((await getFixture()).writes.length, 0, "equal times cannot be saved");
  assert.equal(await fishing.getByLabel("Giờ bắt đầu 1").inputValue(), "08:15", "draft survives rejected save");

  await page.getByRole("button", { name: "Môn Đồ" }).click();
  assert.equal(new URL(page.url()).searchParams.has("tab"), false);
  await waitForVisibleSelectedTab();
  await page.getByRole("button", { name: "Quest", exact: true }).click();
  assert.equal(new URL(page.url()).searchParams.get("tab"), "quest");
  await waitForVisibleSelectedTab();
  assert.equal(await fishing.getByLabel("Giờ bắt đầu 1").inputValue(), "08:15", "draft survives leaving and returning to the tab");

  await fishing.getByLabel("Giờ kết thúc 1").fill("09:30");
  await fishing.getByRole("button", { name: "Thêm khung giờ" }).click();
  await fishing.getByLabel("Giờ bắt đầu 2").fill("14:00");
  await fishing.getByLabel("Giờ kết thúc 2").fill("16:00");
  await fishing.getByRole("button", { name: "Xóa khung giờ 1" }).click();
  assert.equal(await fishing.getByLabel("Giờ bắt đầu 1").inputValue(), "14:00");
  await maze.getByLabel("Áp dụng lịch").uncheck();

  await save.click();
  await page.waitForFunction(() => Boolean((window as Window & { questFixture?: FixtureState }).questFixture?.finishSave));
  assert.equal(await fishing.getByLabel("Giờ bắt đầu 1").isDisabled(), true, "pending save locks edits");
  assert.deepEqual(await getFixture(), {
    guards: 4,
    writes: [[
      { questKey: "meCung", enabled: false, windows: [{ start: "23:00", end: "02:00" }] },
      { questKey: "cauCa", enabled: true, windows: [{ start: "14:00", end: "16:00" }] },
    ]],
    invalidated: [],
  });
  await page.evaluate(() => (window as Window & { questFixture?: FixtureState }).questFixture?.finishSave?.());
  await feedback.filter({ hasText: /Đã lưu/ }).waitFor();
  assert.equal(await fishing.getByLabel("Giờ bắt đầu 1").inputValue(), "14:00");
  assert.deepEqual((await getFixture()).invalidated, ["/admin", "/dashboard"]);

  await page.evaluate(() => {
    const host = window as Window & { blockQuestSaveForLegacyWorkers?: () => void };
    host.blockQuestSaveForLegacyWorkers!();
  });
  await save.click();
  await feedback.filter({ hasText: /khôi lỗi|worker/i }).waitFor({ timeout: 5_000 });
  assert.equal(await fishing.getByLabel("Giờ bắt đầu 1").inputValue(), "14:00");
  assert.equal((await getFixture()).writes.length, 1, "rollout failure does not write");

  await page.evaluate(() => {
    const host = window as Window & { questFixture?: FixtureState };
    host.questFixture!.saveError = new Error("private database detail");
  });
  await save.click();
  await feedback.filter({ hasText: /Chưa lưu được/ }).waitFor({ timeout: 5_000 });
  assert.equal((await feedback.textContent())?.includes("private database detail"), false);

  await fishing.getByRole("button", { name: "Xóa lịch nhiệm vụ" }).click();
  assert.equal(await fishing.count(), 0);
  assert.equal(await page.getByLabel("Chọn nhiệm vụ").locator('option[value="cauCa"]').count(), 1);
  console.log("PASS: quest schedules edit, validate, preserve drafts and save in Chromium");
} finally {
  await browser.close();
}
