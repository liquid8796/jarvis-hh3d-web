/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/*
 * Builds the page-world half of the content script.
 *
 * Chrome runs MAIN world content scripts in the page's own global scope. Listing
 * the lib/ files individually in the manifest would therefore publish `require`,
 * `scope` and every module to the page - trivially detectable and trivially
 * disabled. They are concatenated into one closure instead, with a prologue that
 * supplies the two globals the modules expect: `require` and a `browser` object
 * backed by content/bridge.js.
 *
 * Run with:  node build/bundle.js
 */
"use strict";

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");

/*
 * Same order as the content_scripts list of the original Firefox manifest.
 * lib/require.js is missing on purpose - the prologue provides an equivalent
 * that keeps the module registry inside the closure. lib/frame.js has to stay
 * last: it starts the interception when it runs.
 */
const CONTENT_MODULES = [
	"lib/logging.js",
	"lib/extension.js",
	"lib/settingDefinitions.js",
	"lib/settingContainers.js",
	"lib/settings.js",
	"lib/colorStatistics.js",
	"lib/webglRandom.js",
	"lib/webgl.js",
	"lib/hash.js",
	"lib/modifiedAPIFunctions.js",
	"lib/modifiedCanvasAPI.js",
	"lib/modifiedAudioAPI.js",
	"lib/modifiedHistoryAPI.js",
	"lib/modifiedWindowAPI.js",
	"lib/modifiedDOMRectAPI.js",
	"lib/modifiedSVGAPI.js",
	"lib/modifiedTextMetricsAPI.js",
	"lib/navigator.js",
	"lib/modifiedNavigatorAPI.js",
	"lib/modifiedScreenAPI.js",
	"lib/modifiedAPI.js",
	"lib/randomSupplies.js",
	"lib/intercept.js",
	"lib/callingStack.js",
	"lib/askForPermission.js",
	"lib/lists.js",
	"lib/check.js",
	"lib/iframeProtection.js",
	"lib/frame.js"
];

const OUTPUT = "content/injected.js";
const MESSAGE_KEYS_OUTPUT = "content/messageKeys.js";

