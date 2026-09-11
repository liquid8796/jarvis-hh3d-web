#!/usr/bin/env node
/**
 * Offline preview of the real admin clients, with inert server actions and fixture props.
 * Preview: npx tsx scripts/verifyGithubNurtureUi.mts
 * Check:   npx tsx scripts/verifyGithubNurtureUi.mts --check
 * No env files, credentials, authentication, databases, GitHub, or Ollama are accessed.
 * The printed URL serves an isolated preview; forms resolve locally after a short delay.
 */
import { build } from "esbuild";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_SEARXNG_BASE_URL, DEFAULT_WEB_SEARCH_ENABLED, parseSearxngUrl, parseWebSearchSettings } from "../src/lib/validation/githubNurture";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = await mkdtemp(join(tmpdir(), "github-nurture-ui-"));
if (process.argv.includes("--check")) {
  assert.equal(DEFAULT_WEB_SEARCH_ENABLED, true);
  assert.equal(DEFAULT_SEARXNG_BASE_URL, "https://jarvis-searxng.vercel.app");
  assert.equal(parseSearxngUrl(DEFAULT_SEARXNG_BASE_URL + "/"), DEFAULT_SEARXNG_BASE_URL);
  assert.equal(parseSearxngUrl(DEFAULT_SEARXNG_BASE_URL + "/search/"), DEFAULT_SEARXNG_BASE_URL + "/search");
  assert.equal(parseSearxngUrl("https://PUBLIC-SEARX.org:443/search"), "https://public-searx.org/search");
  for (const input of [
    "", "http://public-searx.org", "https:public-searx.org", "https:///public-searx.org", "https://public-searx.org:8443",
    "https://user:password@public-searx.org", "https://@public-searx.org", "https://public-searx.org?format=json", "https://public-searx.org#search",
    "https://public-searx.org?", "https://public-searx.org#", "https://localhost", "https://search.local", "https://search.internal", "https://search.home.arpa",
    "https://metadata.google.internal", "https://127.0.0.1", "https://2130706433", "https://0x7f000001", "https://[::1]", "https://10.0.0.1", "https://192.168.1.1",
    "https://8.8.8.8", "https://search", "https://public-searx.org.", "https://public-searx.org/\nsearch", "https://public-searx.org\\search",
  ]) assert.throws(() => parseSearxngUrl(input));
  assert.deepEqual(parseWebSearchSettings(new FormData()), {});
  const currentForm = new FormData();
  currentForm.set("webSearchSettingsPresent", "1");
  assert.deepEqual(parseWebSearchSettings(currentForm), {webSearchEnabled:false});
  currentForm.set("webSearchEnabled", "on");
  assert.deepEqual(parseWebSearchSettings(currentForm), {webSearchEnabled:true});
  const endpointOnly = new FormData();
  endpointOnly.set("searxngBaseUrl", DEFAULT_SEARXNG_BASE_URL + "/search/");
  assert.deepEqual(parseWebSearchSettings(endpointOnly), {searxngBaseUrl:DEFAULT_SEARXNG_BASE_URL + "/search"});
  const existingSettings = {webSearchEnabled:false,searxngBaseUrl:"https://search.provider.org"};
  assert.deepEqual({...existingSettings, ...parseWebSearchSettings(new FormData())}, existingSettings);
  console.log("PASS: Jarvis Code search defaults and strict public HTTPS endpoint syntax.");
}

