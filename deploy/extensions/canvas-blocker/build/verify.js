/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/*
 * End to end check of the Chrome port.
 *
 * Serves build/verify-page.html over http and loads it in two fresh Chrome
 * profiles - one plain, one with this extension - then compares what the page
 * can observe. It also attaches to the service worker to confirm the
 * declarativeNetRequest rules are installed and that a notification made it all
 * the way from the page world to the toolbar badge.
 *
 * Branded Chrome ignores --load-extension, so the extension is installed over
 * CDP with Extensions.loadUnpacked. That needs --remote-debugging-pipe together
 * with --enable-unsafe-extension-debugging, and has the pleasant side effect of
 * reporting manifest errors instead of silently doing nothing.
 *
 * Run with:  node build/verify.js [--chrome <path>]
 * Exits non-zero when a check fails.
 */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const {spawn} = require("child_process");

const root = path.resolve(__dirname, "..");
const PAGE = fs.readFileSync(path.join(__dirname, "verify-page.html"), "utf8");

const EXTENSION_PAGES = [
	"options/options.html",
	"options/navigator.html",
	"options/presets.html",
	"options/whitelist.html",
	"options/sanitize.html",
	"options/export.html",
	"browserAction/browserAction.html",
	"pageAction/pageAction.html"
];

function findChrome(){
	const fromArgument = process.argv.indexOf("--chrome");
	if (fromArgument !== -1 && process.argv[fromArgument + 1]){
		return process.argv[fromArgument + 1];
	}
	if (process.env.CHROME_PATH){
		return process.env.CHROME_PATH;
	}
	const candidates = [
		"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
		"C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
		"/usr/bin/google-chrome",
		"/usr/bin/chromium",
		"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
	];
	const found = candidates.find((candidate) => fs.existsSync(candidate));
	if (!found){
		throw new Error("No Chrome binary found. Pass --chrome <path> or set CHROME_PATH.");
	}
	return found;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function startServer(){
	return new Promise((resolve) => {
		const server = http.createServer((request, response) => {
			response.writeHead(200, {"Content-Type": "text/html; charset=utf-8"});
			response.end(PAGE);
		});
		server.listen(0, "127.0.0.1", () => resolve({server, port: server.address().port}));
	});
}

/** CDP over the --remote-debugging-pipe transport: fd 3 in, fd 4 out. */
class PipeCDP {
	constructor(child){
		this.write = child.stdio[3];
		this.read = child.stdio[4];
		this.id = 0;
		this.pending = new Map();
		this.events = [];
		let buffer = Buffer.alloc(0);
		this.read.on("data", (chunk) => {
			buffer = Buffer.concat([buffer, chunk]);
			let index;
			while ((index = buffer.indexOf(0)) !== -1){
				const raw = buffer.subarray(0, index).toString("utf8");
				buffer = buffer.subarray(index + 1);
				this.handle(JSON.parse(raw));
			}
		});
	}
	handle(message){
		if (message.id && this.pending.has(message.id)){
			const {resolve, reject} = this.pending.get(message.id);
			this.pending.delete(message.id);
			message.error?
				reject(new Error(message.error.message)):
				resolve(message.result);
		}
		else if (message.method){
			this.events.push(message);
			if (message.method === "Page.javascriptDialogOpening"){
				// Nothing in the default configuration should open one; dismiss
				// it anyway so a stray dialog cannot freeze the renderer.
				this.dialogs.push(message.params.message);
				this.send("Page.handleJavaScriptDialog", {accept: false}, message.sessionId)
					.catch(() => {});
			}
		}
	}
	send(method, params = {}, sessionId, timeout = 20000){
		this.id += 1;
		const id = this.id;
		const payload = {id, method, params};
		if (sessionId){
			payload.sessionId = sessionId;
		}
		return new Promise((resolve, reject) => {
			this.pending.set(id, {resolve, reject});
			this.write.write(JSON.stringify(payload) + "\0");
			setTimeout(() => {
				if (this.pending.has(id)){
					this.pending.delete(id);
					reject(new Error("CDP timeout: " + method));
				}
			}, timeout);
		});
	}
}
PipeCDP.prototype.dialogs = [];

function launch(chrome){
	const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "canvasblocker-verify-"));
	const child = spawn(chrome, [
		"--headless=new",
		"--disable-gpu",
		"--no-first-run",
		"--no-default-browser-check",
		"--disable-background-networking",
		"--remote-debugging-pipe",
		"--enable-unsafe-extension-debugging",
		`--user-data-dir=${userDataDir}`,
		"about:blank"
	], {stdio: ["ignore", "pipe", "pipe", "pipe", "pipe"]});
	child.stderr.resume();
	return {child, userDataDir};
}

