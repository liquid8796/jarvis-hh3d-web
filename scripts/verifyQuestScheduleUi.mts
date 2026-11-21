import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import tailwindcss from "@tailwindcss/postcss";
import { build, type Plugin } from "esbuild";
import postcss from "postcss";
import { chromium, type Locator } from "playwright-core";
import type { AutoscaleSchedulePoint } from "../src/lib/validation/workerAutoscale";
import type { QuestTimer } from "../src/lib/questTimers";
import type { QuestScheduleRule } from "../src/lib/validation/questSchedules";

type FixtureState = {
  admin: boolean;
  guards: number;
  writes: QuestScheduleRule[][];
  invalidated: string[];
  autoscaleWrites: AutoscaleSchedulePoint[][];
  autoWrites: QuestTimer[][];
  finishSave?: () => void;
  saveError?: Error;
};

const fixtureModules: Record<string, string> = {
  "@/lib/auth/guards": `export async function requireAdmin() {
    window.questFixture.guards++;
    if (!window.questFixture.admin) throw new Error("Forbidden");
    return { roles: ["gia-chu"] };
  }`,
  "@/lib/services/settings": `export async function getAppSettings() { return window.questFixture.settings; }
  export async function saveQuestSchedules(rules) {
    if (window.questFixture.saveError) throw window.questFixture.saveError;
    window.questFixture.writes.push(structuredClone(rules));
    await new Promise((resolve) => { window.questFixture.finishSave = resolve; });
  }`,
  "@/lib/services/companionState": `export async function mutateGithubState(mutate) {
    const fixture = window.questFixture;
    mutate(fixture.settings);
    fixture.autoscaleWrites.push(structuredClone(fixture.settings.workerAutoscale.schedule));
  }`,
  "@/lib/services/workerAutoscale": `export async function runWorkerAutoscale() {
    throw new Error("Offline fixture never reconciles real workflows");
  }`,
  "@/app/actions/automation": `export async function saveQuestTimersAction(_prev, data) {
    window.questFixture.autoWrites.push(JSON.parse(data.get("questTimersJson")));
    return {ok: true, message: "Đã lưu lịch hẹn"};
  }`,
  "next/cache": `export function revalidatePath(path) {
    window.questFixture.invalidated.push(path);
  }`,
};
const offlineSettings: Plugin = {
  name: "offline-quest-settings",
  setup(plugin) {
    plugin.onResolve({ filter: /^(next\/cache|@\/lib\/(auth\/guards|services\/(settings|companionState|workerAutoscale))|@\/app\/actions\/automation)$/ }, ({ path }) => ({
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
      import { WorkerAutoscalePanel } from "./src/app/admin/WorkerAutoscalePanel";
      import { QuestTimerPanel } from "./src/app/dashboard/QuestTimerPanel";
      import { workerAutoscaleSchema } from "./src/lib/validation/workerAutoscale";
      import { saveQuestSchedulesAction } from "./src/app/actions/questSchedules";
      import { QuestScheduleLegacyJobsError } from "./src/lib/validation/questSchedules";
      const workerAutoscale = workerAutoscaleSchema.parse({ mode:"scheduler", schedule:[{time:"23:07",workers:5}] });
      window.questFixture = {
        admin: true, guards: 0, writes: [], invalidated: [], autoscaleWrites: [], autoWrites: [],
        settings: { workerAutoscale, githubStations: [] },
      };
      window.invokeQuestSave = saveQuestSchedulesAction;
      window.blockQuestSaveForLegacyWorkers = () => {
        window.questFixture.saveError = new QuestScheduleLegacyJobsError();
      };
      createRoot(document.getElementById("root")).render(
        <main className="mx-auto w-full max-w-6xl px-4 pb-24 sm:px-6">
        {window.location.pathname === "/dashboard" ? <QuestTimerPanel
          initialTimers={[{questKey:"meCung", hour:23, minute:8, second:37}]}
          enabledQuestKeys={["meCung"]}
        /> : <AdminTabs initialKey={new URL(window.location.href).searchParams.get("tab") ?? undefined} tabs={[
          { key:"monDo", label:"Môn Đồ", pane:<p>Sổ bộ môn đồ</p> },
          { key:"damDao", label:"Đàm Đạo", pane:null },
          { key:"giaoDien", label:"Giao Diện", pane:null },
          { key:"baoTri", label:"Bảo Trì", pane:null },
          { key:"quest", label:"Quest", pane:<QuestScheduleForm initialRules={[
            {questKey:"meCung", enabled:true, windows:[{start:"23:00",end:"02:00"}]},
          ]} /> },
          { key:"banTin", label:"Bản Tin", pane:null },
          { key:"autoscale", label:"Auto Scaling", pane:<WorkerAutoscalePanel initial={workerAutoscale} stations={[]} /> },
        ]} />}
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
  const page = await browser.newPage({ locale: "en-US", viewport: { width: 390, height: 844 } });
  await page.route("http://quest-schedule.test/**", (route) => route.fulfill({
    contentType: "text/html",
    body: '<!doctype html><html lang="vi"><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div></body></html>',
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
    const controls = [...form.querySelectorAll("select")];
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
  assert.equal(await page.evaluate(() => navigator.language), "en-US");
  assert.equal(await page.locator('input[type="time"]').count(), 0, "schedule controls do not use locale-dependent browser clocks");
  const maze = page.getByRole("group", { name: "Mê Cung", exact: true });
  const clock = (scope: Locator, label: string) => scope.getByRole("group", { name: label, exact: true });
  const readClock = async (group: Locator) => {
    assert.equal(await group.getByText(":", { exact: true }).isVisible(), true);
    const hours = group.getByRole("combobox", { name: "Giờ", exact: true });
    const minutes = group.getByRole("combobox", { name: "Phút", exact: true });
    return [
      await hours.locator("option:checked").textContent(),
      await minutes.locator("option:checked").textContent(),
    ].join(":");
  };
  const setClock = async (group: Locator, value: string) => {
    const [hour, minute] = value.split(":");
    await group.getByRole("combobox", { name: "Giờ", exact: true }).selectOption(hour);
    await group.getByRole("combobox", { name: "Phút", exact: true }).selectOption(minute);
  };
  assert.equal(await readClock(clock(maze, "Bắt đầu 1")), "23:00");
  assert.equal(await readClock(clock(maze, "Kết thúc 1")), "02:00");

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
  await setClock(clock(fishing, "Bắt đầu 1"), "08:15");
  await setClock(clock(fishing, "Kết thúc 1"), "08:15");
  const save = page.getByRole("button", { name: /Lưu lịch/ });
  await save.click();
  const feedback = page.getByRole("status");
  await feedback.waitFor();
  await page.waitForFunction(() => Boolean(document.querySelector('[role="status"]')?.textContent));
  assert.equal((await getFixture()).writes.length, 0, "equal times cannot be saved");
  assert.equal(await readClock(clock(fishing, "Bắt đầu 1")), "08:15", "draft survives rejected save");

  await page.getByRole("button", { name: "Môn Đồ" }).click();
  assert.equal(new URL(page.url()).searchParams.has("tab"), false);
  await waitForVisibleSelectedTab();
  await page.getByRole("button", { name: "Quest", exact: true }).click();
  assert.equal(new URL(page.url()).searchParams.get("tab"), "quest");
  await waitForVisibleSelectedTab();
  assert.equal(await readClock(clock(fishing, "Bắt đầu 1")), "08:15", "draft survives leaving and returning to the tab");

  await setClock(clock(fishing, "Kết thúc 1"), "09:30");
  await fishing.getByRole("button", { name: "Thêm khung giờ" }).click();
  await setClock(clock(fishing, "Bắt đầu 2"), "14:37");
  await setClock(clock(fishing, "Kết thúc 2"), "16:58");
  await fishing.getByRole("button", { name: "Xóa khung giờ 1" }).click();
  assert.equal(await readClock(clock(fishing, "Bắt đầu 1")), "14:37");
  await maze.getByLabel("Áp dụng lịch").uncheck();

  await save.click();
  await page.waitForFunction(() => Boolean((window as Window & { questFixture?: FixtureState }).questFixture?.finishSave));
  assert.equal(await clock(fishing, "Bắt đầu 1").getByRole("combobox", { name: "Giờ", exact: true }).isDisabled(), true, "pending save locks edits");
  assert.deepEqual(await getFixture(), {
    guards: 4,
    writes: [[
      { questKey: "meCung", enabled: false, windows: [{ start: "23:00", end: "02:00" }] },
      { questKey: "cauCa", enabled: true, windows: [{ start: "14:37", end: "16:58" }] },
    ]],
    invalidated: [],
  });
  await page.evaluate(() => (window as Window & { questFixture?: FixtureState }).questFixture?.finishSave?.());
  await feedback.filter({ hasText: /Đã lưu/ }).waitFor();
  assert.equal(await readClock(clock(fishing, "Bắt đầu 1")), "14:37");
  assert.deepEqual((await getFixture()).invalidated, ["/admin", "/dashboard"]);

  await page.evaluate(() => {
    const host = window as Window & { blockQuestSaveForLegacyWorkers?: () => void };
    host.blockQuestSaveForLegacyWorkers!();
  });
  await save.click();
  await feedback.filter({ hasText: /khôi lỗi|worker/i }).waitFor({ timeout: 5_000 });
  assert.equal(await readClock(clock(fishing, "Bắt đầu 1")), "14:37");
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
  await page.getByRole("button", { name: "Auto Scaling", exact: true }).click();
  const autoscale = page.getByRole("region", { name: "Auto Scaling Khôi Lỗi" });
  const autoscaleClock = clock(autoscale, "Thời gian 1");
  assert.equal(await readClock(autoscaleClock), "23:07");
  const autoscaleMinutes = autoscaleClock.getByRole("combobox", { name: "Phút", exact: true });
  await autoscaleMinutes.press("ArrowDown");
  assert.equal(await readClock(autoscaleClock), "23:08", "clock parts support keyboard entry");
  await setClock(autoscaleClock, "00:59");
  await autoscale.getByRole("button", { name: "Lưu cấu hình và áp dụng" }).click();
  await autoscale.getByRole("status").filter({ hasText: /Đã lưu/ }).waitFor();
  assert.deepEqual(await page.evaluate(() => (window as unknown as Window & { questFixture: FixtureState }).questFixture.autoscaleWrites),
    [[{ time: "00:59", workers: 5 }]]);
  assert.equal(await readClock(autoscaleClock), "00:59");
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 0);

  await page.goto("http://quest-schedule.test/dashboard");
  await page.addStyleTag({ content: appCss.css + mobileCss });
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const userClock = page.getByRole("group", { name: "Giờ hẹn", exact: true });
  await userClock.waitFor();
  assert.equal(await readClock(userClock), "23:08");
  await setClock(userClock, "19:04");
  await page.getByRole("button", { name: "Lưu lịch hẹn" }).click();
  await page.getByText("Đã lưu lịch hẹn", { exact: true }).waitFor();
  assert.deepEqual(await page.evaluate(() => (window as unknown as Window & { questFixture: FixtureState }).questFixture.autoWrites),
    [[{ questKey: "meCung", hour: 19, minute: 4, second: 37 }]]);
  assert.equal(await readClock(userClock), "19:04");
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 0);
  console.log("PASS: 24-hour Admin Quest, Auto Scaling and Auto timers edit and save in en-US Chromium");
} finally {
  await browser.close();
}