const mockActions = `
  const complete = (label) => async (_previous, form) => {
    globalThis.__fixtureSubmitted = {label, values:Object.fromEntries(form)};
    await new Promise(resolve => setTimeout(resolve, 1500));
    if (label === "provisionGithubStationAction") {
      const outcome = new URLSearchParams(location.search).get("outcome");
      if (outcome === "error") return {ok:false,stage:"preflight",slug:"sample-owner/existing-repo",message:"Kho GitHub đã tồn tại. Không có thay đổi nào được thực hiện.",warnings:[]};
      return {ok:true,stage:"complete",slug:"sample-owner/created-repo",message:"Đã tạo và đăng ký kho GitHub.",warnings:outcome === "warning" ? ["Kho đã đăng ký; lượt khởi chạy workflow cần được kiểm tra lại."] : []};
    }
    if (label === "deleteGithubCompanionAction" && form.get("confirmedRepo") !== form.get("repo")) {
      return {ok:false,message:"Nhập đúng tên kho phụ để xác nhận xoá vĩnh viễn."};
    }
    return {ok:true,message:"Bản xem thử: thao tác đã hoàn tất tại trình duyệt; không lưu hoặc gửi dữ liệu."};
  };
  export const saveGithubNurtureSettingsAction = complete("saveGithubNurtureSettingsAction");
  export const importGithubNurtureKeysAction = complete("importGithubNurtureKeysAction");
  export const deleteGithubNurtureKeyAction = complete("deleteGithubNurtureKeyAction");
  export const setGithubNurtureKeyDisabledAction = complete("setGithubNurtureKeyDisabledAction");
  export const saveGithubCompanionSettingsAction = complete("saveGithubCompanionSettingsAction");
  export const deleteGithubCompanionAction = complete("deleteGithubCompanionAction");
  export const saveGithubStationAction = complete("saveGithubStationAction");
  export const provisionGithubStationAction = complete("provisionGithubStationAction");
  export const updateGithubStationAction = complete("updateGithubStationAction");
  export const deleteGithubStationAction = complete("deleteGithubStationAction");
  export const pingGithubStationAction = complete("pingGithubStationAction");
  export const runKeepaliveAction = complete("runKeepaliveAction");
  export const revealGithubStationPatAction = async () => ({ok:false,message:"Két PAT không được mở trong bản xem thử."});
`;

const fixture = `
import React from "react";
import { createRoot } from "react-dom/client";
import { GithubNurtureSettings } from "@/app/admin/GithubNurtureSettings";
import { GithubCompanionDetail } from "@/app/admin/github/[owner]/[repo]/GithubCompanionDetail";
import { GithubStationPanel } from "@/app/admin/GithubStationPanel";
const stamp = "2026-09-10T08:00:00.000Z";
const config = {
  defaultCompanionCount:3, model:"gemma4:31b-cloud", contextWindow:32768,
  webSearchEnabled:true,searxngBaseUrl:"https://jarvis-searxng.vercel.app",
  apiKeys:["ready","cooldown","disabled","unused","error"].map((health,index) => ({
    id:"fixture-"+index, label:"Ollama fixture"+index, maskedKey:"••••••••",
    disabled:health==="disabled", cooldownUntil:health==="cooldown" ? "2026-09-11T08:00:00.000Z" : null,
    lastUsedAt:health==="unused" ? null : stamp, health,
  })),
};
const companion = {
  repo:"weather-data-workbench",lastNurtureDay:"2026-09-10",pushesToday:2,lastPushAt:stamp,
  lastPushOk:true,lastPushNote:"Đã bổ sung kiểm tra dữ liệu đầu vào và tài liệu sử dụng.",
  managedBy:"ollama",topic:"Công cụ phân tích dữ liệu thời tiết cho các dự án nghiên cứu nhỏ.",
  createdAt:stamp,nextDecisionAt:"2026-09-11T08:00:00.000Z",
};
const station = {
  slug:"sample-owner/primary-repo",owner:"sample-owner",repo:"primary-repo",
  githubId:101,
  provisionedBy:new URLSearchParams(location.search).get("managed") === "1" ? "jarvis" : undefined,
  workflowFile:"linh-su.yml",workerId:"github-sample",enabled:true,lastPingAt:stamp,lastCommitAt:stamp,
  lastPingOk:true,lastPingNote:"Workflow đang chạy.",workflowState:"active",daysToDisable:57,dailyPushes:5,
  companionCountOverride:null,allowCompanionFork:false,allowCompanionDelete:false,
  nurtureNextAt:"2026-09-11T08:00:00.000Z",nurtureLastNote:"Đang chờ quyết định tiếp theo của model.",nurturePending:null,
  companionRepos:[companion,{...companion,repo:"long-repository-name-"+"x".repeat(78),
    forkedFrom:"public-source-owner/"+"source".repeat(15),lastPushOk:false,lastPushNote:"API đang chờ giới hạn; sẽ thử lại ở vòng tiếp theo."},
    {...companion,repo:"legacy-tool",managedBy:undefined,topic:"Kho được đăng ký từ trước.",pendingDelete:true}],
};
const detail = {station,defaultCompanionCount:3,effectiveCompanionCount:3};
const view = new URLSearchParams(location.search).get("view") || "settings";
const stationList = new URLSearchParams(location.search).get("deletion") === "1" ? [
  station,
  {...station,slug:"sample-owner/second-primary",repo:"second-primary",githubId:102,companionRepos:station.companionRepos.slice(0,2)},
  {...station,slug:"other-owner/foreign-primary",owner:"other-owner",repo:"foreign-primary",githubId:201,companionRepos:station.companionRepos.slice(0,1)},
] : [station];
createRoot(document.getElementById("root")).render(
  <main className="mx-auto w-full max-w-6xl px-4 pb-24 sm:px-6">
    <nav className="card mb-5 mt-5 flex flex-wrap gap-4 p-4 text-sm">
      <strong>Offline fixture</strong><a href="/?view=settings">Ollama settings</a><a href="/?view=detail">Companion detail</a><a href="/?view=stations">Station list</a>
    </nav>
    {view === "detail" ? <GithubCompanionDetail detail={detail}/> : view === "stations" ? <GithubStationPanel stations={stationList}/> : <GithubNurtureSettings config={config}/>}
  </main>
);
`;

