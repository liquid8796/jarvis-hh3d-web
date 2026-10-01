/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/*
 * Chrome port shim.
 *
 * Maps the WebExtension `browser.*` namespace that the original Firefox code
 * base uses onto Chrome's `chrome.*` namespace and fills in the handful of
 * entry points that behave differently under manifest V3.
 *
 * Must be the first script in every extension page and in the service worker.
 * It is NOT used inside the page (MAIN world) bundle - that context gets its
 * own bridge backed shim, see content/bridge.js and build/bundle.js.
 */
(function(global){
	"use strict";

	if (typeof global.chrome === "undefined" || !global.chrome.runtime){
		// Nothing to map onto - most likely a unit test environment.
		return;
	}

	const chrome = global.chrome;

	// Chrome's namespace objects are plain extensible objects, so the aliases
	// below can be attached directly. Keeping `this` bound to the original
	// namespace object matters: the API bindings reject foreign receivers.
	function define(object, name, value){
		if (!object || Object.prototype.hasOwnProperty.call(object, name)){
			return;
		}
		try {
			Object.defineProperty(object, name, {
				value: value,
				writable: true,
				configurable: true,
				enumerable: false
			});
		}
		catch (error){
			// Read only namespace - the callers all guard for the feature.
		}
	}

	// manifest V3 merged browserAction and pageAction into `action`.
	// `pageAction` is deliberately left undefined: the code base uses its
	// absence to detect "no per tab action available".
	define(chrome, "browserAction", chrome.action);

	define(chrome.runtime, "getBrowserInfo", function getBrowserInfo(){
		const match = (global.navigator && global.navigator.userAgent || "")
			.match(/(Edg|OPR|Chrome)\/([\d.]+)/);
		return Promise.resolve({
			name: match? (match[1] === "Edg"? "Edge": (match[1] === "OPR"? "Opera": "Chrome")): "Chrome",
			vendor: "Chromium",
			version: match? match[2]: "0",
			buildID: "0"
		});
	});

	global.browser = chrome;
}(typeof globalThis !== "undefined"? globalThis: self));
