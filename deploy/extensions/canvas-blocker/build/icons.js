/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/*
 * Renders the shipped SVG icons to PNG.
 *
 * Firefox accepts SVG for the toolbar and extension icons; Chrome does not, and
 * silently falls back to a generic placeholder. Chrome itself is used as the
 * renderer so the result matches what the browser would have drawn.
 *
 * Run with:  node build/icons.js [--chrome "C:\\path\\to\\chrome.exe"]
 * The generated PNGs are committed, so this only has to run when an SVG changes.
 */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const {execFileSync} = require("child_process");

const root = path.resolve(__dirname, "..");
const outputDirectory = path.join(root, "icons", "png");

/* The extension icon needs 128 for the web store, the toolbar icon does not. */
const TARGETS = [
	{name: "icon", sizes: [16, 32, 48, 128]},
	{name: "browserAction-notPrinted", sizes: [16, 32, 48]},
	{name: "browserAction-printed", sizes: [16, 32, 48]},
	{name: "browserAction-printedBlink", sizes: [16, 32, 48]},
	{name: "browserAction-whitelisted", sizes: [16, 32, 48]}
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
		"C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
		"C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
		"/usr/bin/google-chrome",
		"/usr/bin/chromium",
		"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
	];
	const found = candidates.find(function(candidate){
		return fs.existsSync(candidate);
	});
	if (!found){
		throw new Error(
			"No Chrome binary found. Pass one with --chrome <path> or set CHROME_PATH."
		);
	}
	return found;
}

function wrapperPage(svgPath, size){
	// file:// URLs need forward slashes on Windows too.
	const url = "file:///" + svgPath.replace(/\\/g, "/");
	return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
html, body {margin: 0; padding: 0; background: transparent; overflow: hidden;}
img {display: block; width: ${size}px; height: ${size}px;}
</style></head><body><img src="${url}"></body></html>`;
}

function main(){
	const chrome = findChrome();
	console.log("renderer:", chrome);
	fs.mkdirSync(outputDirectory, {recursive: true});

	const workDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "canvasblocker-icons-"));
	// A throwaway profile: without it Chrome would try to reuse the running
	// instance and never take the screenshot.
	const profileDirectory = path.join(workDirectory, "profile");

	let rendered = 0;
	try {
		TARGETS.forEach(function(target){
			const svgPath = path.join(root, "icons", `${target.name}.svg`);
			if (!fs.existsSync(svgPath)){
				throw new Error(`Missing source icon: ${svgPath}`);
			}
			target.sizes.forEach(function(size){
				const pagePath = path.join(workDirectory, `${target.name}-${size}.html`);
				const pngPath = path.join(outputDirectory, `${target.name}-${size}.png`);
				fs.writeFileSync(pagePath, wrapperPage(svgPath, size), "utf8");
				execFileSync(chrome, [
					"--headless=new",
					"--disable-gpu",
					"--hide-scrollbars",
					"--force-device-scale-factor=1",
					"--default-background-color=00000000",
					`--user-data-dir=${profileDirectory}`,
					`--window-size=${size},${size}`,
					`--screenshot=${pngPath}`,
					"--allow-file-access-from-files",
					"file:///" + pagePath.replace(/\\/g, "/")
				], {stdio: ["ignore", "ignore", "pipe"]});

				if (!fs.existsSync(pngPath) || fs.statSync(pngPath).size === 0){
					throw new Error(`Chrome produced no image for ${target.name} at ${size}px`);
				}
				rendered += 1;
				console.log(`  icons/png/${target.name}-${size}.png`);
			});
		});
	}
	finally {
		fs.rmSync(workDirectory, {recursive: true, force: true});
	}
	console.log(`${rendered} PNG icon(s) written to icons/png/`);
}

main();