async function evaluate(cdp, sessionId, expression, awaitPromise = false){
	const result = await cdp.send("Runtime.evaluate", {
		expression, awaitPromise, returnByValue: true
	}, sessionId);
	if (result.exceptionDetails){
		throw new Error("evaluate failed: " + JSON.stringify(result.exceptionDetails).slice(0, 300));
	}
	return result.result.value;
}

async function openPage(cdp, url){
	const {targetId} = await cdp.send("Target.createTarget", {url: "about:blank"});
	const {sessionId} = await cdp.send("Target.attachToTarget", {targetId, flatten: true});
	await cdp.send("Runtime.enable", {}, sessionId);
	await cdp.send("Log.enable", {}, sessionId).catch(() => {});
	await cdp.send("Page.enable", {}, sessionId);
	const eventOffset = cdp.events.length;
	await cdp.send("Page.navigate", {url}, sessionId);
	return {targetId, sessionId, eventOffset};
}

async function measure(chrome, url, {withExtension}){
	const {child, userDataDir} = launch(chrome);
	const cdp = new PipeCDP(child);
	cdp.dialogs = [];
	const out = {dialogs: cdp.dialogs};
	try {
		await sleep(1500);
		await cdp.send("Browser.getVersion");

		if (withExtension){
			const loaded = await cdp.send("Extensions.loadUnpacked", {path: root});
			out.extensionId = loaded.id;
			// Give the service worker time to start and apply its rules.
			await sleep(2500);

			const {targetInfos} = await cdp.send("Target.getTargets");
			const worker = targetInfos.find((target) =>
				target.type === "service_worker" && target.url.includes(loaded.id));
			if (!worker){
				throw new Error("the service worker did not start");
			}
			const {sessionId} = await cdp.send("Target.attachToTarget", {
				targetId: worker.targetId, flatten: true
			});
			out.workerSessionId = sessionId;
			await cdp.send("Runtime.enable", {}, sessionId);
			out.modules = await evaluate(cdp, sessionId, "Object.keys(scope).sort().join(',')");
			out.dynamicRules = JSON.parse(await evaluate(cdp, sessionId,
				"chrome.declarativeNetRequest.getDynamicRules().then(JSON.stringify)", true));
		}

		const page = await openPage(cdp, url);
		const deadline = Date.now() + 25000;
		while (Date.now() < deadline){
			const value = await evaluate(cdp, page.sessionId,
				"window.__cbDone? JSON.stringify(window.__cbResult): null");
			if (value){
				out.page = JSON.parse(value);
				break;
			}
			await sleep(300);
		}
		if (!out.page){
			throw new Error("the test page never finished - the renderer is most likely blocked");
		}

		if (withExtension){
			out.badge = JSON.parse(await evaluate(cdp, out.workerSessionId,
				"chrome.tabs.query({}).then(async (tabs) => {" +
				"  const tab = tabs.find((t) => t.url && t.url.startsWith('http://127.0.0.1:'));" +
				"  if (!tab){ return JSON.stringify({text: '', title: 'no tab'}); }" +
				"  const [text, title] = await Promise.all([" +
				"    chrome.action.getBadgeText({tabId: tab.id})," +
				"    chrome.action.getTitle({tabId: tab.id})" +
				"  ]);" +
				"  return JSON.stringify({text, title});" +
				"})", true));

			// Round trip through both worlds, the way the notification popup
			// collects its list: worker -> tabs.sendMessage -> bridge -> page
			// world -> bridge -> runtime.sendMessage -> worker.
			out.notificationRoundTrip = await evaluate(cdp, out.workerSessionId,
				"new Promise((resolve) => {" +
				"  const listener = (data) => {" +
				"    if (data && data['canvasBlocker-notificationCounter']){" +
				"      chrome.runtime.onMessage.removeListener(listener);" +
				"      resolve(Object.values(data['canvasBlocker-notificationCounter'])" +
				"        .map((entry) => entry.api + ':' + entry.count).sort().join(', '));" +
				"    }" +
				"  };" +
				"  chrome.runtime.onMessage.addListener(listener);" +
				"  chrome.tabs.query({}).then((tabs) => {" +
				"    const tab = tabs.find((t) => t.url && t.url.startsWith('http://127.0.0.1:'));" +
				"    if (!tab){ resolve('no tab'); return; }" +
				"    chrome.tabs.sendMessage(tab.id, {'canvasBlocker-sendNotifications': tab.id});" +
				"  });" +
				"  setTimeout(() => resolve('timed out'), 6000);" +
				"})", true);

			// Chrome silently falls back to a placeholder for icon formats it
			// cannot decode, and lib/notification.js swallows the rejection so a
			// closing tab does not log an error. Ask the API directly instead.
			out.icons = await evaluate(cdp, out.workerSessionId,
				"(async () => {" +
				"  const [tab] = await chrome.tabs.query({});" +
				"  const names = ['browserAction-notPrinted', 'browserAction-printed'," +
				"                 'browserAction-printedBlink', 'browserAction-whitelisted'];" +
				"  const results = [];" +
				"  for (const name of names){" +
				"    const path = {16: `/icons/png/${name}-16.png`, 32: `/icons/png/${name}-32.png`," +
				"                  48: `/icons/png/${name}-48.png`};" +
				"    try { await chrome.action.setIcon({tabId: tab.id, path}); results.push(name + ': ok'); }" +
				"    catch (error){ results.push(name + ': FAILED ' + error.message); }" +
				"  }" +
				"  return results.join(', ');" +
				"})()", true);

			out.pages = [];
			for (const relativePath of EXTENSION_PAGES){
				const extensionPage = await openPage(cdp, `chrome-extension://${out.extensionId}/${relativePath}`);
				await sleep(2000);
				const problems = cdp.events.slice(extensionPage.eventOffset)
					.filter((event) => event.sessionId === extensionPage.sessionId)
					.map(function(event){
						if (event.method === "Runtime.exceptionThrown"){
							const details = event.params.exceptionDetails;
							return "exception: " + String(
								(details.exception && details.exception.description) || details.text
							).split("\n")[0];
						}
						if (event.method === "Runtime.consoleAPICalled" && event.params.type === "error"){
							return "console.error: " + (event.params.args || [])
								.map((argument) => String(argument.value)).join(" ").slice(0, 160);
						}
						return null;
					})
					.filter(Boolean);
				const rendered = await evaluate(cdp, extensionPage.sessionId,
					"document.querySelectorAll('*').length").catch(() => -1);
				out.pages.push({page: relativePath, elements: rendered, problems: [...new Set(problems)]});
				await cdp.send("Target.closeTarget", {targetId: extensionPage.targetId}).catch(() => {});
			}
		}
	}
	finally {
		try { child.kill(); } catch (error){ /* already gone */ }
		await sleep(600);
		try { fs.rmSync(userDataDir, {recursive: true, force: true}); } catch (error){ /* windows lock */ }
	}
	return out;
}