await build({
  stdin: { contents: fixture, loader: "tsx", sourcefile: "offline-github-nurture.tsx", resolveDir: root },
  bundle: true,
  outfile: join(output, "app.js"),
  platform: "browser",
  format: "iife",
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"development"' },
  plugins: [{
    name: "offline-admin-boundary",
    setup(builder) {
      builder.onResolve({ filter: /^@\/app\/actions\// }, () => ({ path: "actions", namespace: "offline" }));
      builder.onLoad({ filter: /.*/, namespace: "offline" }, () => ({ contents: mockActions, loader: "js" }));
      builder.onResolve({ filter: /^next\/(navigation|link)$/ }, (args) => ({ path: args.path, namespace: "offline-next" }));
      builder.onLoad({ filter: /.*/, namespace: "offline-next" }, (args) => ({
        contents: args.path === "next/link"
          ? 'import React from "react"; export default function Link({href, children, ...props}) { return React.createElement("a", {href: String(href).startsWith("/admin/github/") ? "/?view=detail" : href, ...props}, children); }'
          : 'export const useRouter = () => ({refresh(){},push(){}}); export const usePathname=()=>location.pathname; export const useSearchParams=()=>new URLSearchParams(location.search);',
        loader: "js", resolveDir: root,
      }));
      builder.onResolve({ filter: /^@\// }, (args) => {
        const base = resolve(root, "src", args.path.slice(2));
        return { path: existsSync(`${base}.ts`) ? `${base}.ts` : `${base}.tsx` };
      });
    },
  }],
});

const staticRoot = join(root, ".next", "static");
const staticAssets = new Map<string, Buffer>();
async function collect(folder: string, prefix = "") {
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const relative = prefix + entry.name;
    if (entry.isDirectory()) await collect(join(folder, entry.name), relative + "/");
    else staticAssets.set("/_next/static/" + relative, await readFile(join(folder, entry.name)));
  }
}
if (existsSync(staticRoot)) await collect(staticRoot);
let css = [...staticAssets].filter(([path]) => path.endsWith(".css")).map(([, data]) => data.toString("utf8")).join("\n");
if (!css || process.argv.includes("--check")) {
  const { default: postcss } = await import("postcss");
  const { default: tailwind } = await import("@tailwindcss/postcss");
  const source = join(root, "src", "app", "globals.css");
  // Keep Next font declarations, and compile current source classes when checking edits
  // made after the last application build.
  css += "\n" + (await postcss([tailwind()]).process(await readFile(source, "utf8"), { from: source })).css;
}
await writeFile(join(output, "styles.css"), css, "utf8");
const script = await readFile(join(output, "app.js"));
const html = `<!doctype html><html lang="vi"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>GitHub Nurture Offline UI</title><link rel="stylesheet" href="/styles.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>`;
const server = createServer((request, response) => {
  const path = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
  response.setHeader("Content-Security-Policy", "default-src 'self'; connect-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data:");
  if (request.method !== "GET") { response.writeHead(405); response.end("Fixture accepts GET only"); return; }
  const asset = staticAssets.get(path);
  const body = path === "/app.js" ? script : path === "/styles.css" ? css : asset ?? (path === "/" ? html : null);
  if (body === null) { response.writeHead(404); response.end("Not found"); return; }
  const type = path.endsWith(".js") ? "text/javascript" : path.endsWith(".css") ? "text/css" : path.endsWith(".woff2") ? "font/woff2" : "text/html";
  response.writeHead(200, { "Content-Type": `${type}; charset=utf-8`, "Cache-Control": "no-store" });
  response.end(body);
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
if (!address || typeof address === "string") throw new Error("Fixture server did not bind a TCP port.");
console.log(`Offline fixture: http://127.0.0.1:${address.port}/?view=settings`);
console.log(`Detail: http://127.0.0.1:${address.port}/?view=detail`);
console.log(`Station list: http://127.0.0.1:${address.port}/?view=stations`);
console.log(`Artifacts: ${output}`);
if (!process.argv.includes("--check")) {
  console.log("Check widths 390 and 1366; forms show a disabled/pending state for 1.5 seconds. Ctrl+C stops the preview.");
} else {
  const { chromium } = await import("playwright-core");
  const origin = `http://127.0.0.1:${address.port}`;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  const report: Array<{view:string;width:number;scrollWidth:number;screenshot:string}> = [];
  const failures: string[] = [];
  try {
    // Fresh headless profile for this local fixture only; no access to a user browser.
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    await context.route("**/*", (route) => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    for (const width of [390, 1366]) {
      const page = await context.newPage();
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      page.on("pageerror", (error) => failures.push(error.message));
      for (const view of ["settings", "detail", "stations"]) {
        await page.goto(`${origin}/?view=${view}`);
        await page.locator("main section").first().waitFor();
        await page.evaluate(() => document.fonts.ready);
        const dimensions = await page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          overflow: [...document.querySelectorAll("main *")].filter((node) => {
            const bounds = node.getBoundingClientRect();
            return bounds.width > 0 && (bounds.right > innerWidth + 1 || bounds.left < -1);
          }).slice(0, 8).map((node) => ({tag:node.tagName,cls:node.className,text:node.textContent?.slice(0,100)})),
        }));
        const screenshot = join(output, `${view}-${width}.png`);
        await page.screenshot({ path: screenshot, fullPage: true });
        report.push({ view, width, scrollWidth: dimensions.scrollWidth, screenshot });
        if (dimensions.scrollWidth > width + 1) failures.push(`${view}/${width} overflow: ${JSON.stringify(dimensions)}`);
      }
      for (const outcome of ["success", "warning", "error"]) {
        await page.goto(`${origin}/?view=stations&outcome=${outcome}`);
        const createForm = page.locator("form").filter({ has: page.locator("#station-pat") });
        assert.equal(await createForm.locator("input[name=owner],input[name=workerId],textarea[name=companionRepos],input[name=enabled]").count(), 0);
        assert.equal(await createForm.locator("input").count(), 4);
        assert.equal(await page.locator("#station-pat").getAttribute("type"), "password");
        assert.notEqual(await page.locator("#station-pat").getAttribute("required"), null);
        for (const selector of ["#station-repo", "#station-workflow", "#station-daily-pushes"]) {
          assert.equal(await page.locator(selector).inputValue(), "");
          assert.equal(await page.locator(selector).getAttribute("required"), null);
        }
        assert.equal(await page.locator("#station-workflow").getAttribute("placeholder"), "linh-su.yml");
        assert.equal(await page.locator("#station-repo").getAttribute("placeholder"), "Để trống để Ollama tự đặt tên");
        assert.match(await createForm.innerText(), /Ollama tự chọn tên, không dùng khuôn cố định/);
        assert.match(await createForm.innerText(), /lỗi sẽ dừng tạo kho/);
        assert.equal(await page.locator("#station-daily-pushes").getAttribute("placeholder"), "5");
        await page.locator("#station-pat").fill("offline-fixture-pat");
        await page.getByRole("button", { name: "Tạo repo + workflow", exact: true }).click();
        const pending = page.getByRole("button", { name: "Đang tạo repo + workflow…", exact: true });
        await pending.waitFor();
        assert.ok(await pending.isDisabled());
        assert.ok(await page.locator("#station-pat").isDisabled());
        if (outcome === "success") await page.screenshot({ path: join(output, `create-pending-${width}.png`), fullPage: true });
        await page.getByRole("button", { name: "Tạo repo + workflow", exact: true }).waitFor();
        const submitted = await page.evaluate(() => (window as typeof window & { __fixtureSubmitted: { label: string; values: Record<string, string> } }).__fixtureSubmitted);
        assert.equal(submitted.label, "provisionGithubStationAction");
        assert.deepEqual(submitted.values, { pat: "offline-fixture-pat", repo: "", workflowFile: "", dailyPushes: "" });
        const status = page.locator("section[aria-labelledby=station-form-title]").getByRole("status");
        assert.match(await status.innerText(), outcome === "error" ? /Kho GitHub đã tồn tại/ : /Đã tạo và đăng ký/);
        assert.match(await status.innerText(), outcome === "error" ? /sample-owner\/existing-repo/ : /sample-owner\/created-repo/);
        assert.equal(await status.locator("li").count(), outcome === "warning" ? 1 : 0);
        if (outcome === "warning") assert.match(await status.innerText(), /cần được kiểm tra lại/);
        assert.ok(!(await status.innerText()).includes("offline-fixture-pat"));
        const screenshot = join(output, `create-${outcome}-${width}.png`);
        await page.screenshot({ path: screenshot, fullPage: true });
        const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
        report.push({ view: `create-${outcome}`, width, scrollWidth, screenshot });
        if (scrollWidth > width + 1) failures.push(`create-${outcome}/${width} overflow: ${scrollWidth}`);
      }
      for (const managed of [false, true]) {
        await page.goto(`${origin}/?view=stations&managed=${managed ? "1" : "0"}`);
        await page.getByRole("button", { name: "Sửa", exact: true }).click();
        const editForm = page.locator("form").filter({ has: page.locator("#station-pat") });
        assert.equal(await editForm.locator("input[name=owner],input[name=repo],textarea[name=companionRepos]").count(), 0);
        assert.equal(await editForm.locator("input[name=slug]").inputValue(), "sample-owner/primary-repo");
        assert.equal(await page.locator("#station-pat").inputValue(), "");
        assert.equal(await page.locator("#station-pat").getAttribute("required"), null);
        assert.match(await editForm.innerText(), /sample-owner\/primary-repo/);
        assert.equal(await page.locator("#station-daily-pushes").inputValue(), "5");
        if (managed) {
          assert.equal(await editForm.locator("input[name=workflowFile],input[name=workerId]").count(), 0);
          assert.match(await editForm.innerText(), /Workflow: linh-su.yml/);
          assert.match(await editForm.innerText(), /WORKER_ID: github-sample/);
        } else {
          assert.equal(await page.locator("#station-workflow").inputValue(), "linh-su.yml");
          await page.locator("#station-workflow").fill("corrected.yaml");
          await page.locator("#station-worker").fill("correct-worker");
        }
        await page.locator("#station-daily-pushes").fill("0");
        await page.locator("#station-enabled").uncheck();
        await page.getByRole("button", { name: "Cập nhật kho", exact: true }).click();
        const updating = page.getByRole("button", { name: "Đang cập nhật…", exact: true });
        await updating.waitFor(); assert.ok(await updating.isDisabled());
        await page.getByRole("button", { name: "Cập nhật kho", exact: true }).waitFor();
        const submitted = await page.evaluate(() => (window as typeof window & { __fixtureSubmitted: { label: string; values: Record<string, string> } }).__fixtureSubmitted);
        assert.equal(submitted.label, "updateGithubStationAction");
        assert.equal(submitted.values.slug, "sample-owner/primary-repo");
        assert.equal(submitted.values.dailyPushes, "0"); assert.equal(submitted.values.enabledPresent, "1"); assert.equal(submitted.values.enabled, undefined);
        assert.equal(submitted.values.owner, undefined); assert.equal(submitted.values.repo, undefined); assert.equal(submitted.values.companionRepos, undefined);
        assert.equal(submitted.values.workflowFile, managed ? undefined : "corrected.yaml"); assert.equal(submitted.values.workerId, managed ? undefined : "correct-worker");
        const screenshot = join(output, `edit-${managed ? "managed" : "legacy"}-${width}.png`);
        await page.screenshot({ path: screenshot, fullPage: true });
        const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
        report.push({ view: `edit-${managed ? "managed" : "legacy"}`, width, scrollWidth, screenshot });
        if (scrollWidth > width + 1) failures.push(`edit/${width} overflow: ${scrollWidth}`);
        await page.getByRole("button", { name: "Tạo kho mới", exact: true }).click();
        assert.equal(await page.locator("#station-repo").inputValue(), "");
        assert.equal(await page.locator("section[aria-labelledby=station-form-title]").getByRole("status").count(), 0);
      }
      await page.goto(`${origin}/?view=stations&deletion=1`);
      let accountDeleteConfirmation = "";
      page.once("dialog", async (dialog) => {
        accountDeleteConfirmation = dialog.message();
        await dialog.dismiss();
      });
      await page.getByRole("button", { name: "Xoá", exact: true }).first().click();
      assert.match(accountDeleteConfirmation, /XÓA VĨNH VIỄN 2 REPO CHÍNH/);
      assert.match(accountDeleteConfirmation, /sample-owner/);
      assert.match(accountDeleteConfirmation, /5 repo phụ đã đăng ký sẽ được GIỮ NGUYÊN trên GitHub/);
      assert.match(accountDeleteConfirmation, /tài khoản không còn truy cập được/);
      assert.match(accountDeleteConfirmation, /chỉ xoá các station khỏi sổ/);
      const expectedGroup = await page.locator('input[name="expectedGroup"]').first().inputValue();
      assert.equal(expectedGroup, "sample-owner/primary-repo#101\nsample-owner/second-primary#102");
      assert.equal(await page.getByRole("button", { name: "Đang xoá kho chính…", exact: true }).count(), 0);
      assert.equal(await page.evaluate(() => (globalThis as typeof globalThis & { __fixtureSubmitted?: unknown }).__fixtureSubmitted ?? null), null);
      const deleteScreenshot = join(output, `primary-delete-confirm-cancel-${width}.png`);
      await page.screenshot({ path: deleteScreenshot, fullPage: true });
      const deleteScrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      report.push({ view: "primary-delete-confirm-cancel", width, scrollWidth: deleteScrollWidth, screenshot: deleteScreenshot });
      if (deleteScrollWidth > width + 1) failures.push(`primary-delete-confirm/${width} overflow: ${deleteScrollWidth}`);
      await page.close();
    }

    const page = await context.newPage();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${origin}/?view=settings`);
    assert.equal(await page.locator("#nurture-default-count").inputValue(), "3");
    assert.equal(await page.locator("#nurture-context").getAttribute("min"), "8192");
    assert.equal(await page.locator("#nurture-web-search").isChecked(), true);
    assert.equal(await page.locator("#nurture-searxng").inputValue(), "https://jarvis-searxng.vercel.app");
    await page.locator("#nurture-web-search").uncheck();
    assert.equal(await page.locator("input[name=webSearchSettingsPresent]").inputValue(), "1");
    await page.getByRole("button", { name: "Lưu cấu hình Ollama", exact: true }).click();
    const saving = page.getByRole("button", { name: "Đang lưu…", exact: true });
    await saving.waitFor();
    assert.ok(await saving.isDisabled());
    await page.screenshot({ path: join(output, "settings-pending-390.png"), fullPage: true });
    await page.getByRole("button", { name: "Lưu cấu hình Ollama", exact: true }).waitFor();
    await page.locator("#nurture-api-keys").fill("offline-fixture-key-one");
    await page.locator("#nurture-key-file").setInputFiles({ name: "fixture-keys.json", mimeType: "application/json", buffer: Buffer.from('["offline-fixture-key-two"]') });
    await page.getByRole("button", { name: "Nhập API key", exact: true }).click();
    const importing = page.getByRole("button", { name: "Đang mã hoá và nhập…", exact: true });
    await importing.waitFor();
    assert.ok(await importing.isDisabled());
    await page.getByRole("button", { name: "Nhập API key", exact: true }).waitFor();
    assert.equal(await page.getByRole("status").count(), 2);
    const toggle = page.getByRole("button", { name: "Tạm tắt", exact: true }).first();
    await toggle.click();
    assert.ok(await toggle.isDisabled());
    await page.waitForFunction(() => [...document.querySelectorAll("button")].some((button) => button.textContent === "Tạm tắt" && !button.disabled));
    let keyConfirmation = "";
    page.once("dialog", async (dialog) => { keyConfirmation = dialog.message(); await dialog.dismiss(); });
    await page.getByRole("button", { name: "Xoá key", exact: true }).first().click();
    assert.match(keyConfirmation, /cần nhập lại key/);
    assert.equal(await page.getByRole("button", { name: "Xoá key", exact: true }).count(), 5);

    await page.goto(`${origin}/?view=detail`);
    assert.equal(await page.locator("#companion-count").inputValue(), "");
    assert.equal(await page.locator("#companion-count").getAttribute("placeholder"), "Dùng mặc định (3)");
    assert.equal(await page.locator("input[name=allowCompanionFork]").isChecked(), false);
    assert.equal(await page.locator("input[name=allowCompanionDelete]").isChecked(), false);
    await page.locator("#companion-count").fill("0");
    await page.getByRole("button", { name: "Lưu cấu hình kho", exact: true }).click();
    await page.getByRole("button", { name: "Đang lưu…", exact: true }).waitFor();
    assert.ok(await page.getByRole("button", { name: "Đang lưu…", exact: true }).isDisabled());
    await page.getByRole("button", { name: "Lưu cấu hình kho", exact: true }).waitFor();
    let confirmation = "";
    page.once("dialog", async (dialog) => { confirmation = dialog.message(); await dialog.dismiss(); });
    await page.locator('input[name="confirmedRepo"]').first().fill("weather-data-workbench");
    await page.getByRole("button", { name: "Xoá kho phụ", exact: true }).first().click();
    assert.match(confirmation, /VĨNH VIỄN/);
    assert.match(confirmation, /tự tạo kho thay thế ở vòng tiếp theo/);
    assert.equal(await page.locator("article").count(), 3);
    assert.equal(await page.getByRole("button", { name: "Đang xoá…", exact: true }).count(), 0);
    await page.screenshot({ path: join(output, "detail-confirm-cancel-390.png"), fullPage: true });
    console.log(JSON.stringify({ report, failures }, null, 2));
    await writeFile(join(output, "report.json"), JSON.stringify({ report, failures }, null, 2), "utf8");
    assert.deepEqual(failures, [], "Browser errors or horizontal overflow detected");
    console.log("PASS: 390/1366 layout; create defaults/pending/success/warning/error; immutable managed and editable legacy station forms; account-wide primary and companion delete confirmation cancellation; settings/key pending states.");
  } finally {
    await browser?.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}