const PROLOGUE = `/* GENERATED FILE - do not edit. Run "node build/bundle.js" instead. */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
(function(){
"use strict";

/*
 * Everything below runs in the page's own global scope. Nothing may leak out of
 * this closure, so \`require\`, \`browser\` and \`exports\` are declared here and
 * shadow anything the page might define under the same names.
 */

const HANDSHAKE_ATTRIBUTE = "data-canvasblocker-channel";

// Shadows a page level \`exports\`: the modules use \`typeof exports\` to decide
// between CommonJS and the require registry, and must always pick the latter.
const exports = undefined;

/*
 * Natives captured while the page is still empty. Everything below runs in the
 * page's own global scope, so a site could otherwise replace
 * document.dispatchEvent (or JSON.stringify) later on and read every message
 * that crosses to content/bridge.js - the settings, the whitelist, the
 * notifications. Nothing has executed in this document yet at document_start,
 * so these references are guaranteed to be the real ones.
 * The isolated-world half needs no such care: a page cannot reach into it.
 */
const nativeDispatchEvent = document.dispatchEvent.bind(document);
const nativeAddEventListener = document.addEventListener.bind(document);
const NativeCustomEvent = window.CustomEvent;
const nativeStringify = JSON.stringify;
const nativeParse = JSON.parse;
const nativeGetRandomValues = crypto.getRandomValues.bind(crypto);

function createToken(){
	const buffer = new Uint8Array(16);
	nativeGetRandomValues(buffer);
	return Array.prototype.map.call(buffer, function(byte){
		return byte.toString(16).padStart(2, "0");
	}).join("");
}

// The MAIN world has no chrome.runtime, but the injected script's own frames
// still carry its chrome-extension:// URL in a stack trace.
function detectBaseURL(){
	const stack = (new Error()).stack || "";
	const match = /((?:chrome|moz|safari-web|extension)-extension:\\/\\/[^\\/\\s)]+\\/)/.exec(stack);
	return match? match[1]: "";
}

let token = null;
let baseURL = detectBaseURL();
let incognito = false;

const root = document.documentElement;
if (root){
	const existing = root.getAttribute(HANDSHAKE_ATTRIBUTE);
	if (existing){
		// content/bridge.js got here first and left the channel name behind.
		root.removeAttribute(HANDSHAKE_ATTRIBUTE);
		try {
			const handshake = nativeParse(existing);
			token = handshake.t || null;
			baseURL = baseURL || handshake.u || "";
			incognito = !!handshake.i;
		}
		catch (error){
			token = null;
		}
	}
}
if (!token){
	token = createToken();
	if (root){
		root.setAttribute(HANDSHAKE_ATTRIBUTE, nativeStringify({t: token}));
	}
}

if (!baseURL){
	// Last resort. It must not be the empty string: intercept.js and
	// callingStack.js test stack frames against this prefix, and "" matches
	// every one of them - which would allow every call instead of faking it.
	baseURL = "canvasblocker-unknown-origin-" + token + "://";
}

const TO_BRIDGE = token + "-o";
const FROM_BRIDGE = token + "-i";

const listeners = {runtimeMessage: [], storageChanged: [], portMessage: []};
const pendingRequests = new Map();
let requestId = 0;
let messages = Object.create(null);

let resolveSettings;
const settingsPromise = new Promise(function(resolve){
	resolveSettings = resolve;
});

function post(message){
	nativeDispatchEvent(new NativeCustomEvent(TO_BRIDGE, {
		detail: nativeStringify(message)
	}));
}

function request(type, payload){
	return new Promise(function(resolve, reject){
		requestId += 1;
		const id = requestId;
		pendingRequests.set(id, {resolve: resolve, reject: reject});
		post(Object.assign({type: type, id: id}, payload));
	});
}

nativeAddEventListener(FROM_BRIDGE, function(event){
	let message;
	try {
		message = nativeParse(event.detail);
	}
	catch (error){
		return;
	}
	switch (message.type){
		case "init": {
			if (message.url){
				baseURL = message.url;
			}
			incognito = !!message.incognito;
			messages = message.messages || Object.create(null);
			// extension.js snapshots inIncognitoContext at load time, which is
			// before this message arrives when this half was injected first.
			// It is read again on every use, so updating it here is enough.
			if (require.exists("./extension")){
				require("./extension").inIncognitoContext = incognito;
			}
			break;
		}
		case "settings":
			resolveSettings(message.data || {});
			break;
		case "storageChanged":
			listeners.storageChanged.forEach(function(callback){
				callback(message.changes, message.area);
			});
			break;
		case "runtimeMessage":
			listeners.runtimeMessage.forEach(function(callback){
				callback(message.data);
			});
			break;
		case "portMessage":
			listeners.portMessage.forEach(function(callback){
				callback(message.data);
			});
			break;
		case "reply": {
			const pending = pendingRequests.get(message.id);
			if (pending){
				pendingRequests.delete(message.id);
				if (message.error){
					pending.reject(new Error(message.error));
				}
				else {
					pending.resolve();
				}
			}
			break;
		}
		default:
			break;
	}
}, false);

const port = {
	postMessage: function postMessage(data){
		post({type: "portMessage", data: data});
	},
	onMessage: {
		addListener: function(callback){
			listeners.portMessage.push(callback);
		}
	},
	onDisconnect: {
		// The bridge reconnects transparently, so the page side never sees one.
		addListener: function(){}
	},
	disconnect: function(){}
};

const browser = {
	i18n: {
		// Synchronous by contract. The bridge ships the strings the page side can
		// display; anything not yet delivered falls back to the message id.
		getMessage: function getMessage(id){
			return messages[id] || "";
		}
	},
	runtime: {
		getURL: function getURL(relativePath){
			return baseURL + String(relativePath === undefined || relativePath === null? "": relativePath)
				.replace(/^\\//, "");
		},
		connect: function connect(){
			return port;
		},
		onMessage: {
			addListener: function(callback){
				listeners.runtimeMessage.push(callback);
			}
		},
		sendMessage: function sendMessage(data){
			post({type: "runtimeMessage", data: data});
			return Promise.resolve();
		}
	},
	extension: {
		get inIncognitoContext(){
			return incognito;
		}
	},
	storage: {
		local: {
			get: function get(){
				return settingsPromise;
			},
			set: function set(data){
				return request("storageSet", {data: data});
			},
			remove: function remove(key){
				return request("storageRemove", {key: key});
			}
		},
		onChanged: {
			addListener: function(callback){
				listeners.storageChanged.push(callback);
			}
		}
	}
};

// Equivalent of lib/require.js, but with the registry kept inside the closure
// instead of on \`globalThis\`.
const require = function(){
	const moduleScope = {};

	function getScopeName(module){
		return module.replace(/^\\..*\\//, "").replace(/\\..+/, "");
	}

	function require(module){
		if (module.startsWith(".")){
			return moduleScope[getScopeName(module)];
		}
		throw new ReferenceError("Unable to get non relative module " + module + "!");
	}

	require.register = function(moduleName, module = {}){
		const scopeName = getScopeName(moduleName);
		if (!Object.prototype.hasOwnProperty.call(moduleScope, scopeName)){
			moduleScope[scopeName] = module;
			return module;
		}
		return moduleScope[scopeName];
	};

	require.exists = function(module){
		return Object.prototype.hasOwnProperty.call(moduleScope, getScopeName(module));
	};

	return require;
}();

// Tell the bridge we are listening. Whichever half was injected second would
// otherwise miss the other's opening message.
post({type: "ready"});
`;