function report(plain, guarded){
	const checks = [];
	const add = (name, passed, detail) => checks.push({name, passed, detail});

	const a = plain.page;
	const b = guarded.page;

	add("canvas toDataURL is faked", a.toDataURL !== b.toDataURL,
		`${a.toDataURL.length} vs ${b.toDataURL.length} bytes`);

	const componentsA = a.imageData.split(",");
	const componentsB = b.imageData.split(",");
	const differing = componentsA.filter((value, index) => value !== componentsB[index]).length;
	add("canvas getImageData is faked", differing > 0,
		`${differing} of ${componentsA.length} components differ`);

	add("identical canvases stay identical (cache)", b.twoIdenticalEqual === true,
		String(b.twoIdenticalEqual));

	add("screen size is faked", String(a.screen) !== String(b.screen),
		`${a.screen} -> ${b.screen}`);

	add("TextMetrics is faked", a.textMetrics !== b.textMetrics,
		`${a.textMetrics} -> ${b.textMetrics}`);

	add("fractional DOMRect is faked", String(a.fractionalDomRect) !== String(b.fractionalDomRect),
		`${a.fractionalDomRect} -> ${b.fractionalDomRect}`);

	add("integral DOMRect is left alone", String(a.domRect) === String(b.domRect),
		`${b.domRect}`);

	add("wrappers report native code",
		/\[native code\]/.test(b.toDataURLSource) &&
		/\[native code\]/.test(b.getImageDataSource) &&
		/\[native code\]/.test(b.functionToStringSource),
		b.toDataURLSource.replace(/\s+/g, " "));

	const leaks = Object.entries(b.leaks).filter(([, type]) => type !== "undefined");
	add("nothing leaks into the page scope", leaks.length === 0,
		leaks.length? JSON.stringify(b.leaks): "require/scope/browser/exports all undefined");

	add("channel handshake is cleaned up", b.handshakeAttribute === null,
		String(b.handshakeAttribute));

	// The inline <head> script reads a canvas before the settings can have
	// reached the page world. Comparing the whole data URL matters: every PNG
	// starts with the same header, so a prefix would always look identical.
	add("APIs are already protected at document_start",
		typeof b.early === "string" && !b.early.startsWith("THREW") && b.early !== a.early,
		b.early.startsWith("THREW")?
			b.early:
			`data URL ${a.early.length} bytes unprotected, ${b.early.length} bytes faked`);

	add("no javascript dialogs", guarded.dialogs.length === 0,
		guarded.dialogs.join(" | ") || "none");

	add("service worker loaded every module",
		guarded.modules.split(",").length >= 16, guarded.modules);

	const cspRule = guarded.dynamicRules.find((rule) =>
		rule.action.responseHeaders &&
		rule.action.responseHeaders.some((header) => header.header === "content-security-policy"));
	add("data-URL CSP rule installed", !!cspRule,
		cspRule? cspRule.action.responseHeaders[0].value: "missing");

	add("notification reached the toolbar",
		guarded.badge.text !== "" && /canvas/.test(guarded.badge.title),
		`badge "${guarded.badge.text}", title ${JSON.stringify(guarded.badge.title)}`);

	add("notification list round trips through both worlds",
		/:\d+/.test(guarded.notificationRoundTrip), guarded.notificationRoundTrip);

	add("every toolbar icon state is a decodable image",
		!/FAILED/.test(guarded.icons), guarded.icons);

	guarded.pages.forEach(function(entry){
		add(`page ${entry.page} renders without errors`,
			entry.elements > 5 && entry.problems.length === 0,
			`${entry.elements} elements${entry.problems.length? "; " + entry.problems.join("; "): ""}`);
	});

	let failed = 0;
	checks.forEach(function(check){
		if (!check.passed){
			failed += 1;
		}
		console.log(`${check.passed? "  ok  ": "  FAIL"}  ${check.name}`);
		console.log(`         ${check.detail}`);
	});
	console.log(`\n${checks.length - failed} of ${checks.length} checks passed.`);
	return failed;
}

async function main(){
	const chrome = findChrome();
	console.log("browser:", chrome);
	const {server, port} = await startServer();
	const url = `http://127.0.0.1:${port}/`;
	try {
		console.log("measuring without the extension ...");
		const plain = await measure(chrome, url, {withExtension: false});
		console.log("measuring with the extension ...\n");
		const guarded = await measure(chrome, url, {withExtension: true});
		const failed = report(plain, guarded);
		process.exitCode = failed? 1: 0;
	}
	finally {
		server.close();
	}
}

main().catch(function(error){
	console.error(error);
	process.exit(1);
});