const EPILOGUE = `
}());
`;

function readModule(relativePath){
	const file = path.join(root, relativePath);
	if (!fs.existsSync(file)){
		throw new Error(`Content module not found: ${relativePath}`);
	}
	return fs.readFileSync(file, "utf8");
}

/*
 * The page world cannot call chrome.i18n synchronously, so the bridge has to
 * ship the strings up front. Only the ones the page world can actually display
 * are collected - scanning beats maintaining a list by hand.
 */
function collectMessageKeys(sources){
	const keys = new Set();
	const pattern = /(?:extension\.getTranslation|getTranslation|(?<![\w$.])_)\(\s*"([^"]+)"/g;
	sources.forEach(function(source){
		let match;
		while ((match = pattern.exec(source)) !== null){
			// Same normalisation lib/extension.js and build/locales.js apply.
			keys.add(match[1].replace(/[^A-Za-z0-9_]/g, "_"));
		}
	});
	return Array.from(keys).sort();
}

function verifyMessageKeys(keys){
	const messagesFile = path.join(root, "_locales/en/messages.json");
	const messages = JSON.parse(fs.readFileSync(messagesFile, "utf8"));
	const missing = keys.filter(function(key){
		return !Object.prototype.hasOwnProperty.call(messages, key);
	});
	if (missing.length){
		console.warn(
			"warning: these translation keys are used by the content script but " +
			"are not in _locales/en/messages.json: " + missing.join(", ")
		);
	}
	return keys.filter(function(key){
		return Object.prototype.hasOwnProperty.call(messages, key);
	});
}

function main(){
	const sources = CONTENT_MODULES.map(readModule);

	const bundle = PROLOGUE +
		CONTENT_MODULES.map(function(relativePath, index){
			return `\n/* ===== ${relativePath} ===== */\n${sources[index]}\n;\n`;
		}).join("") +
		EPILOGUE;

	fs.writeFileSync(path.join(root, OUTPUT), bundle, "utf8");
	console.log(`${OUTPUT}: ${CONTENT_MODULES.length} modules, ${bundle.length} bytes`);

	const keys = verifyMessageKeys(collectMessageKeys(sources));
	const messageKeysFile = `/* GENERATED FILE - do not edit. Run "node build/bundle.js" instead. */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/*
 * Translation keys the page-world bundle can display. content/bridge.js turns
 * them into strings with chrome.i18n and ships them across, because
 * chrome.i18n does not exist in the MAIN world.
 */
var canvasBlockerMessageKeys = ${JSON.stringify(keys, null, "\t")};
`;
	fs.writeFileSync(path.join(root, MESSAGE_KEYS_OUTPUT), messageKeysFile, "utf8");
	console.log(`${MESSAGE_KEYS_OUTPUT}: ${keys.length} translation keys`);
}

main();
