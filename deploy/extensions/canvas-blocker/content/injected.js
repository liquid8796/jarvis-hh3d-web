/* GENERATED FILE - do not edit. Run "node build/bundle.js" instead. */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
(function(){
"use strict";

/*
 * Everything below runs in the page's own global scope. Nothing may leak out of
 * this closure, so `require`, `browser` and `exports` are declared here and
 * shadow anything the page might define under the same names.
 */

const HANDSHAKE_ATTRIBUTE = "data-canvasblocker-channel";

// Shadows a page level `exports`: the modules use `typeof exports` to decide
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
	const match = /((?:chrome|moz|safari-web|extension)-extension:\/\/[^\/\s)]+\/)/.exec(stack);
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
				.replace(/^\//, "");
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
// instead of on `globalThis`.
const require = function(){
	const moduleScope = {};

	function getScopeName(module){
		return module.replace(/^\..*\//, "").replace(/\..+/, "");
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

/* ===== lib/logging.js ===== */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
(function(){
	"use strict";
	
	let scope;
	if ((typeof exports) !== "undefined"){
		scope = exports;
	}
	else {
		scope = require.register("./logging", {});
	}

	let settings = false;
	scope.setSettings = async function(realSettings){
		if (!settings){
			settings = realSettings;
			await settings.loaded;
			return scope.clearQueue();
		}
		else {
			warning("logging: Settings can only be set once.");
			return settings.loaded;
		}
	};
	
	let prefix = "";
	
	function leftPad(str, char, pad){
		str = "" + str;
		return char.repeat(pad - str.length) + str;
	}
	
	const colors = {
		1: "color: red",
		25: "color: orange",
		50: "",
		75: "color: darkgreen",
		100: "color: blue",
		999: "background-color: lightgray"
	};
	
	let queue = [];
	function performLog(level, args, date){
		if (!date){
			date = new Date();
		}
		if (!settings || !settings.isInitialized() || queue.length){
			queue.push({level, args, date});
		}
		else {
			if (settings.logLevel >= level){
				let pre = "%c[CanvasBlocker] ";
				if (prefix){
					pre += prefix + ": ";
				}
				pre += "[" +
					date.getFullYear() + "-" +
					leftPad(date.getMonth() + 1, "0", 2) + "-" +
					leftPad(date.getDate(), "0", 2) + " " +
					leftPad(date.getHours(), "0", 2) + ":" +
					leftPad(date.getMinutes(), "0", 2) + ":" +
					leftPad(date.getSeconds(), "0", 2) + "." +
					leftPad(date.getMilliseconds(), "0", 3) +
					"]";
				if (typeof args[0] === "string"){
					args[0] = pre + " " + args[0];
					args.splice(1, 0, colors[level] || "");
				}
				else {
					args.unshift(colors[level] || "");
					args.unshift(pre);
				}
				// eslint-disable-next-line no-console
				console.log.apply(console, args);
			}
		}
	}
	
	function error  (...args){performLog(1,   args);}
	function warning(...args){performLog(25,  args);}
	function message(...args){performLog(50,  args);}
	function notice (...args){performLog(75,  args);}
	function verbose(...args){performLog(100, args);}
	function metaLog(...args){performLog(999, args);}
	
	scope.setPrefix = function(newPrefix){
		if (!prefix){
			prefix = newPrefix;
		}
		else {
			warning("logging prefix already set (%s) cannot be set to %s", prefix, newPrefix);
		}
	};
	scope.clearQueue = function(){
		if (queue.length){
			metaLog("clear logging queue");
			const tmp = queue;
			queue = [];
			tmp.forEach(function(item){
				performLog(item.level, item.args, item.date);
			});
			metaLog("logging queue cleared");
		}
	};
	scope.error = error;
	scope.warning = warning;
	scope.message = message;
	scope.notice = notice;
	scope.verbose = verbose;

	metaLog("logging available");
}());
;

/* ===== lib/extension.js ===== */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/*
 * Chrome port.
 *
 * The Firefox original relied on Xray vision: its content script lived in a
 * separate compartment and reached into the page through `wrappedJSObject`,
 * `exportFunction` and friends. Chrome has no such thing - the protection code
 * is injected straight into the page's MAIN world instead, so every object we
 * touch is already the page's own object.
 *
 * That makes `getWrapped` the identity function, but it also means a naive
 * replacement function would stringify to its own source code and give the
 * whole game away. `Function.prototype.toString` is therefore patched (once per
 * window) to report the native-code signature for everything we install.
 */
(function(){
	"use strict";

	let scope;
	if ((typeof exports) !== "undefined"){
		scope = exports;
	}
	else {
		scope = require.register("./extension", {});
	}

	const browserAvailable = typeof browser !== "undefined";
	const logging = require("./logging");

	scope.inBackgroundScript = !!(
		(typeof ServiceWorkerGlobalScope) !== "undefined" &&
		(typeof self) !== "undefined" &&
		self instanceof ServiceWorkerGlobalScope
	);

	/**
	 * Chrome only accepts [A-Za-z0-9_] in message names, while several of
	 * CanvasBlocker's contain ".", "-" or "%" - directly in the source ("
	 * sanitation_error.storeNotificationData") and assembled at runtime
	 * ("blockMode_options." + value). build/locales.js renames them in
	 * _locales/ with exactly this function, so both sides keep matching and no
	 * call site has to change.
	 * Keep in sync with sanitizeMessageName() in build/locales.js.
	 */
	scope.sanitizeMessageName = function sanitizeMessageName(name){
		return String(name).replace(/[^A-Za-z0-9_]/g, "_");
	};

	scope.getTranslation = browserAvailable? function getTranslation(id){
		return browser.i18n.getMessage(scope.sanitizeMessageName(id));
	}: function(id){
		return id;
	};

	scope.parseTranslation = function parseTranslation(message, parameters = {}){
		const container = document.createDocumentFragment();

		message.split(/(\{[^}]+\})/).forEach(function(part){
			if (part.startsWith("{") && part.endsWith("}")){
				part = part.substring(1, part.length - 1);
				const args = part.split(":");
				switch (args[0]){
					case "image": {
						const image = document.createElement("img");
						image.className = "noticeImage";
						image.src = args.slice(1).join(":");
						container.appendChild(image);
						break;
					}
					case "link": {
						const link = document.createElement("a");
						link.target = "_blank";
						link.textContent = args[1];
						link.href = args.slice(2).join(":");
						container.appendChild(link);
						break;
					}
					case "newline": {
						container.appendChild(document.createElement("br"));
						break;
					}
					default:
						if (parameters[args[0]]){
							const parameter = parameters[args[0]];
							if ((typeof parameter) === "function"){
								container.appendChild(parameter(args.slice(1).join(":")));
							}
							else {
								container.appendChild(document.createTextNode(parameter));
							}
						}
						else {
							container.appendChild(document.createTextNode(part));
						}
				}
			}
			else {
				container.appendChild(document.createTextNode(part));
			}
		});
		return container;
	};

	scope.getURL = function getURL(str){
		return browser.runtime.getURL(str);
	};

	scope.extensionID = browserAvailable? scope.getURL(""): "extensionID";

	scope.inIncognitoContext = false;
	if (browserAvailable){
		try {
			scope.inIncognitoContext = !!(browser.extension && browser.extension.inIncognitoContext);
		}
		catch (error){
			// not available in the service worker
		}
	}

	scope.message = {
		on: browserAvailable? function(callback){
			return browser.runtime.onMessage.addListener(callback);
		}: function(){
			return false;
		},
		send: browserAvailable? function(data){
			return browser.runtime.sendMessage(data);
		}: function(){
			return false;
		}
	};
	Object.seal(scope.message);

	// Same world - nothing to unwrap.
	scope.getWrapped = function getWrapped(obj){
		return obj;
	};

	/**
	 * Source strings reported by the patched `Function.prototype.toString`.
	 * Holds every function we hand to the page: proxies as well as plain
	 * replacement functions.
	 */
	const sourceStrings = new Map();
	/**
	 * Proxy -> original mapping. Only real proxies belong in here; the
	 * prototype juggling below unwraps through it and must not confuse a plain
	 * replacement function for a proxy.
	 */
	const proxies = new Map();
	const changedWindowsForProxies = new WeakMap();

	function nativeCodeString(name){
		return `function ${name}() {\n    [native code]\n}`;
	}

	function setupWindowForProxies(window){
		if (changedWindowsForProxies.get(window)){
			return;
		}

		const functionPrototype = window.Function.prototype;
		const originalToString = functionPrototype.toString;
		// Set before anything below can re-enter: `createProxyFunction` and
		// `exportFunctionWithName` both call back into this function.
		changedWindowsForProxies.set(window, originalToString);

		const alteredToString = scope.createProxyFunction(
			window,
			originalToString,
			function toString(){
				const sourceString = sourceStrings.get(this);
				if (sourceString !== undefined){
					return sourceString;
				}
				return originalToString.call(this);
			}
		);
		scope.changeProperty(window, "toString", {
			object: functionPrototype,
			name: "toString",
			type: "value",
			changed: alteredToString
		});

		const reflect = window.Reflect;
		const originalReflectSetPrototypeOf = reflect.setPrototypeOf;
		const alteredReflectSetPrototypeOf = scope.exportFunctionWithName(
			function setPrototypeOf(target, prototype){
				if (proxies.has(target)){
					target = proxies.get(target).original;
				}
				if (proxies.has(prototype)){
					prototype = proxies.get(prototype).original;
				}
				if (prototype){
					const grandPrototype = reflect.getPrototypeOf(prototype);
					if (proxies.has(grandPrototype)){
						const testPrototype = window.Object.create(proxies.get(grandPrototype).original);
						if (!originalReflectSetPrototypeOf.call(reflect, target, testPrototype)){
							return false;
						}
					}
				}
				return originalReflectSetPrototypeOf.call(reflect, target, prototype);
			}, window, "setPrototypeOf"
		);
		scope.changeProperty(window, "toString", {
			object: reflect,
			name: "setPrototypeOf",
			type: "value",
			changed: alteredReflectSetPrototypeOf
		});
	}

	/**
	 * Firefox counterpart created a function in the page compartment. Here the
	 * function already belongs to the page; only its `name` and its stringified
	 * form have to be corrected.
	 */
	scope.exportFunctionWithName = function exportFunctionWithName(func, context, name){
		try {
			Object.defineProperty(func, "name", {
				value: name,
				writable: false,
				enumerable: false,
				configurable: true
			});
		}
		catch (error){
			logging.error("Unable to set the name", name, "on", func, error);
		}
		if (context){
			setupWindowForProxies(context);
		}
		if (!sourceStrings.has(func)){
			sourceStrings.set(func, nativeCodeString(name));
		}
		return func;
	};

	scope.createProxyFunction = function createProxyFunction(window, original, replacement){
		setupWindowForProxies(window);
		const handler = window.Object.create(null);
		handler.apply = scope.exportFunctionWithName(function(target, thisArg, args){
			try {
				return args.length?
					replacement.call(thisArg, ...args):
					replacement.call(thisArg);
			}
			catch (error){
				try {
					return original.apply(thisArg, args);
				}
				catch (error){
					return target.apply(thisArg, args);
				}
			}
		}, window, "");
		handler.setPrototypeOf = scope.exportFunctionWithName(function(target, prototype){
			if (proxies.has(target)){
				target = proxies.get(target).original;
			}
			if (proxies.has(prototype)){
				prototype = proxies.get(prototype).original;
			}
			if (prototype){
				const grandPrototype = window.Object.getPrototypeOf(prototype);
				if (proxies.has(grandPrototype)){
					const testPrototype = window.Object.create(proxies.get(grandPrototype).original);
					window.Object.setPrototypeOf(target, testPrototype);
				}
			}
			return window.Object.setPrototypeOf(target, prototype);
		}, window, "");
		const proxy = new window.Proxy(original, handler);
		proxies.set(proxy, {original: original, wrappedOriginal: original});
		sourceStrings.set(proxy, changedWindowsForProxies.get(window).call(original));
		return proxy;
	};

	const changedPropertiesByWindow = new WeakMap();
	scope.changeProperty = function(window, group, {object, name, type, changed}){
		let changedProperties = changedPropertiesByWindow.get(window);
		if (!changedProperties){
			changedProperties = [];
			changedPropertiesByWindow.set(window, changedProperties);
		}
		const descriptor = Object.getOwnPropertyDescriptor(object, name);
		const original = descriptor[type];
		descriptor[type] = changed;
		Object.defineProperty(object, name, descriptor);
		changedProperties.push({group, object, name, type, original});
	};
	scope.revertProperties = function(window, group){
		let changedProperties = changedPropertiesByWindow.get(window);
		if (!changedProperties){
			return;
		}
		if (group){
			const remainingProperties = changedProperties.filter(function(changedProperty){
				return changedProperty.group !== group;
			});
			changedPropertiesByWindow.set(window, remainingProperties);
			changedProperties = changedProperties.filter(function(changedProperty){
				return changedProperty.group === group;
			});
		}
		else {
			changedPropertiesByWindow.delete(window);
		}

		for (let i = changedProperties.length - 1; i >= 0; i -= 1){
			const {object, name, type, original} = changedProperties[i];
			logging.verbose("reverting", name, "on", object);
			const descriptor = Object.getOwnPropertyDescriptor(object, name);
			descriptor[type] = original;
			Object.defineProperty(object, name, descriptor);
		}
	};

	scope.displayVersion = async function displayVersion(node, displayRefresh = false){
		if ("string" === typeof node){
			node = document.getElementById(node);
		}
		if (!node){
			throw "display node not found";
		}
		fetch(scope.getURL("manifest.json")).then(function(response){
			return response.json();
		}).then(function(manifest){
			node.textContent = "Version " + manifest.version;
			return manifest.version;
		}).catch(function(error){
			node.textContent = "Unable to get version: " + error;
		});

		if (displayRefresh){
			// Workaround to hide the scroll bars
			window.setTimeout(function(){
				node.style.display = "none";
				node.style.display = "";
			}, displayRefresh);
		}
	};

	Object.seal(scope);
}());

;

/* ===== lib/settingDefinitions.js ===== */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
(function(){
	"use strict";

	const settingDefinitions = [
		{
			name: "logLevel",
			defaultValue: 1,
			options: [0, 1, 25, 50, 75, 100]
		},
		{
			name: "urlSettings",
			defaultValue: [],
			isUrlContainer: true,
			entries: [
				{name: "url", defaultValue: ""}
			]
		},
		{
			name: "hiddenSettings",
			isHideContainer: true,
			defaultValue: {}
		},
		{
			name: "expandStatus",
			isExpandContainer: true,
			defaultValue: {}
		},
		{
			name: "displayHiddenSettings",
			defaultValue: false
		},
		{
			name: "urls",
			defaultValue: [],
			dynamic: true,
			dependencies: ["urlSettings"],
			getter: function(settings){
				return settings.urlSettings.map(function(urlSetting){
					return urlSetting.url;
				});
			}
		},
		{
			name: "whiteList",
			defaultValue: ""
		},
		{
			name: "sessionWhiteList",
			resetOnStartup: true,
			defaultValue: ""
		},
		{
			name: "blackList",
			defaultValue: ""
		},
		{
			name: "blockMode",
			defaultValue: "fake",
			urlSpecific: true,
			options: [
				"fake", "ask", null,
				"blockEverything", "block", "allow", "allowEverything"
			]
		},
		{
			name: "protectedCanvasPart",
			defaultValue: "readout",
			urlSpecific: true,
			options: [
				"nothing", "readout", "input", "everything"
			]
		},
		{
			name: "minFakeSize",
			defaultValue: 1
		},
		{
			name: "maxFakeSize",
			defaultValue: 0
		},
		{
			name: "rng",
			defaultValue: "nonPersistent",
			options: ["white", "nonPersistent", "constant", "persistent"]
		},
		{
			name: "protectedAPIFeatures",
			defaultValue: {},
			keys: [
				{name: "Canvas-API", level: 1},
				"getContext @ canvas",
				{message: "readout", level: 2},
				"toDataURL @ canvas",
				"toBlob @ canvas", "convertToBlob @ canvas", "mozGetAsFile @ canvas",
				"getImageData @ canvas",
				"isPointInPath @ canvas", "isPointInStroke @ canvas",
				{message: "input", level: 2},
				"fillText @ canvas", "strokeText @ canvas",
				{name: "webGL", level: 2},
				"readPixels @ canvas", "getParameter @ canvas", "getExtension @ canvas",
				{name: "Audio-API", level: 1},
				"getFloatFrequencyData @ audio", "getByteFrequencyData @ audio",
				"getFloatTimeDomainData @ audio", "getByteTimeDomainData @ audio",
				"getChannelData @ audio", "copyFromChannel @ audio",
				"getFrequencyResponse @ audio",
				{name: "History-API", level: 1},
				"length @ history",
				{name: "Window-API", level: 1},
				"opener @ window",
				"name @ window",
				{name: "DOMRect-API", level: 1},
				"getClientRects @ domRect",
				"getBoundingClientRect @ domRect",
				"getBoxQuads @ domRect",
				"getBounds @ domRect",
				"getBBox @ domRect",
				"getStartPositionOfChar @ domRect",
				"getEndPositionOfChar @ domRect",
				"getExtentOfChar @ domRect",
				"getPointAtLength @ domRect",
				"intersectionRect @ domRect",
				"boundingClientRect @ domRect",
				"rootBounds @ domRect",
				{name: "SVG-API", level: 1},
				"getTotalLength @ svg",
				"getComputedTextLength @ svg",
				"getSubStringLength @ svg",
				{name: "TextMetrics-API", level: 1},
				"width @ textMetrics",
				"actualBoundingBoxAscent @ textMetrics",
				"actualBoundingBoxDescent @ textMetrics",
				"actualBoundingBoxLeft @ textMetrics",
				"actualBoundingBoxRight @ textMetrics",
				"alphabeticBaseline @ textMetrics",
				"emHeightAscent @ textMetrics",
				"emHeightDescent @ textMetrics",
				"fontBoundingBoxAscent @ textMetrics",
				"fontBoundingBoxDescent @ textMetrics",
				"hangingBaseline @ textMetrics",
				"ideographicBaseline @ textMetrics",
				{name: "Navigator-API", level: 1},
				"appCodeName @ navigator",
				"appName @ navigator",
				"appVersion @ navigator",
				"buildID @ navigator",
				"estimate @ navigator",
				"oscpu @ navigator",
				"platform @ navigator",
				"product @ navigator",
				"productSub @ navigator",
				"userAgent @ navigator",
				"vendor @ navigator",
				"vendorSub @ navigator",
				{name: "Screen-API", level: 1},
				"width @ screen",
				"height @ screen",
				"availWidth @ screen",
				"availHeight @ screen",
				"availTop @ screen",
				"availLeft @ screen",
				"matches @ screen",
				"outerWidth @ screen",
				"outerHeight @ screen",
			],
			defaultKeyValue: true
		},
		{
			name: "useCanvasCache",
			defaultValue: true
		},
		{
			name: "ignoreFrequentColors",
			defaultValue: 0
		},
		{
			name: "minColors",
			defaultValue: 0
		},
		{
			name: "fakeAlphaChannel",
			defaultValue: false
		},
		{
			name: "webGLVendor",
			defaultValue: ""
		},
		{
			name: "webGLRenderer",
			defaultValue: ""
		},
		{
			name: "webGLUnmaskedVendor",
			defaultValue: ""
		},
		{
			name: "webGLUnmaskedRenderer",
			defaultValue: ""
		},
		{
			name: "persistentRndStorage",
			defaultValue: ""
		},
		{
			name: "persistentIncognitoRndStorage",
			resetOnStartup: true,
			defaultValue: ""
		},
		{
			name: "storePersistentRnd",
			defaultValue: false
		},
		{
			name: "persistentRndClearIntervalValue",
			defaultValue: 0
		},
		{
			name: "persistentRndClearIntervalUnit",
			defaultValue: "days",
			options: ["seconds", "minutes", "hours", "days", "weeks", "months", "years"]
		},
		{
			name: "lastPersistentRndClearing",
			defaultValue: 0
		},
		{
			name: "sharePersistentRndBetweenDomains",
			defaultValue: false
		},
		{
			name: "askOnlyOnce",
			defaultValue: "individual",
			options: ["no", "individual", "combined"]
		},
		{
			name: "askDenyMode",
			defaultValue: "block",
			options: ["block", "fake"]
		},
		{
			name: "showCanvasWhileAsking",
			defaultValue: true
		},
		{
			name: "showNotifications",
			defaultValue: true,
			urlSpecific: true
		},
		{
			name: "highlightPageAction",
			defaultValue: "none",
			options: ["none", "color", "blink"],
			urlSpecific: true
		},
		{
			name: "highlightBrowserAction",
			defaultValue: "color",
			options: ["none", "color", "blink"],
			urlSpecific: true
		},
		{
			name: "displayBadge",
			defaultValue: true
		},
		{
			name: "storeNotificationData",
			defaultValue: false
		},
		{
			name: "storeImageForInspection",
			defaultValue: false
		},
		{
			name: "ignoreList",
			defaultValue: ""
		},
		{
			name: "ignoredAPIs",
			defaultValue: {},
			keys: [
				"canvas",
				"audio",
				"history",
				"window",
				"domRect",
				"svg",
				"textMetrics",
				"navigator",
				"screen",
			],
			defaultKeyValue: false
		},
		{
			name: "showCallingFile",
			defaultValue: false
		},
		{
			name: "showCompleteCallingStack",
			defaultValue: false
		},
		{
			name: "enableStackList",
			defaultValue: false
		},
		{
			name: "stackList",
			defaultValue: ""
		},
		{
			name: "protectAudio",
			defaultValue: true,
			urlSpecific: true
		},
		{
			name: "audioFakeRate",
			defaultValue: "100",
			options: ["1", "10", "100", "1000", "0.1%", "1%", "10%", "100%"]
		},
		{
			name: "audioNoiseLevel",
			defaultValue: "minimal",
			options: ["minimal", "low", "medium", "high", "maximal"]
		},
		{
			name: "useAudioCache",
			defaultValue: true,
			urlSpecific: true
		},
		{
			name: "audioUseFixedIndices",
			defaultValue: true
		},
		{
			name: "audioFixedIndices",
			defaultValue: function(){
				return Math.floor(Math.random() * 30).toString(10);
			}
		},
		{
			name: "historyLengthThreshold",
			defaultValue: 2,
			urlSpecific: true
		},
		{
			name: "protectWindow",
			defaultValue: false,
			urlSpecific: true
		},
		{
			name: "allowWindowNameInFrames",
			defaultValue: false,
			urlSpecific: true
		},
		{
			name: "protectDOMRect",
			defaultValue: true,
			urlSpecific: true
		},
		{
			name: "domRectIntegerFactor",
			defaultValue: 4
		},
		{
			name: "protectSVG",
			defaultValue: true,
			urlSpecific: true
		},
		{
			name: "protectTextMetrics",
			defaultValue: true,
			urlSpecific: true
		},
		{
			name: "blockDataURLs",
			defaultValue: true,
			urlSpecific: true
		},
		{
			name: "protectNavigator",
			defaultValue: false,
			urlSpecific: true
		},
		{
			name: "navigatorDetails",
			defaultValue: {},
		},
		{
			name: "protectScreen",
			defaultValue: true,
			urlSpecific: true
		},
		{
			name: "screenSize",
			defaultValue: "",
			urlSpecific: true
		},
		{
			name: "fakeMinimalScreenSize",
			defaultValue: true,
			mobileDefaultValue: false,
			urlSpecific: true
		},
		{
			name: "displayAdvancedSettings",
			defaultValue: false
		},
		{
			name: "displayDescriptions",
			defaultValue: false
		},
		{
			name: "theme",
			defaultValue: "auto",
			options: ["auto", "default", "light", "dark", "colorful"/*, "none"*/]
		},
		{
			name: "showPresetsOnInstallation",
			defaultValue: true
		},
		{
			name: "dontShowOptionsOnUpdate",
			defaultValue: false
		},
		{
			name: "disruptSessionOnUpdate",
			defaultValue: false
		},
		{
			name: "updatePending",
			resetOnStartup: true,
			defaultValue: false
		},
		{
			name: "isStillDefault",
			defaultValue: true
		},
		{
			name: "storageVersion",
			defaultValue: 1.0,
			fixed: true
		}
	];
	
	if ((typeof module) !== "undefined"){
		module.exports = settingDefinitions;
	}
	else {
		require.register("./settingDefinitions", settingDefinitions);
	}
}());
;

/* ===== lib/settingContainers.js ===== */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
(function(){
	"use strict";
	
	let scope;
	if ((typeof exports) !== "undefined"){
		scope = exports;
	}
	else {
		scope = require.register("./settingContainers", {});
	}
	
	const logging = require("./logging");
	
	scope.urlContainer = null;
	scope.hideContainer = null;
	scope.expandContainer = null;
	
	scope.getUrlValueContainer = function(name, url){
		const matching = scope.urlContainer.get().filter(function(urlSetting){
			return urlSetting.hasOwnProperty(name);
		}).filter(function(urlSetting){
			return urlSetting.match(url);
		});
		if (matching.length){
			return matching[0];
		}
		else {
			return null;
		}
	};
	scope.setUrlValue = function(name, value, url){
		const urlContainerValue = scope.urlContainer.get();
		let matching = urlContainerValue.filter(function(urlSetting){
			return urlSetting.match(url);
		});
		if (!matching.length){
			let newEntry = {url};
			newEntry[name] = value;
			urlContainerValue.push(newEntry);
			initializeUrlSetting(newEntry);
			matching = [newEntry];
		}
		matching[0][name] = value;
		return scope.urlContainer.set(urlContainerValue);
	};
	scope.resetUrlValue = function(name, url){
		let urlContainerValue = scope.urlContainer.get();
		urlContainerValue.filter(function(urlSetting){
			return urlSetting.match(url);
		}).forEach(function(match){
			delete match[name];
			if (Object.keys(match).every(function(key){return key === "url";})){
				urlContainerValue = urlContainerValue.filter(function(urlSetting){
					return urlSetting !== match;
				});
			}
		});
		scope.urlContainer.set(urlContainerValue);
	};
	
	function processHideContainer(settingDefinition){
		scope.hideContainer = settingDefinition;
		let changeListeners = {};
		settingDefinition.setHideByName = function(name, value){
			logging.verbose("set hide of", name, "to", value);
			const hideStore = settingDefinition.get();
			hideStore[name] = value;
			settingDefinition.set(hideStore);
			(changeListeners[name] || []).forEach(function(listener){
				listener(value);
			});
		};
		settingDefinition.getHideByName = function(name){
			const hideStore = settingDefinition.get();
			return hideStore[name] || false;
		};
		settingDefinition.onHideChange = function(name, listener){
			if (!changeListeners[name]){
				changeListeners[name] = [];
			}
			changeListeners[name].push(listener);
		};
		settingDefinition.on(function(event){
			const value = event.newValue;
			Object.keys(value).forEach(function(name){
				(changeListeners[name] || []).forEach(function(listener){
					listener(value[name]);
				});
			});
			const oldValue = event.oldValue;
			Object.keys(oldValue).filter(function(name){
				return !value.hasOwnProperty(name);
			}).forEach(function(name){
				(changeListeners[name] || []).forEach(function(listener){
					listener(false);
				});
			});
		});
		settingDefinition.hideAble = false;
	}
	
	function processExpandContainer(settingDefinition){
		scope.expandContainer = settingDefinition;
		let changeListeners = {};
		settingDefinition.setExpandByName = function(name, value){
			logging.verbose("set expand of", name, "to", value);
			const expandStore = settingDefinition.get();
			expandStore[name] = value;
			settingDefinition.set(expandStore);
			(changeListeners[name] || []).forEach(function(listener){
				listener(value);
			});
		};
		settingDefinition.getExpandByName = function(name, defaultValue = false){
			const expandStore = settingDefinition.get();
			if ((typeof expandStore[name]) !== "undefined"){
				return expandStore[name] || false;
			}
			else {
				return defaultValue;
			}
		};
		settingDefinition.onExpandChange = function(name, listener){
			if (!changeListeners[name]){
				changeListeners[name] = [];
			}
			changeListeners[name].push(listener);
		};
		settingDefinition.on(function(event){
			const value = event.newValue;
			Object.keys(value).forEach(function(name){
				(changeListeners[name] || []).forEach(function(listener){
					listener(value[name]);
				});
			});
			const oldValue = event.oldValue;
			Object.keys(oldValue).filter(function(name){
				return !value.hasOwnProperty(name);
			}).forEach(function(name){
				(changeListeners[name] || []).forEach(function(listener){
					listener(false);
				});
			});
		});
	}
	
	scope.check = function(settingDefinition){
		if (settingDefinition.isUrlContainer){
			scope.urlContainer = settingDefinition;
			settingDefinition.refresh = function(){
				settingDefinition.set(settingDefinition.get());
			};
		}
		
		if (settingDefinition.isHideContainer){
			processHideContainer(settingDefinition);
		}
		
		if (settingDefinition.isExpandContainer){
			processExpandContainer(settingDefinition);
		}
	};
	
	function initializeUrlSetting(urlSetting){
		let regExp;
		const domain = !!urlSetting.url.match(/^[A-Za-z0-9_.*-]+$/);
		if (domain){
			regExp = new RegExp(
				"(?:^|\\.)" + urlSetting.url.replace(/([\\+?[^\]$(){}=!|.])/g, "\\$1").replace(/\*/g, ".+") + "\\.?$",
				"i"
			);
		}
		else {
			try {
				regExp = new RegExp(urlSetting.url, "i");
			}
			catch (error){
				logging.error("Error in regular expression", urlSetting.url, error);
				regExp = new RegExp(
					"(?:^|\\.)" + urlSetting.url.replace(/([\\+*?[^\]$(){}=!|.])/g, "\\$1") + "\\.?$",
					"i"
				);
			}
		}
		const match = function(url){
			if (!url){
				return false;
			}
			else if (
				url instanceof String ||
				(typeof url) === "string"
			){
				return url === urlSetting.url;
			}
			else if (domain){
				return (url.hostname || "").match(regExp);
			}
			else {
				return url.href.match(regExp);
			}
		};
		Object.defineProperty(
			urlSetting,
			"match",
			{
				enumerable: false,
				writable: true,
				configurable: true,
				value: match
			}
		);
	}
	
	scope.initializeUrlContainer = function(eventHandler){
		if (!scope.urlContainer){
			return;
		}
		scope.urlContainer.on(function({newValue, oldValue}){
			newValue.forEach(initializeUrlSetting);
			
			const newUrls = newValue.map(function(entry){return entry.url;});
			const oldUrls = oldValue.map(function(entry){return entry.url;});
			const matching = {};
			newUrls.forEach(function(url, i){
				matching[url] = {new: i, old: oldUrls.indexOf(url)};
			});
			oldUrls.forEach(function(url, i){
				if (!matching[url]){
					matching[url] = {new: -1, old: i};
				}
			});
			Object.keys(matching).forEach(function(url){
				const oldEntry = oldValue[matching[url].old] || {};
				const newEntry = newValue[matching[url].new] || {};
				scope.urlContainer.entries.forEach(function(settingDefinition){
					const name = settingDefinition.name;
					const oldValue = oldEntry[name];
					const newValue = newEntry[name];
					
					if (oldValue !== newValue){
						((eventHandler[name] || {})[url] || []).forEach(function(callback){
							callback({name, newValue, oldValue, url});
						});
					}
				});
			});
		});
	};
}());
;

/* ===== lib/settings.js ===== */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
(function(require){
	"use strict";

	let scope;
	if ((typeof exports) !== "undefined"){
		scope = exports;
	}
	else {
		scope = require.register("./settings", {});
	}

	const logging = require("./logging");
	const extension = require("./extension");
	const settingDefinitions = require("./settingDefinitions");
	const settingContainers = require("./settingContainers");
	const definitionsByName = {};
	const defaultSymbol = "";
	
	const eventHandler = {any: {}};
	eventHandler.any[defaultSymbol] = [];
	eventHandler.all = eventHandler.any;
	const settings = {};

	function isDefinitionInvalid(settingDefinition, newValue){
		if (newValue === undefined && settingDefinition.optional){
			return false;
		}
		else if (settingDefinition.fixed){
			return "fixed";
		}
		else if ((typeof newValue) !== (typeof settingDefinition.defaultValue)){
			return "wrongType";
		}
		else if (Array.isArray(settingDefinition.defaultValue)){
			if (!Array.isArray(newValue)){
				return "wrongType";
			}
			const entriesInvalid = newValue.reduce(function(v, entry){
				v = v || settingDefinition.entries.reduce(function(v, entryDefinition){
					return v || isDefinitionInvalid(entryDefinition, entry[entryDefinition.name]);
				}, false);
				if (!v){
					if (Object.keys(entry).some(function(key){
						return !settingDefinition.entries.some(function(entryDefinition){
							return key === entryDefinition.name;
						});
					})){
						return "noOption";
					}
				}
				return v;
			}, false);
			if (entriesInvalid){
				return entriesInvalid;
			}
		}
		else if (
			settingDefinition.options &&
			!settingDefinition.options.includes(newValue)
		){
			return "noOption";
		}
		return false;
	}

	function createGetter(settingDefinition){
		if (settingDefinition.dynamic){
			return function getValue(){
				return settingDefinition.getter(scope);
			};
		}
		else if (settingDefinition.urlSpecific){
			return function getValue(url){
				if (url){
					const match = settingContainers.getUrlValueContainer(settingDefinition.name, url);
					if (match){
						return match[settingDefinition.name];
					}
				}
				return settings[settingDefinition.name];
			};
		}
		else {
			return function getValue(){
				return settings[settingDefinition.name];
			};
		}
	}
	
	function getDefaultValue(settingDefinition){
		let defaultValue = settingDefinition.defaultValue;
		if ((typeof defaultValue) === "object"){
			if (Array.isArray(defaultValue)){
				return defaultValue.slice();
			}
			else {
				return Object.create(defaultValue);
			}
		}
		return defaultValue;
	}

	function createSetter(settingDefinition){
		if (settingDefinition.dynamic){
			return function setValue(newValue){
				settingDefinition.setter(scope, newValue);
			};
		}
		else {
			const name = settingDefinition.name;
			const isValid = function isValid(newValue){
				const invalid = settingDefinition.invalid(newValue);
				if (invalid){
					if (invalid === "fixed"){
						logging.warning("Trying to set the fixed setting", name, ":", newValue);
					}
					else if (invalid === "wrongType"){
						logging.warning("Wrong type provided for setting", name, ":", newValue);
					}
					else if (invalid === "noOption"){
						logging.warning("Provided value outside specified options for ", name, ":", newValue);
					}
					else {
						logging.warning("Unknown invalid state:", invalid);
					}
					return false;
				}
				return true;
			};
			const storeValue = async function storeValue(newValue){
				logging.verbose("Trying to store new value for %s", name, newValue);
				settings[name] = newValue;
				if (!settingDefinition.transient){
					const storeObject = {};
					storeObject[name] = newValue;
					try {
						await browser.storage.local.set(storeObject);
						logging.verbose("New value stored for %s:", name, newValue);
					}
					catch (error){
						logging.error("Unable to store new value for %s:", name, newValue, error);
						throw error;
					}
				}
				else {
					logging.warning("Transient setting %s cannot be stored.", name);
					throw "Transient setting " + name + " cannot be stored.";
				}
			};
			
			if (settingDefinition.urlSpecific){
				return function setValue(newValue, url){
					logging.verbose("New value for %s (%s):", name, url, newValue);
					if (isValid(newValue)){
						if (url){
							return settingContainers.setUrlValue(name, newValue, url);
						}
						else {
							return storeValue(newValue);
						}
					}
					else{
						logging.warning("Invalid value for %s (%s):", name, url, newValue);
						return Promise.reject("Invalid value for " + name + " (" + url + "): " + newValue);
					}
				};
			}
			else {
				return function setValue(newValue){
					logging.verbose("New value for %s:", name, newValue);
					if (isValid(newValue)){
						return storeValue(newValue);
					}
					else{
						logging.warning("Invalid value for %s:", name, newValue);
						return Promise.reject("Invalid value for " + name + ": " + newValue);
					}
				};
			}
		}
	}

	function createResetter(settingDefinition){
		if (settingDefinition.dynamic){
			return function(){};
		}
		else {
			const name = settingDefinition.name;
			let reset = function(){
				settings[name] = getDefaultValue(settingDefinition);
				browser.storage.local.remove(name);
			};
			if (settingDefinition.urlSpecific){
				return function(url){
					if (url){
						settingContainers.resetUrlValue(name, url);
					}
					else {
						reset();
					}
				};
			}
			else {
				return reset;
			}
		}
	}

	scope.on = function onSettingsChange(name, callback, url){
		if (Array.isArray(name)){
			name.forEach(function(name){
				onSettingsChange(name, callback, url);
			});
		}
		else {
			if (eventHandler.hasOwnProperty(name)){
				if (!url){
					url = defaultSymbol;
				}
				if (!eventHandler[name].hasOwnProperty(url)){
					eventHandler[name][url] = [];
				}
				eventHandler[name][url].push(callback);
			}
			else {
				logging.warning("Unable to register event handler for unknown setting", name);
			}
		}
	};

	settingDefinitions.forEach(function(settingDefinition){
		const name = settingDefinition.name;
		definitionsByName[name] = settingDefinition;
		if (typeof settingDefinition.defaultValue === "function"){
			settingDefinition.defaultValue = settingDefinition.defaultValue();
		}
		settings[name] = getDefaultValue(settingDefinition);
		eventHandler[name] = {};

		settingDefinition.on = function on(callback, url){
			if (!settingDefinition.dynamic){
				 scope.on(name, callback, url);
			}
			if (settingDefinition.dependencies){
				settingDefinition.dependencies.forEach(function(dependency){
					scope.on(dependency, function(){
						callback({name, newValue: settingDefinition.get()});
					}, url);
				});
			}
		};
		settingDefinition.invalid = function invalid(newValue){
			return isDefinitionInvalid(settingDefinition, newValue);
		};
		settingDefinition.get = createGetter(settingDefinition);
		
		settingDefinition.set = createSetter(settingDefinition);
		
		settingDefinition.reset = createResetter(settingDefinition);
		
		if (settingDefinition.urlSpecific){
			if (!settingContainers.urlContainer){
				logging.error("Unable to use url specific settings without url-container");
			}
			else {
				settingDefinition.urlContainer = settingContainers.urlContainer;
				let entry = Object.create(settingDefinition);
				entry.optional = true;
				settingContainers.urlContainer.entries.push(entry);
			}
		}

		Object.defineProperty(
			scope,
			name,
			{
				get: settingDefinition.get,
				set: settingDefinition.set,
				enumerable: true
			}
		);
		
		settingContainers.check(settingDefinition);
	});

	scope.getDefinition = function(name){
		const foundDefinition = definitionsByName[name];
		if (foundDefinition){
			return Object.create(foundDefinition);
		}
		else {
			return undefined;
		}
	};
	
	scope.getContainers = function(){
		return {
			url: Object.create(settingContainers.urlContainer),
			hide: Object.create(settingContainers.hideContainer),
			expand: Object.create(settingContainers.expandContainer)
		};
	};

	scope.set = function(name, ...args){
		const foundDefinition = definitionsByName[name];
		if (foundDefinition){
			return foundDefinition.set(...args);
		}
		else {
			logging.error("Try to set unknown setting:", name);
			return Promise.reject("Try to set unknown setting: " + name);
		}
	};
	scope.get = function(name, ...args){
		const foundDefinition = definitionsByName[name];
		if (foundDefinition){
			return foundDefinition.get(...args);
		}
		else {
			logging.error("Try to get unknown setting:", name);
			return undefined;
		}
	};

	scope.forEach = function forEachSetting(...args){
		settingDefinitions.filter(function(settingDefinition){
			return !settingDefinition.dynamic;
		}).map(function(settingDefinition){
			return Object.create(settingDefinition);
		}).forEach(...args);
	};

	const resetSymbol = Symbol("reset");
	function changeValue(name, newValue){
		const settingDefinition = scope.getDefinition(name);
		if (settingDefinition){
			const oldValue = settings[name];
			if (newValue === resetSymbol){
				newValue = getDefaultValue(settingDefinition);
			}
			settings[name] = newValue;
			((eventHandler[name] || {})[defaultSymbol] || []).forEach(function(callback){
				callback({name, newValue, oldValue});
			});

			if (settingDefinition.urlSpecific){
				settingContainers.urlContainer.get().forEach(function(entry){
					if (!entry.hasOwnProperty(name)){
						((eventHandler[name] || {})[entry.url] || []).forEach(function(callback){
							callback({name, newValue, oldValue, url: entry.url});
						});
					}
				});
			}
		}
	}

	logging.verbose("registering storage onchange listener");
	browser.storage.onChanged.addListener(function(changes, area){
		if (area === "local"){
			logging.notice("settings changed", changes);
			const delayedChange = [];
			Object.entries(changes).forEach(function(entry){
				const [name, change] = entry;
				if (settingContainers.urlContainer && name === settingContainers.urlContainer.name){
					// changes in the url container have to trigger after the other changes
					delayedChange.push(entry);
				}
				else {
					if (change.hasOwnProperty("newValue")){
						changeValue(name, change.newValue);
					}
					else {
						changeValue(name, resetSymbol);
					}
				}
			});
			delayedChange.forEach(function(entry){
				const [name, change] = entry;
				if (change.hasOwnProperty("newValue")){
					changeValue(name, change.newValue);
				}
				else {
					changeValue(name, resetSymbol);
				}
			});
			eventHandler.any[""].forEach(function(callback){
				callback();
			});
		}
	});
	
	settingContainers.initializeUrlContainer(eventHandler);
	
	logging.verbose("loading settings");
	let initialized = false;
	scope.isInitialized = function(){
		return initialized;
	};
	const initEvents = [];
	scope.init = function(storage){
		if (initialized){
			return false;
		}
		initialized = true;
		logging.message("settings loaded");
		if (require("./extension").inBackgroundScript){
			const settingsMigration = require("./settingsMigration");
			settingsMigration.check(
				storage,
				{settings, logging, changeValue, urlContainer: settingContainers.urlContainer}
			);
		}
		const delayedChange = [];
		Object.entries(storage).forEach(function(entry){
			const [name, value] = entry;
			if (settingContainers.urlContainer && name === settingContainers.urlContainer.name){
				// changes in the url container have to trigger after the other changes
				delayedChange.push(entry);
			}
			else {
				changeValue(name, value);
			}
		});
		delayedChange.forEach(function(entry){
			const [name, value] = entry;
			changeValue(name, value);
		});
		changeValue("isStillDefault", false);

		initEvents.forEach(function(callback){callback();});
		return true;
	};
	if (require.exists("./settingsData")){
		scope.init(require("./settingsData"));
		scope.loaded = Promise.resolve(false);
	}
	else {
		// Chrome needs the explicit `null`: a zero argument get() is a Firefox
		// convenience that Chrome's MV3 bindings do not accept.
		scope.loaded = browser.storage.local.get(null).then(scope.init);
	}
	scope.onloaded = function(callback){
		if (scope.isStillDefault){
			initEvents.push(callback);
		}
		else {
			callback();
		}
	};
	// Chrome port: no forceLoad(). Firefox could spin on a synchronous request
	// until the settings message arrived; Chrome delivers the settings on the
	// same thread that would be spinning, so waiting for them is impossible.
	// lib/intercept.js protects with the defaults and re-intercepts instead.
	scope.startupReset = function(){
		scope.forEach(function(definition){
			if (definition.resetOnStartup){
				definition.set(getDefaultValue(definition));
			}
		});
	};
	Object.seal(scope);
	
	logging.setSettings(scope);
}(require));
;

/* ===== lib/colorStatistics.js ===== */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
(function(){
	"use strict";
	
	
	let scope;
	if ((typeof exports) !== "undefined"){
		scope = exports;
	}
	else {
		scope = require.register("./colorStatistics", {});
	}
	
	class Statistic{
		constructor(){
			this.colors = Object.create(null);
			this.numberOfColors = 0;
			
			this.minBoundary = {count: Number.NEGATIVE_INFINITY};
			this.maxBoundary = {count: Number.POSITIVE_INFINITY, previousColor: this.minBoundary};
			this.minBoundary.nextColor = this.maxBoundary;
		}
		addColor(r, g, b, a){
			const index = String.fromCharCode(r, g, b, a);
			let color = this.colors[index];
			if (!color){
				color = {
					index,
					color: [r, g, b, a],
					count: 0,
					previousColor: this.minBoundary,
					nextColor: this.minBoundary.nextColor
				};
				this.numberOfColors += 1;
				this.minBoundary.nextColor = color;
				color.nextColor.previousColor = color;
				this.colors[index] = color;
			}
			color.count += 1;
			if (color.count > color.nextColor.count){
				// swap colors to remain in right order
				// a_ -> b_ -> c -> d becomes a_ -> c -> b_ -> d
				const a_ = color.previousColor;
				const b_ = color;
				const c = color.nextColor;
				const d = color.nextColor.nextColor;
				
				a_.nextColor = c;
				c.previousColor = a_;
				
				c.nextColor = b_;
				b_.previousColor = c;
				
				b_.nextColor = d;
				d.previousColor = b_;
			}
		}
		getMaxColors(n){
			n = Math.min(n, this.numberOfColors);
			const colors = Object.create(null);
			let current = this.maxBoundary;
			for (;n && current;n -= 1){
				current = current.previousColor;
				colors[current.index] = current;
			}
			return colors;
		}
	}
	
	scope.compute = function computeColorStatistics(rawData){
		const statistic = new Statistic();
		for (let i = 0, l = rawData.length; i < l; i += 4){
			statistic.addColor(
				rawData[i + 0],
				rawData[i + 1],
				rawData[i + 2],
				rawData[i + 3]
			);
		}
		return statistic;
	};
	scope.hasMoreColors = function hasMoreColors(rawData, threshold, statistic){
		if (statistic){
			return statistic.numberOfColors > threshold;
		}
		else {
			const colors = Object.create(null);
			let count = 0;
			for (let i = 0, l = rawData.length; i < l; i += 4){
				const index = String.fromCharCode(
					rawData[i + 0],
					rawData[i + 1],
					rawData[i + 2],
					rawData[i + 3]
				);
				if (!Object.prototype.hasOwnProperty.call(colors, index)){
					colors[index] = true;
					count += 1;
					if (count > threshold){
						return true;
					}
				}
			}
			return count > threshold;
		}
	};
}());
;

/* ===== lib/webglRandom.js ===== */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
(function(){
	"use strict";
	
	let scope;
	if ((typeof exports) !== "undefined"){
		scope = exports;
	}
	else {
		scope = require.register("./webglRandom", {});
	}
	
	let randomSupply = null;
	scope.setRandomSupply = function(supply){
		randomSupply = supply;
	};
	
	const windowHashes = new WeakMap();
	function getWindowStorage(window){
		let storage = windowHashes.get(window);
		if (!storage){
			const vendorRng = randomSupply.getIndexRng(1, scope.vendors.length, window);
			const vendorIndex = vendorRng(0);
			storage = {vendorIndex};
			const vendor = scope.vendors[vendorIndex];
			if (vendor.getRandomRenderer){
				vendor.renderers = [vendor.getRandomRenderer(window)];
				storage.rendererIndex = 0;
			}
			else {
				const rendererRng = randomSupply.getIndexRng(1, vendor.renderers.length, window);
				storage.rendererIndex = rendererRng(0);
			}
			windowHashes.set(window, storage);
		}
		return storage;
	}
	function getRandomVendorIndex(window){
		return getWindowStorage(window).vendorIndex;
	}
	function getRandomRendererIndex(window){
		return getWindowStorage(window).rendererIndex;
	}
	scope.getRandomVendor = function getRandomVendor(window){
		return scope.vendors[getRandomVendorIndex(window)].vendor;
	};
	scope.getRandomRenderer = function getRandomRenderer(window){
		
		const vendor = scope.vendors[getRandomVendorIndex(window)];
		return vendor.renderers[getRandomRendererIndex(window)];
	};
	scope.pickOneFromTree = function pickOneFromTree(treeString, window){
		function pickOne(string){
			const options = [];
			let cumulate = "";
			let index = 0;
			for (const l = string.length; index < l; index += 1){
				const char = string.charAt(index);
				if (char === "|"){
					options.push(cumulate);
					cumulate = "";
				}
				else if (char === "<"){
					const subPick = pickOne(string.substring(index + 1));
					cumulate += subPick.value;
					index += 1 + subPick.endIndex;
				}
				else if (char === ">"){
					break;
				}
				else {
					cumulate += char;
				}
			}
			options.push(cumulate);
			const optionRng = randomSupply.getIndexRng(1, options.length, window);
			return {value: options[optionRng(0)], endIndex: index};
		}
		return pickOne(treeString).value;
	};
	
	scope.vendors = [
		{
			vendor: "Chromium",
			renderers: [
				"Chromium",
			]
		},
		{
			vendor: "Intel Inc.",
			renderers: [
				"Intel GMA X3100 OpenGL Engine",
				"Intel HD Graphics 3000 OpenGL Engine",
				"Intel HD Graphics 4000 OpenGL Engine",
				"Intel HD Graphics 5000 OpenGL Engine",
				"Intel Iris OpenGL Engine",
				"Intel Iris Pro OpenGL Engine",
			]
		},
		{
			vendor: "Intel Open Source Technology Center",
			renderers: [
				"Mesa DRI Intel(R) Haswell Mobile",
				"Mesa DRI Intel(R) Ironlake Mobile",
				"Mesa DRI Intel(R) Ivybridge Mobile x86/MMX/SSE2",
				"Mesa DRI Intel(R) Ivybridge Mobile",
				"Mesa DRI Intel(R) Sandybridge Desktop x86/MMX/SSE2",
				"Mesa DRI Intel(R) Sandybridge Desktop",
				"Mesa DRI Intel(R) Sandybridge Mobile x86/MMX/SSE2",
				"Mesa DRI Intel(R) Sandybridge Mobile",
			]
		},
		{
			vendor: "Google Inc.",
			getRandomRenderer: function(window){
				const words = "Series|Graphics|Chipset|Express|Family|nForce|Dual|NVIDIA|800|600|300|FireGL|Mobility|Radeon|series|FirePro|Optiplex|WDDM|200|400|700|70M|50M|Driver|200M".split("|");
				const compressed = "ANGLE (<A<MD <760G|(ATI) $f M8900 ($b) $c Pro $1|$f <2270|W5000 ($b V) $1 Adapter>|M880G with ATI $c $d HD 42<00 |50>|$d< <HD<6<370D $1|410D $1>|77<00 $0|70>| <5<450|5<00 $0|70>|670|$k $0|$8 $0>|6<2<50< $1|M >|90 $1>|3<00 $e $1|10< $1 |M>|20< <$1 |$e $1>|M>|50|70<D|M>>|4<00M $0|10D|50A $1|$l |80G>|5<00< $0|M/5600/5700 $0>|10 $0|20G|30D $1|50A|70>|6<20G|30M|50A $1|70>|7<00 $0|30M>|$8 $0|900< $0|M $0>>|7<000 $e|290 $1|3<00 $0 $1|10< $1|M>|40< $1|G|M>>|4<00M $0|20G|50 $1|$l|80D>|5<00< $0|/7600 $0|G|M/7600M $0>|20G + 7670M $6 $1|40D|$m/7650M $1|60D|70< $1|M>|80D>|6<00<G + 6400M $6 $1|M $0>|10M|40G + <76<00M $6 $1|$l $6 $1>|8750M $6 $1>|$m|60<D|G + 7600M $6 $1>|$l>|$k $0|$8 $0|900 $0>|8<2<10|40|50>|3<30|50>|4<00|50G|70D>|5<10G|50G + <8570M $6 $1|HD 8600/8700M $6 $1>|70D>|6<10G + 8500M $6 $1|50G + 8<670M $6 $1|750M $6 $1>|70D>>>>|R<7 $i $0|9 $i $0>>|(TM) HD <6<380G|480G|520G |620G>|7450>>>|SUS <EAH<4350 $e|5<450 $0|670 $0|770 $0>|6<450 $0|670 $0|970 $0>>|HD7770 $0|R9 270 $0>|TI <$f <2450|V<3<$k ($b)|$8>|4800 ($b)>>|$c $d <9600/9700 $0|HD <2<$j XT|$9>|3<4<00 $0|30|50|70>|650>|4<2<00 $0|50 $1>|3<00< $0|/4500 $0>|30>|5<00< $0|/5100 $0>|30 $0|70>|650>|5<000 $0|145|4<00 $0 |30|5<0|v>|70 >|650>|6<370|550>>|X1<$a|$9>>|$d <2100|3<000 $1|100 $1>|HD<4670| <2<350|$j <P<ro |RO>|$0|XT >|$9 <P<ro |RO>|XT>>|3<$i $1|$a $1|4<00 $0|50 - Dell $g|70 - Dell $g>|6<00 $0|50>|$8 $0>|4<2<00|50 $1>|3<00< $0|/4500 $0>|50 $0>|550|6<00 Seri<es |si>|50|70>|770|8<00 $0|70 X2>>|5<4<00 $0|50>|570|6<00 $0|70>|$k $0|$8 $0>|6<230|350>>>|X<1<050|2<00 $0|50|70>>|$a/X550/X1050 $0|press <1<1<00|50 $0>|2<00 $0|50>>|$i $0>>>>>|Intel(R) <4 $0 Internal $2|829<15G/GV/910GL $3 $2 $4|45G $3 $2 $4>|946GZ $3 $2 $4|B43 $3 $2|G<33/G31 $3 $2 $4|4<1 $3 $2|5/G43 $3 $2>|965 $3 $2 $4|raphics Media Accelerator <3<150|$9 $0>|HD >>|HD $1 <3000|4<000|$j|$9>|$4>|Q<3<3 $3 $2 $4|5 $3 $2 $4>|45/Q43 $3 $2|965/Q963 $3 $2 $4>>|M<icrosoft Basic Render $n|obile Intel(R) <4<5 $3 $2 $4| $0 $3 $2 $4>|9<15GM/GMS,910GML $3 $2 $4|45< $3 $2 $4|GM $3 $2 $4>|65 $3 $2 $4>|- famiglia $3 $2 45|HD $1>>|$7 <GeForce <210 |31<0M |5M>|4<05M|10M>|6<05|1<0<0 $5 405|M>|50< LE|SE $5 430>>|$i TurboCache(TM)|500|$9>|7<0<00M / $5 610M|25 / $7 $5 630a |50 </ $7 $5 620i|PV / $7 $5 630a>>|1<00 </ $7 $5 630i|GS>|$m / $5 630M>|$a <G<S|T>|LE|SE/7200 GS>|900 GS>|8<$o G|$a GS |$j< GS|GS|M G<S|T>>|500 GT|$9< G<S|T< |S>>|GS|M G<S|T>>|$8 G<S|TS 512>>|9<100|$o GS|$a< GE|M GS >|$j< GT |M >|500< G<S|T>|M GS>|6<00< G<SO 512|T>|M G<S|T>>|$m GT>|700M GTS|$8 GT< |X/9800 GTX+>>|FX 5200|G<10<0|2M|5M>|210< |M>| 10<3M |5M >|o 7300|T< <120M|2<20|30M |40M >|3<20M|3<0M |5M>>|4<2<0M|5M>|30|40>|5<2<0M|5M>|30|45|55M>|6<10|2<0|5>|3<0M|5>|40< |M>|$m>|7<40M|55M>>|S <2<40|50>|350M|450 >|X <2<60|75|85|95>|4<60< SE|M>|80>|5<50 Ti|60< Ti |M>|70|80M>|6<50 Ti BOOST|60< Ti|M >|7<0|5M>|80|90>|7<60 (192-bit)|70|80>>>>>|ION|MCP67M|$5 750a SLI|NVS <3<00|100M >|4200M|5<100M|$o|400M >>|Quadro <1000M|2000M|$9|FX <1<500M|$k|$8>|2<500M|700M>|3700|5<70|80>|770M|880M>|K<3000M|$9>|NVS <1<10M|35M|40M|60M>|2<85|90>>>>|R<adeon <(TM) HD 64<$l|90M>|HD 6470M|X<1<$a/X1550 $0|550 <64-bit|$0>|650 S<E|eries >|950 $0>|$a/X550/X1050 $0|$8 GTO>>|DPDD Chained DD|oyal BNA $n|S880>|SiS Mirage 3 $1|VIA Chrome9 HC IGP $4 $h|WinFast GT 640($7)><| (Microsoft Corporation< <$h 1.1) |- $h< <1.<0)|1)|2)>|v1.<1)|2<0)|)>|3)>>|)>>|- $h v1.<1)|20)>>>< Direct3D<11 vs_<4_<0 ps_4_0|1 ps_4_1>|5_0 ps_5_0>|9<Ex|> vs_<0_0 ps_<2_0|3_0>|2_0 ps_2_0|3_0 ps_3_0>>|>)".replace(
					/\$([0-9a-z]+)/gi,
					function(m, index){
						return words[parseInt(index, 36)];
					}
				);
				return scope.pickOneFromTree(compressed, window);
				
			}
		},
		{
			vendor: "NVIDIA Corporation",
			renderers: [
				"GeForce 8600M GT/PCIe/SSE2",
				"GeForce GT 430/PCIe/SSE2",
				"GeForce GT 520/PCIe/SSE2",
				"GeForce GTX 650 Ti/PCIe/SSE2",
				"GeForce GTX 680/PCIe/SSE2",
				"GeForce GTX 770/PCIe/SSE2",
				"NVIDIA GeForce 320M OpenGL Engine",
				"NVIDIA GeForce 8600M GT OpenGL Engine",
				"NVIDIA GeForce 8800 GS OpenGL Engine",
				"NVIDIA GeForce 8800 GT OpenGL Engine",
				"NVIDIA GeForce 9400 OpenGL Engine",
				"NVIDIA GeForce 9400M OpenGL Engine",
				"NVIDIA GeForce 9600M GT OpenGL Engine",
				"NVIDIA GeForce GT 130 OpenGL Engine",
				"NVIDIA GeForce GT 330M OpenGL Engine",
				"NVIDIA GeForce GT 640M OpenGL Engine",
				"NVIDIA GeForce GT 650M OpenGL Engine",
				"NVIDIA GeForce GT 750M OpenGL Engine",
				"NVIDIA GeForce GTX 660M OpenGL Engine",
				"NVIDIA GeForce GTX 675MX OpenGL Engine",
				"NVIDIA GeForce GTX 680MX OpenGL Engine",
				"Quadro 2000/PCIe/SSE2",
				"Quadro 2000M/PCIe/SSE2",
				"Quadro FX 1800/PCIe/SSE2",
				"Quadro K600/PCIe/SSE2",
			]
		},
		{
			vendor: "VMware, Inc.",
			renderers: [
				"Gallium 0.4 on i915 (chipset: Pineview M)",
				"Gallium 0.4 on llvmpipe (LLVM 3.2, 128 bits)",
			]
		},
		{
			vendor: "TransGaming Inc.",
			renderers: [
				"SwiftShader",
			]
		},
	];
}());
;

/* ===== lib/webgl.js ===== */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
(function(){
	"use strict";
	
	const logging = require("./logging");
	
	let scope;
	if ((typeof exports) !== "undefined"){
		scope = exports;
	}
	else {
		scope = require.register("./webgl", {});
	}
	
	scope.copyCanvasToWebgl = function copyCanvasToWebgl(window, canvas, webGLVersion = "webgl"){
		const webGlCanvas = canvas.cloneNode(true);
		const context =
			window.HTMLCanvasElement.prototype.getContext.call(webGlCanvas, webGLVersion) ||
			window.HTMLCanvasElement.prototype.getContext.call(webGlCanvas, "experimental-" + webGLVersion);
		if (!context){
			// unable to get a context...
			logging.warning("unable to create webgl context.");
			return {canvas: false, context: false};
		}
		
		context.viewport(0, 0, webGlCanvas.width, webGlCanvas.height);
		
		const program = context.createProgram();
		
		const vertexShader = context.createShader(context.VERTEX_SHADER);
		const vertex = "attribute vec4 a_position;\nattribute vec2 a_texCoord;\nvarying vec2 v_texCoord;\n" +
			"void main(){\n\tgl_Position = a_position;\n\tv_texCoord = a_texCoord;\n}";
		context.shaderSource(vertexShader, vertex);
		context.compileShader(vertexShader);
		if (!context.getShaderParameter(vertexShader, context.COMPILE_STATUS)){
			context.deleteShader(vertexShader);
			logging.warning("webgl: failed to compile vertex shader.");
			return {canvas: false, context: false};
		}
		context.attachShader(program, vertexShader);
		
		const fragmentShader = context.createShader(context.FRAGMENT_SHADER);
		const fragmenter = "precision mediump float;\nuniform sampler2D u_image;\nvarying vec2 v_texCoord;\n" +
			"void main(){\n\tgl_FragColor = texture2D(u_image, v_texCoord);\n}";
		context.shaderSource(fragmentShader, fragmenter);
		context.compileShader(fragmentShader);
		if (!context.getShaderParameter(fragmentShader, context.COMPILE_STATUS)){
			context.deleteShader(fragmentShader);
			logging.warning("webgl: failed to compile fragmenter shader.");
			return {canvas: false, context: false};
		}
		context.attachShader(program, fragmentShader);
		
		context.linkProgram(program);
		if (!context.getProgramParameter(program, context.LINK_STATUS)){
			context.deleteProgram(program);
			logging.warning("webgl: failed to link program.");
			return {canvas: false, context: false};
		}
		
		context.useProgram(program);
		
		const positionBuffer = context.createBuffer();
		context.bindBuffer(context.ARRAY_BUFFER, positionBuffer);
		context.bufferData(context.ARRAY_BUFFER, new Float32Array([
			-1, -1,
			-1,  1,
			 1, -1,
			 1,  1,
			-1,  1,
			 1, -1
		]), context.STATIC_DRAW);
		
		const positionAttributeLocation = context.getAttribLocation(program, "a_position");
		context.enableVertexAttribArray(positionAttributeLocation);
		const size = 2;             // 2 components per iteration
		const type = context.FLOAT; // the data is 32bit floats
		const normalize = false;    // don't normalize the data
		const stride = 0;           // 0 = move forward size * sizeof(type) each iteration to get the next position
		const offset = 0;           // start at the beginning of the buffer
		context.vertexAttribPointer(positionAttributeLocation, size, type, normalize, stride, offset);
		
		const texCoordLocation = context.getAttribLocation(program, "a_texCoord");
		
		// provide texture coordinates for the rectangle.
		const texCoordBuffer = context.createBuffer();
		context.bindBuffer(context.ARRAY_BUFFER, texCoordBuffer);
		context.bufferData(context.ARRAY_BUFFER, new Float32Array([
			0, 1,
			0, 0,
			1, 1,
			1, 0,
			0, 0,
			1, 1
		]), context.STATIC_DRAW);
		context.enableVertexAttribArray(texCoordLocation);
		context.vertexAttribPointer(texCoordLocation, 2, context.FLOAT, false, 0, 0);
		
		context.bindTexture(context.TEXTURE_2D, context.createTexture());
		context.texParameteri(context.TEXTURE_2D, context.TEXTURE_WRAP_S, context.CLAMP_TO_EDGE);
		context.texParameteri(context.TEXTURE_2D, context.TEXTURE_WRAP_T, context.CLAMP_TO_EDGE);
		context.texParameteri(context.TEXTURE_2D, context.TEXTURE_MIN_FILTER, context.NEAREST);
		context.texParameteri(context.TEXTURE_2D, context.TEXTURE_MAG_FILTER, context.NEAREST);
		context.texImage2D(context.TEXTURE_2D, 0, context.RGBA, context.RGBA, context.UNSIGNED_BYTE, canvas);
		
		context.drawArrays(context.TRIANGLES /*primitiveType*/, 0 /*triangleOffset*/, 6 /*count*/);
		
		return {webGlCanvas, context};
	};
	
	const webglRandom = require("./webglRandom");
	let randomSupply = null;
	scope.setRandomSupply = function(supply){
		randomSupply = supply;
		webglRandom.setRandomSupply(supply);
	};
	
	function getNumber({originalValue, max, index, window}){
		const bitLength = Math.floor(Math.log2(max) + 1);
		const rng = randomSupply.getBitRng(bitLength, window);
		let value = 0;
		for (let i = 0; i < bitLength; i += 1){
			value <<= 1;
			value ^= rng(originalValue, index + i);
		}
		return value;
	}
	
	const parameterFakeTypes = {
		preference: function(originalValue, definition, window, prefs){
			const settingValue = prefs(definition.preferenceName) || originalValue;
			switch (settingValue){
				case "{undefined}":
					return undefined;
				case "{false}":
					return false;
				case "{empty}":
					return "";
				case "{disabled}":
					return null;
				case "{random vendor}":
					return webglRandom.getRandomVendor(window);
				case "{random renderer}":
					return webglRandom.getRandomRenderer(window);
			}
			if (settingValue.startsWith("<") && settingValue.endsWith(">")){
				return webglRandom.pickOneFromTree(settingValue, window);
			}
			return settingValue;
		},
		decimal: function(originalValue, definition, window){
			const int = Math.floor(originalValue);
			if (int !== originalValue){
				const decimal = originalValue - int;
				const rng = randomSupply.getRng(1, window);
				const newDecimal = decimal * (rng(definition.pname) / 0xFFFFFFFF);
				return int + newDecimal;
			}
			else {
				return originalValue;
			}
		},
		shift: function(originalValue, definition, window){
			const value = getNumber({originalValue, max: definition.max, index: definition.pname, window});
			return originalValue >>> value;
		},
		"-": function(originalValue, definition, window){
			const value = getNumber({originalValue, max: definition.max, index: definition.pname, window}) *
				(definition.factor || 1);
			if (value > originalValue){
				return 0;
			}
			return originalValue - value;
		}
	};
	const parameterChangeDefinition = {
		2928: {name: "DEPTH_RANGE", type: "decimal", isArray: true},
		3379: {name: "MAX_TEXTURE_SIZE", type: "shift", max: 1},
		3386: {name: "MAX_VIEWPORT_DIMS", type: "shift", max: 1, isArray: true},
		32883: {name: "MAX_3D_TEXTURE_SIZE", type: "shift", max: 1},
		33000: {name: "MAX_ELEMENTS_VERTICES", type: "-", max: 3, factor: 50},
		33001: {name: "MAX_ELEMENTS_INDICES", type: "-", max: 3, factor: 50},
		33901: {name: "ALIASED_POINT_SIZE_RANGE", type: "decimal", isArray: true},
		33902: {name: "ALIASED_LINE_WIDTH_RANGE", type: "decimal", isArray: true},
		34024: {name: "MAX_RENDERBUFFER_SIZE", type: "shift", max: 1},
		34045: {name: "MAX_TEXTURE_LOD_BIAS", type: "-", max: 1, factor: 1},
		34076: {name: "MAX_CUBE_MAP_TEXTURE_SIZE", type: "shift", max: 1},
		34921: {name: "MAX_VERTEX_ATTRIBS", type: "shift", max: 1},
		34930: {name: "MAX_TEXTURE_IMAGE_UNITS", type: "shift", max: 1},
		35071: {name: "MAX_ARRAY_TEXTURE_LAYERS", type: "shift", max: 1},
		35371: {name: "MAX_VERTEX_UNIFORM_BLOCKS", type: "-", max: 1, factor: 1},
		35373: {name: "MAX_FRAGMENT_UNIFORM_BLOCKS", type: "-", max: 1, factor: 1},
		35374: {name: "MAX_COMBINED_UNIFORM_BLOCKS", type: "-", max: 3, factor: 1},
		35375: {name: "MAX_UNIFORM_BUFFER_BINDINGS", type: "-", max: 3, factor: 1},
		35376: {name: "MAX_UNIFORM_BLOCK_SIZE", type: "shift", max: 1},
		35377: {name: "MAX_COMBINED_VERTEX_UNIFORM_COMPONENTS", type: "-", max: 7, factor: 10},
		35379: {name: "MAX_COMBINED_FRAGMENT_UNIFORM_COMPONENTS", type: "-", max: 7, factor: 10},
		35657: {name: "MAX_FRAGMENT_UNIFORM_COMPONENTS", type: "shift", max: 1},
		35658: {name: "MAX_VERTEX_UNIFORM_COMPONENTS", type: "shift", max: 1},
		35659: {name: "MAX_VARYING_COMPONENTS", type: "shift", max: 1},
		35660: {name: "MAX_VERTEX_TEXTURE_IMAGE_UNITS", type: "shift", max: 1},
		35661: {name: "MAX_COMBINED_TEXTURE_IMAGE_UNITS", type: "-", max: 1, factor: 2},
		35968: {name: "MAX_TRANSFORM_FEEDBACK_SEPARATE_COMPONENTS", type: "shift", max: 1},
		35978: {name: "MAX_TRANSFORM_FEEDBACK_INTERLEAVED_COMPONENTS", type: "shift", max: 1},
		36203: {name: "MAX_ELEMENT_INDEX", type: "-", max: 15, factor: 1},
		36347: {name: "MAX_VERTEX_UNIFORM_VECTORS", type: "shift", max: 1},
		36348: {name: "MAX_VARYING_VECTORS", type: "shift", max: 1},
		36349: {name: "MAX_FRAGMENT_UNIFORM_VECTORS", type: "shift", max: 1},
		37154: {name: "MAX_VERTEX_OUTPUT_COMPONENTS", type: "shift", max: 1},
		37157: {name: "MAX_FRAGMENT_INPUT_COMPONENTS", type: "shift", max: 1},
		7936: {name: "VENDOR", type: "preference", preferenceName: "webGLVendor"},
		7937: {name: "RENDERER", type: "preference", preferenceName: "webGLRenderer"},
		37445: {name: "UNMASKED_VENDOR_WEBGL", type: "preference", preferenceName: "webGLUnmaskedVendor"},
		37446: {name: "UNMASKED_RENDERER_WEBGL", type: "preference", preferenceName: "webGLUnmaskedRenderer"}
	};
	
	scope.initializeParameterDefinitions = function(){
		function singleFake(originalValue, window, prefs){
			const value = parameterFakeTypes[this.type](originalValue, this, window, prefs);
			const faked = value !== originalValue;
			this.fake = function(){
				return {value, faked};
			};
			return {value, faked};
		}
		function arrayFake(originalValue, window, prefs){
			let faked = false;
			let fakedValue = [];
			for (let i = 0; i < originalValue.length; i += 1){
				fakedValue[i] = parameterFakeTypes[this.type](originalValue[i], this, window, prefs);
				faked = faked || originalValue[i] !== fakedValue[i];
				originalValue[i] = fakedValue[i];
			}
			this.fake = function(originalValue){
				if (faked){
					for (let i = 0; i < originalValue.length; i += 1){
						originalValue[i] = fakedValue[i];
					}
				}
				return {
					value: originalValue,
					faked
				};
			};
			return {
				value: originalValue,
				faked
			};
		}
		Object.keys(parameterChangeDefinition).forEach(function(parameterName){
			const definition = parameterChangeDefinition[parameterName];
			definition.pname = parameterName;
			if (!definition.fake){
				definition.fake = definition.isArray? arrayFake: singleFake;
			}
		});
	};
	scope.parameterChangeDefinition = parameterChangeDefinition;
}());
;

/* ===== lib/hash.js ===== */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
(function(){
	"use strict";
	
	let scope;
	if ((typeof exports) !== "undefined"){
		scope = exports;
	}
	else {
		scope = require.register("./hash", {});
	}
	scope.byteArrayToString = function byteArrayToString(byteArray){
		return String.fromCharCode.apply(String, new Uint16Array(byteArray.buffer));
	};
	
	scope.none = function(){
		return Symbol("no hash");
	};
	
	scope.sumXor = function(inputByteArray){
		const hash = new Uint32Array(4);
		// const sum = new Float64Array(hash.buffer, 8, 1);
		const intView = new Uint32Array(inputByteArray.buffer);
		// const floatView = new Float32Array(inputByteArray.buffer);
		const length = intView.length;
		for (let i = 0; i < length; i += 1){
			// sum[0] += floatView[i];
			hash[0] ^= intView[i];
			hash[1] = (hash[1] >>> 7 | hash[1] << 25) ^ (intView[i] >>> 11 | intView[i] << 21);
		}
		return hash;
	};
	
	scope.hashCode = function(inputByteArray){
		const hash = new Uint32Array(1);
		const intView = new Uint32Array(inputByteArray.buffer);
		const length = intView.length;
		for (let i = 0; i < length; i += 1){
			const v = hash[0];
			hash[0] = ((v << 5) - v) + intView[i];
		}
		return hash;
	};
	
	scope.md5 = function(){
		function leftRotate(v, rotate){
			return v << rotate | v >>> (32 - rotate);
		}
		const r = new Uint8Array([
			7, 12, 17, 22,  7, 12, 17, 22,  7, 12,
			17, 22,  7, 12, 17, 22,  5,  9, 14, 20,
			5,  9, 14, 20,  5,  9, 14, 20,  5,  9,
			14, 20,  4, 11, 16, 23,  4, 11, 16, 23,
			4, 11, 16, 23,  4, 11, 16, 23,  6, 10,
			15, 21,  6, 10, 15, 21,  6, 10, 15, 21,
			6, 10, 15, 21
		]);
		const k = new Uint32Array([
			0xd76aa478, 0xe8c7b756, 0x242070db, 0xc1bdceee, 0xf57c0faf,
			0x4787c62a, 0xa8304613, 0xfd469501, 0x698098d8, 0x8b44f7af,
			0xffff5bb1, 0x895cd7be, 0x6b901122, 0xfd987193, 0xa679438e,
			0x49b40821, 0xf61e2562, 0xc040b340, 0x265e5a51, 0xe9b6c7aa,
			0xd62f105d, 0x02441453, 0xd8a1e681, 0xe7d3fbc8, 0x21e1cde6,
			0xc33707d6, 0xf4d50d87, 0x455a14ed, 0xa9e3e905, 0xfcefa3f8,
			0x676f02d9, 0x8d2a4c8a, 0xfffa3942, 0x8771f681, 0x6d9d6122,
			0xfde5380c, 0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70,
			0x289b7ec6, 0xeaa127fa, 0xd4ef3085, 0x04881d05, 0xd9d4d039,
			0xe6db99e5, 0x1fa27cf8, 0xc4ac5665, 0xf4292244, 0x432aff97,
			0xab9423a7, 0xfc93a039, 0x655b59c3, 0x8f0ccc92, 0xffeff47d,
			0x85845dd1, 0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1,
			0xf7537e82, 0xbd3af235, 0x2ad7d2bb, 0xeb86d391
		]);
		const hInitial = new Uint32Array([
			0x67452301, 0xEFCDAB89, 0x98BADCFE, 0x10325476
		]);
		const h = new Uint32Array(4);
		const w = new Uint32Array(16);
		const temp = new Uint32Array(6);
		return function md5(inputByteArray){
			h.set(hInitial);
			
			const length = inputByteArray.buffer.byteLength;
			const messageBitLength = length * 8;
			
			// create byte array with length dividable by 64 (512 bit)
			const neededLength = Math.ceil((length + 1 + 8) / 64) * 64;
			const messageByteArray = new Uint8Array(neededLength);
			messageByteArray.set(new Uint8Array(inputByteArray.buffer));
			const view = new DataView(messageByteArray.buffer);
			
			// append 10...000000
			messageByteArray[length] = 0x80;
			// append size in 64 bit big endian
			view.setUint32(neededLength - 8, messageBitLength, true);
			
			for (let i = 0; i < neededLength; i += 64){
				for (let j = 0; j < 64; j += 4){
					w[j / 4] = view.getUint32(i + j, true);
				}
				
				temp.set(h);
				for (let j = 0; j < 64; j += 1){
					if (j < 16){
						temp[4] = (temp[3] ^ (temp[1] & (temp[2] ^ temp[3])));
						temp[5] = j;
					}
					else if (j < 32){
						temp[4] = (temp[2] ^ (temp[3] & (temp[1] ^ temp[2])));
						temp[5] = (5*j + 1) % 16;
					}
					else if (j < 48){
						temp[4] = ((temp[1] ^ temp[2]) ^ temp[3]);
						temp[5] = (3*j + 5) % 16;
					}
					else {
						temp[4] = (temp[2] ^ (temp[1] | (~ temp[3])));
						temp[5] = (7*j) % 16;
					}
					const temp_ = temp[3];
					temp[3] = temp[2];
					temp[2] = temp[1];
					temp[1] = (leftRotate(temp[0] + temp[4] + k[j] + w[temp[5]], r[j]) + temp[1]);
					temp[0] = temp_;
				}
				
				for (let j = 0; j < 4; j += 1){
					h[j] += temp[j];
				}
			}
			
			const hash = new Uint8Array(16);
			const hashView = new DataView(hash.buffer);
			for (let j = 0; j < 4; j += 1){
				hashView.setUint32(j * 4, h[j], true);
			}
			return hash;
		};
	}();
	
	scope.sha256 = function(){
		function rightRotate(v, rotate){
			return v >>> rotate | v << (32 - rotate);
		}
		const hInitial = new Uint32Array([
			0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
		]);
		const h = new Uint32Array(8);
			
		const k = new Uint32Array([
			0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
			0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
			0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
			0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
			0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
			0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
			0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
			0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
		]);
		const w = new Uint32Array(64);
		const temp = new Uint32Array(8);
		return function sha256(inputByteArray){
			// Algorithmus aus http://en.wikipedia.org/wiki/SHA_hash_functions#SHA-256_.28a_SHA-2_variant.29_pseudocode
			
			h.set(hInitial);
			
			const length = inputByteArray.buffer.byteLength;
			const messageBitLength = length * 8;
			
			// create byte array with length dividable by 64 (512 bit)
			const neededLength = Math.ceil((length + 1 + 8) / 64) * 64;
			const messageByteArray = new Uint8Array(neededLength);
			messageByteArray.set(new Uint8Array(inputByteArray.buffer));
			const view = new DataView(messageByteArray.buffer);
			
			// append 10...000000
			messageByteArray[length] = 0x80;
			// append size in 64 bit big endian
			view.setUint32(neededLength - 4, messageBitLength, false);
			
			for (let i = 0; i < neededLength; i += 64){
				for (let j = 0; j < 64; j += 4){
					w[j / 4] = view.getUint32(i + j, false);
				}
				for (let j = 16; j < 64; j += 1){
					const s0 = rightRotate(w[j-15], 7) ^ rightRotate(w[j-15], 18) ^ (w[j-15] >>> 3);
					const s1 = rightRotate(w[j-2], 17) ^ rightRotate(w[j-2], 19) ^ (w[j-2] >>> 10);
					w[j] = w[j-16] + s0 + w[j-7] + s1;
				}
				
				temp.set(h);
				
				for (let j = 0; j < 64; j += 1){
					const s0 = rightRotate(temp[0], 2) ^ rightRotate(temp[0], 13) ^ rightRotate(temp[0], 22);
					const maj = (temp[0] & temp[1]) ^ (temp[0] & temp[2]) ^ (temp[1] & temp[2]);
					const t2 = (s0 + maj);
					const s1 = rightRotate(temp[4], 6) ^ rightRotate(temp[4], 11) ^ rightRotate(temp[4], 25);
					const ch = (temp[4] & temp[5]) ^ ((~ temp[4]) & temp[6]);
					const t1 = (temp[7] + s1 + ch + k[j] + w[j]);
					
					temp[7] = temp[6];
					temp[6] = temp[5];
					temp[5] = temp[4];
					temp[4] = (temp[3] + t1);
					temp[3] = temp[2];
					temp[2] = temp[1];
					temp[1] = temp[0];
					temp[0] = (t1 + t2);
				}
				
				for (let j = 0; j < 8; j += 1){
					h[j] += temp[j];
				}
			}
			
			const hash = new Uint8Array(32);
			const hashView = new DataView(hash.buffer);
			for (let j = 0; j < 8; j += 1){
				hashView.setUint32(j * 4, h[j], false);
			}
			return hash;
		};
	}();
	
	scope.sha256String = function(byteArray){
		return scope.byteArrayToString(scope.sha256(byteArray));
	};
	scope.md5String = function(byteArray){
		return scope.byteArrayToString(scope.md5(byteArray));
	};
	scope.sumXorString = function(byteArray){
		return scope.byteArrayToString(scope.sumXor(byteArray));
	};
	scope.hashCodeString = function(byteArray){
		return String.fromCharCode(scope.hashCode(byteArray)[0]);
	};
}());
;

/* ===== lib/modifiedAPIFunctions.js ===== */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
(function(){
	"use strict";
	
	let scope;
	if ((typeof exports) !== "undefined"){
		scope = exports;
	}
	else {
		scope = require.register("./modifiedAPIFunctions", {});
	}
	
	scope.checkerWrapper = function checkerWrapper(checker, object, args, callback){
		const check = checker.call(object);
		if (check.allow){
			if (check.allow === true){
				return args.length?
					check.original.call(object, ...args):
					check.original.call(object);
			}
			return callback.call(object, args, check);
		}
		check.notify("blocked");
		return undefined;
	};
	
	scope.getStatusByFlag = function getStatusByFlag(flag){
		return function getStatus(obj, status, prefs){
			status = Object.create(status);
			status.active = prefs(flag, status.url);
			return status;
		};
	};
	
	scope.setFunctionProperties = function setFunctionProperties(functions, data){
		Object.keys(functions).forEach(function(key){
			const func = functions[key];
			["type", "api", "getStatus"].forEach(function(property){
				if (data[property] && !func[property]){
					func[property] = data[property];
				}
			});
		});
	};
	
	scope.setGetterProperties = function setGetterProperties(getters, data){
		getters.forEach(function(getter){
			["type", "api", "getStatus"].forEach(function(property){
				if (data[property] && !getter[property]){
					getter[property] = data[property];
				}
			});
		});
	};
	
	scope.setProperties = function setProperties(functions, getters, data){
		scope.setFunctionProperties(functions, data);
		scope.setGetterProperties(getters, data);
	};
}());
;

/* ===== lib/modifiedCanvasAPI.js ===== */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
(function(){
	"use strict";
	
	const scope = ((typeof exports) !== "undefined")? exports: require.register("./modifiedCanvasAPI");
	const colorStatistics = require("./colorStatistics");
	const logging = require("./logging");
	const extension = require("./extension");
	const webgl = require("./webgl");
	const {checkerWrapper} = require("./modifiedAPIFunctions");
	
	let randomSupply = null;
	
	function getContext(window, canvas){
		return window.HTMLCanvasElement.prototype.getContext.call(canvas, "2d") ||
			window.HTMLCanvasElement.prototype.getContext.call(canvas, "webgl") ||
			window.HTMLCanvasElement.prototype.getContext.call(canvas, "experimental-webgl") ||
			window.HTMLCanvasElement.prototype.getContext.call(canvas, "webgl2") ||
			window.HTMLCanvasElement.prototype.getContext.call(canvas, "experimental-webgl2");
	}
	function getImageData(window, context){
		let imageData;
		let source;
		if ((context.canvas.width || 0) * (context.canvas.height || 0) === 0){
			imageData = new (extension.getWrapped(window).ImageData)(0, 0);
			source = new (extension.getWrapped(window).ImageData)(0, 0);
		}
		else if (context instanceof window.CanvasRenderingContext2D){
			imageData = window.CanvasRenderingContext2D.prototype.getImageData.call(
				context,
				0, 0,
				context.canvas.width, context.canvas.height
			);
			source = imageData.data;
		}
		else {
			imageData = new (extension.getWrapped(window).ImageData)(context.canvas.width, context.canvas.height);
			source = new Uint8Array(imageData.data.length);
			(
				context instanceof window.WebGLRenderingContext?
					window.WebGLRenderingContext:
					window.WebGL2RenderingContext
			).prototype.readPixels.call(
				context,
				0, 0, context.canvas.width, context.canvas.height,
				context.RGBA, context.UNSIGNED_BYTE,
				source
			);
		}
		return {
			imageData,
			source
		};
	}
	
	const canvasCache = Object.create(null);
	function getFakeCanvas(window, original, prefs){
		try {
			let originalDataURL;
			if (prefs("useCanvasCache")){
				originalDataURL = original.toDataURL();
				const cached = canvasCache[originalDataURL];
				if (cached){
					return cached;
				}
			}
			// original may not be a canvas -> we must not leak an error
			let context = getContext(window, original);
			const {imageData, source} = getImageData(window, context);
			const desc = imageData.data;
			const l = desc.length;
			
			let ignoredColors = {};
			let statistic;
			if (prefs("ignoreFrequentColors")){
				statistic = colorStatistics.compute(source);
				ignoredColors = statistic.getMaxColors(prefs("ignoreFrequentColors"));
			}
			if (prefs("minColors")){
				if (!colorStatistics.hasMoreColors(source, prefs("minColors"), statistic)){
					return original;
				}
			}
			
			const rng = randomSupply.getPixelRng(l, window, ignoredColors);
			const fakeAlphaChannel = prefs("fakeAlphaChannel");
			for (let i = 0; i < l; i += 4){
				const [r, g, b, a] = rng(
					source[i + 0],
					source[i + 1],
					source[i + 2],
					source[i + 3],
					i / 4
				);
				desc[i + 0] = r;
				desc[i + 1] = g;
				desc[i + 2] = b;
				desc[i + 3] = fakeAlphaChannel? a: source[i + 3];
			}
			const canvas = original.cloneNode(true);
			context = window.HTMLCanvasElement.prototype.getContext.call(canvas, "2d");
			context.putImageData(imageData, 0, 0);
			if (prefs("useCanvasCache")){
				canvasCache[originalDataURL] = canvas;
				canvasCache[canvas.toDataURL()] = canvas;
			}
			return canvas;
		}
		catch (error){
			logging.warning("Error while faking:", error);
			return original;
		}
	}
	function randomMixImageData(window, imageData1, imageData2){
		const data1 = imageData1.data;
		const data2 = imageData2.data;
		const l = data1.length;
		if (l === data2.length){
			const rng = randomSupply.getPixelRng(l, window, {});
			
			for (let i = 0; i < l; i += 4){
				const signR = data1[i + 0] > data2[i + 0]? -1: 1;
				const signG = data1[i + 1] > data2[i + 1]? -1: 1;
				const signB = data1[i + 2] > data2[i + 2]? -1: 1;
				const signA = data1[i + 3] > data2[i + 3]? -1: 1;
				
				const [deltaR, deltaG, deltaB, deltaA] = rng(
					signR * (data2[i + 0] - data1[i + 0]),
					signG * (data2[i + 1] - data1[i + 1]),
					signB * (data2[i + 2] - data1[i + 2]),
					signA * (data2[i + 3] - data1[i + 3]),
					i / 4
				);
				data2[i + 0] = data1[i + 0] + signR * deltaR;
				data2[i + 1] = data1[i + 1] + signG * deltaG;
				data2[i + 2] = data1[i + 2] + signB * deltaB;
				data2[i + 3] = data1[i + 3] + signA * deltaA;
			}
		}
		return imageData2;
	}
	
	function canvasSizeShouldBeFaked(canvas, prefs){
		if (canvas){
			const size = canvas.height * canvas.width;
			const maxSize = prefs("maxFakeSize") || Number.POSITIVE_INFINITY;
			const minSize = prefs("minFakeSize") || 0;
			return size > minSize && size <= maxSize;
		}
		else {
			return true;
		}
	}
	
	function getProtectedPartChecker(pref, url){
		const protectedPart = pref("protectedCanvasPart", url);
		if (protectedPart === "everything"){
			return function(){
				return true;
			};
		}
		else if (protectedPart === "nothing"){
			return function(){
				return false;
			};
		}
		else {
			return function(parts){
				if (Array.isArray(parts)){
					return parts.some(function(part){
						return part === protectedPart;
					});
				}
				else {
					return parts === protectedPart;
				}
			};
		}
	}
	
	scope.setRandomSupply = function(supply){
		randomSupply = supply;
		webgl.setRandomSupply(supply);
	};
	
	const canvasContextType = new WeakMap();
	function createGetStatus(protectedPart){
		if (protectedPart === "readout+"){
			return function(obj, status, prefs){
				const protectedPartChecker = getProtectedPartChecker(prefs, status.url);
				status = Object.create(status);
				status.active = protectedPartChecker("readout");
				if (!status.active && protectedPartChecker("input")){
					const contextType = canvasContextType.get(obj);
					status.active = contextType !== "2d";
				}
				return status;
			};
		}
		return function getStatus(obj, status, prefs){
			const protectedPartChecker = getProtectedPartChecker(prefs, status.url);
			status = Object.create(status);
			status.active = protectedPartChecker(protectedPart);
			return status;
		};
	}
	
	function useFakeCanvasCallback(args, check){
		const {prefs, notify, window, original} = check;
		if (canvasSizeShouldBeFaked(this, prefs)){
			const fakeCanvas = getFakeCanvas(window, this, prefs);
			if (fakeCanvas !== this){
				notify("fakedReadout");
			}
			return original.call(fakeCanvas, ...args);
		}
		else {
			return original.call(this, ...args);
		}
	}
	
	function mixOnInputCallback(args, check){
		const {prefs, notify, window, original} = check;
		if (!this || canvasSizeShouldBeFaked(this.canvas, prefs)){
			notify("fakedInput");
			let oldImageData;
			let x, y, width, height;
			const getImageData = window.CanvasRenderingContext2D.prototype.getImageData;
			const border = 4;
			try {
				// "this" is not trustable - it may be not a context
				const measurement = window.CanvasRenderingContext2D.prototype.measureText.call(this, args[0]);
				const left = Math.max(0, measurement.actualBoundingBoxLeft);
				const top = Math.max(0, measurement.actualBoundingBoxAscent);
				width = Math.ceil(measurement.actualBoundingBoxRight + left) + 2 * border;
				height = Math.ceil(measurement.actualBoundingBoxDescent + top) + 2 * border;
				x = args[1] - border - left;
				y = args[2] - border - top;
				oldImageData = getImageData.call(this, x, y, width, height);
			}
			catch (error){
				// nothing to do here
			}
			// if "this" is not a correct context the next line will throw an error
			const ret = original.call(this, ...args);
			const newImageData = getImageData.call(this, x, y, width, height);
			this.putImageData(randomMixImageData(window, oldImageData, newImageData), x, y);
			return ret;
		}
		else {
			return original.call(this, ...args);
		}
	}
	
	function offscreenToBlobCallback(args, check){
		const {prefs, notify, window, original} = check;
		if (canvasSizeShouldBeFaked(this, prefs)){
			try {
				const canvas = window.document.createElement("canvas");
				canvas.width = this.width;
				canvas.height = this.height;
				const context = canvas.getContext("2d");
				context.drawImage(this.transferToImageBitmap(), 0, 0);
				const fakeCanvas = getFakeCanvas(window, canvas, prefs);
				if (fakeCanvas !== canvas){
					notify("fakedReadout");
				}
				
				const fakeContext = getContext(window, fakeCanvas);
				const {imageData} = getImageData(window, fakeContext);
				const fakeOffscreenCanvas = new window.OffscreenCanvas(this.width, this.height);
				const offscreenContext = fakeOffscreenCanvas.getContext("2d");
				offscreenContext.putImageData(imageData, 0, 0);
				return original.call(fakeOffscreenCanvas, ...args);
			}
			catch (error){
				logging.warning("Error while faking:", error);
				return original.call(this, ...args);
			}
		}
		else {
			return original.call(this, ...args);
		}
	}
	
	const isPointCache = Object.create(null);
	function getIsPointCacheIndex(x, y, values){
		return String.fromCodePoint(...values, x, y);
	}
	function getIsPointValue({func, x, y, index, originalValue, window, prefs}){
		const useCanvasCache = prefs("useCanvasCache");
		let cacheIndex;
		const values = [originalValue, func(x^1, y), func(x, y^1), func(x^1, y^1)];
		if (useCanvasCache){
			cacheIndex = getIsPointCacheIndex(x, y, values);
			const cached = isPointCache[cacheIndex];
			if ((typeof cached) === "boolean"){
				return cached;
			}
		}
		
		const rng = randomSupply.getIndexRng(1, 4, window);
		const res = values[rng(index)];
		
		if (useCanvasCache){
			isPointCache[cacheIndex] = res;
		}
		return res;
	}
	
	// changed functions and their fakes
	scope.changedFunctions = {
		getContext: {
			type: "context",
			getStatus: function(obj, status, prefs){
				if (status.internal){
					return {
						mode: "allow",
						type: status.type,
						active: false
					};
				}
				else if (getProtectedPartChecker(prefs, status.url)("input")){
					return {
						mode: status.mode,
						type: status.type,
						active: true
					};
				}
				else {
					status = Object.create(status);
					status.active = false;
					return status;
				}
			},
			object: "HTMLCanvasElement",
			fakeGenerator: function(checker){
				return function getContext(context, contextAttributes){
					return checkerWrapper(checker, this, arguments, function(args, check){
						const {original} = check;
						canvasContextType.set(this, context);
						return original.call(this, ...args);
					});
				};
			}
		},
		toDataURL: {
			type: "readout",
			getStatus: createGetStatus("readout+"),
			object: "HTMLCanvasElement",
			fakeGenerator: function(checker){
				return function toDataURL(){
					return checkerWrapper(checker, this, arguments, useFakeCanvasCallback);
				};
			}
		},
		toBlob: {
			type: "readout",
			getStatus: createGetStatus("readout+"),
			object: "HTMLCanvasElement",
			fakeGenerator: function(checker){
				return function toBlob(callback){
					if (this instanceof toBlob){
						throw new extension.getWrapped(window).TypeError(
							"HTMLCanvasElement.prototype.toBlob is not a constructor"
						);
					}
					return checkerWrapper(checker, this, arguments, useFakeCanvasCallback);
				};
			},
			exportOptions: {allowCallbacks: true}
		},
		mozGetAsFile: {
			type: "readout",
			getStatus: createGetStatus("readout+"),
			object: "HTMLCanvasElement",
			fakeGenerator: function(checker){
				return function mozGetAsFile(callback){
					return checkerWrapper(checker, this, arguments, useFakeCanvasCallback);
				};
			},
			exportOptions: {allowCallbacks: true}
		},
		getImageData: {
			type: "readout",
			getStatus: createGetStatus("readout"),
			object: "CanvasRenderingContext2D",
			fakeGenerator: function(checker){
				return function getImageData(sx, sy, sw, sh){
					return checkerWrapper(checker, this, arguments, function(args, check){
						const {prefs, notify, window, original} = check;
						if (!this || canvasSizeShouldBeFaked(this.canvas, prefs)){
							let fakeCanvas;
							let context = this;
							if (this && this.canvas) {
								fakeCanvas = getFakeCanvas(window, this.canvas, prefs);
							}
							if (fakeCanvas && fakeCanvas !== this.canvas){
								notify("fakedReadout");
								context = window.HTMLCanvasElement.prototype.getContext.call(
									fakeCanvas,
									"2d"
								);
							}
							return original.call(context, ...args);
						}
						else {
							return original.call(this, ...args);
						}
					});
				};
			}
		},
		isPointInPath: {
			type: "readout",
			getStatus: createGetStatus("readout"),
			object: "CanvasRenderingContext2D",
			fakeGenerator: function(checker){
				return function isPointInPath(x, y){
					return checkerWrapper(checker, this, arguments, function(args, check){
						const {prefs, notify, window, original} = check;
						const originalValue = original.call(this, ...args);
						if ((typeof originalValue) === "boolean"){
							notify("fakedReadout");
							return getIsPointValue({
								func: (x, y) => original.call(this, x, y, args[2]),
								x, y,
								index: x + this.canvas.width * y,
								originalValue, window, prefs
							});
						}
						else {
							return originalValue;
						}
					});
				};
			}
		},
		isPointInStroke: {
			type: "readout",
			getStatus: createGetStatus("readout"),
			object: "CanvasRenderingContext2D",
			fakeGenerator: function(checker){
				return function isPointInStroke(x, y){
					return checkerWrapper(checker, this, arguments, function(args, check){
						const {prefs, notify, window, original} = check;
						const originalValue = original.call(this, ...args);
						if ((typeof originalValue) === "boolean"){
							notify("fakedReadout");
							let func;
							if (x instanceof window.Path2D){
								let path = x;
								x = y;
								y = args[2];
								func = (x, y) => original.call(this, path, x, y);
							}
							else {
								func = (x, y) => original.call(this, x, y);
							}
							return getIsPointValue({
								func,
								x, y,
								index: x + this.canvas.width * y,
								originalValue, window, prefs
							});
						}
						else {
							return originalValue;
						}
					});
				};
			}
		},
		fillText: {
			type: "input",
			getStatus: createGetStatus("input"),
			object: "CanvasRenderingContext2D",
			fakeGenerator: function(checker){
				return function fillText(str, x, y){
					return checkerWrapper(checker, this, arguments, mixOnInputCallback);
				};
			}
		},
		strokeText: {
			type: "input",
			getStatus: createGetStatus("input"),
			object: "CanvasRenderingContext2D",
			fakeGenerator: function(checker){
				return function strokeText(str, x, y){
					return checkerWrapper(checker, this, arguments, mixOnInputCallback);
				};
			}
		},
		readPixels: {
			type: "readout",
			getStatus: createGetStatus(["readout", "input"]),
			object: ["WebGLRenderingContext", "WebGL2RenderingContext"],
			fakeGenerator: function(checker){
				// eslint-disable-next-line max-params
				return function readPixels(x, y, width, height, format, type, pixels){
					return checkerWrapper(checker, this, arguments, function(args, check){
						const {prefs, notify, window, original} = check;
						if (!this || canvasSizeShouldBeFaked(this.canvas, prefs)){
							notify("fakedReadout");
							const fakeCanvas = getFakeCanvas(window, this.canvas, prefs);
							const {context} = webgl.copyCanvasToWebgl(
								window,
								fakeCanvas,
								this instanceof window.WebGLRenderingContext? "webgl": "webgl2"
							);
							return original.call(context, ...args);
						}
						else {
							return original.call(this, ...args);
						}
					});
				};
			}
		},
		getParameter: {
			type: "readout",
			getStatus: createGetStatus(["readout", "input"]),
			object: ["WebGLRenderingContext", "WebGL2RenderingContext"],
			fakeGenerator: function(checker){
				webgl.initializeParameterDefinitions();
				return function getParameter(pname){
					return checkerWrapper(checker, this, arguments, function(args, check){
						const {prefs, notify, window, original} = check;
						const originalValue = original.call(this, ...args);
						if (webgl.parameterChangeDefinition[pname]){
							const definition = webgl.parameterChangeDefinition[pname];
							const {value, faked} = definition.fake(originalValue, window, prefs);
							if (faked){
								notify("fakedReadout");
							}
							return value;
						}
						else {
							return originalValue;
						}
					});
				};
			}
		},
		getExtension: {
			type: "readout",
			getStatus: createGetStatus(["readout", "input"]),
			object: ["WebGLRenderingContext", "WebGL2RenderingContext"],
			fakeGenerator: function(checker){
				return function getExtension(extensionName){
					return checkerWrapper(checker, this, arguments, function(args, check){
						const {prefs, notify, window, original} = check;
						const originalValue = original.call(this, ...args);
						if (
							extensionName === "WEBGL_debug_renderer_info" &&
							originalValue &&
							webgl.parameterChangeDefinition[originalValue.UNMASKED_VENDOR_WEBGL] &&
							webgl.parameterChangeDefinition[originalValue.UNMASKED_RENDERER_WEBGL]
						){
							const {value: vendorValue, faked: vendorFaked} = webgl
								.parameterChangeDefinition[originalValue.UNMASKED_VENDOR_WEBGL]
								.fake(this.getParameter(originalValue.UNMASKED_VENDOR_WEBGL), window, prefs);
							const {value: rendererValue, faked: rendererFaked} = webgl
								.parameterChangeDefinition[originalValue.UNMASKED_RENDERER_WEBGL]
								.fake(this.getParameter(originalValue.UNMASKED_RENDERER_WEBGL), window, prefs);
							if (
								vendorFaked && vendorValue === null &&
								rendererFaked && rendererValue === null
							){
								const value = null;
								if (originalValue !== value){
									notify("fakedReadout");
								}
								return value;
							}
							else {
								return originalValue;
							}
						}
						else {
							return originalValue;
						}
					});
				};
			}
		},
		convertToBlob: {
			type: "readout",
			getStatus: createGetStatus("readout"),
			object: ["OffscreenCanvas"],
			fakeGenerator: function(checker){
				return function convertToBlob(){
					return checkerWrapper(checker, this, arguments, offscreenToBlobCallback);
				};
			}
		},
		offscreenToBlob: {
			name: "toBlob",
			type: "readout",
			getStatus: createGetStatus("readout"),
			object: ["OffscreenCanvas"],
			fakeGenerator: function(checker){
				return function toBlob(){
					return checkerWrapper(checker, this, arguments, offscreenToBlobCallback);
				};
			}
		},
	};
	Object.keys(scope.changedFunctions).forEach(function(key){
		scope.changedFunctions[key].api = "canvas";
	});
}());
;

/* ===== lib/modifiedAudioAPI.js ===== */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
(function(){
	"use strict";
	
	let scope;
	if ((typeof exports) !== "undefined"){
		scope = exports;
	}
	else {
		scope = require.register("./modifiedAudioAPI", {});
	}
	
	const {sha256String: hashing} = require("./hash");
	const {checkerWrapper, setFunctionProperties, getStatusByFlag} = require("./modifiedAPIFunctions");
	
	let randomSupply = null;
	
	const getAudioFakeRate = function(){
		const audioFakeRate = {
			"1": function(){return 1;},
			"10": function(){return 10;},
			"100": function(){return 100;},
			"1000": function(){return 1000;},
			"0.1%": function(array){return array.length / 1000;},
			"1%": function(array){return array.length / 100;},
			"10%": function(array){return array.length / 10;},
			"100%": function(array){return array.length;},
		};
		return function getAudioFakeRate(array, prefs){
			const func = audioFakeRate[prefs("audioFakeRate")];
			if (typeof func === "function"){
				return func(array);
			}
			else {
				return 10;
			}
		};
	}();
	const getAudioNoiseLevel = function(){
		const audioNoiseLevel = {
			"minimal": 0.0001,
			"low": 0.0005,
			"medium": 0.001,
			"high": 0.005,
			"maximal": 0.01
		};
		return function getAudioNoiseLevel(prefs){
			return audioNoiseLevel[prefs("audioNoiseLevel")] || 0.0001;
		};
	}();
	function forEachFixedIndex(prefs, callback){
		if (prefs("audioUseFixedIndices")){
			prefs("audioFixedIndices")
				.split(",")
				.map(function(str){
					return parseInt(str, 10);
				}).filter(function(num){
					return !isNaN(num);
				}).filter(function(num, i, array){
					return array.indexOf(num) === i;
				}).forEach(callback);
		}
	}
	
	function forEachIndex(array, prefs, callback){
		const length = array.length;
		const rate = getAudioFakeRate(array, prefs);
		let start = 0;
		forEachFixedIndex(prefs, function(index){
			callback(index, start);
			start += 1;
		});
		if (start < rate){
			const delta = Math.floor(length / (rate - start));
			const indexRng = randomSupply.getIndexRng(1, length - delta * (rate - start - 1), window);
			let offset = indexRng(0);
			for (let i = start; i < rate; i += 1){
				callback(offset, i);
				offset += delta;
			}
		}
	}
	
	const floatCache = Object.create(null);
	const intCache = Object.create(null);
	
	function arrayHasAnyNonZero(array){
		for (let i = 0, l = array.length; i < l; i += 1){
			if (array[i]){
				return true;
			}
		}
		return false;
	}
	
	function fakeFloat32Array(array, window, prefs){
		if (arrayHasAnyNonZero(array)){
			let cached = false;
			let hash;
			if (prefs("useAudioCache")){
				hash = hashing(array);
				cached = floatCache[hash];
			}
			if (!cached){
				const rate = getAudioFakeRate(array, prefs);
				const noiseLevel = getAudioNoiseLevel(prefs);
				const rng = randomSupply.getRng(rate, window);
				forEachIndex(array, prefs, function(index, i){
					let value;
					if (array[index] !== 0){
						value = array[index] * (1 + (rng(i) / 0xffffffff - 0.5) * noiseLevel);
					}
					else {
						value = Number.EPSILON * (rng(i) / 0xffffffff - 0.5) * noiseLevel;
					}
					array[index] = value;
				});
				if (prefs("useAudioCache")){
					floatCache[hash] = new array.constructor(array);
					floatCache[hashing(array)] = floatCache[hash];
				}
			}
			else {
				array.set(cached);
			}
		}
	}
	function fakeUint8Array(array, window, prefs){
		if (arrayHasAnyNonZero(array)){
			let cached = false;
			let hash;
			if (prefs("useAudioCache")){
				hash = hashing(array);
				cached = intCache[hash];
			}
			if (!cached){
				const rate = getAudioFakeRate(array, prefs);
				const rng = randomSupply.getValueRng(rate, window);
				forEachIndex(array, prefs, function(index, i){
					array[index] = rng(array[index], i);
				});
				if (prefs("useAudioCache")){
					intCache[hash] = new array.constructor(array);
					intCache[hashing(array)] = intCache[hash];
				}
			}
			else {
				array.set(cached);
			}
		}
	}
	
	scope.setRandomSupply = function(supply){
		randomSupply = supply;
	};
	
	const getChannelDataAlreadyFakedArrays = new WeakMap();
	function fakeArrayCheckerCallback(array, fakeFunction, args, check){
		const {prefs, notify, window, original} = check;
		notify("fakedAudioReadout");
		const ret = original.call(this, ...args);
		fakeFunction(array, window, prefs);
		return ret;
	}
	// changed functions and their fakes
	scope.changedFunctions = {
		getFloatFrequencyData: {
			object: ["AnalyserNode"],
			fakeGenerator: function(checker){
				return function getFloatFrequencyData(array){
					return checkerWrapper(checker, this, arguments,
						fakeArrayCheckerCallback.bind(this, array, fakeFloat32Array)
					);
				};
			}
		},
		getByteFrequencyData: {
			object: ["AnalyserNode"],
			fakeGenerator: function(checker){
				return function getByteFrequencyData(array){
					return checkerWrapper(checker, this, arguments,
						fakeArrayCheckerCallback.bind(this, array, fakeUint8Array)
					);
				};
			}
		},
		getFloatTimeDomainData: {
			object: ["AnalyserNode"],
			fakeGenerator: function(checker){
				return function getFloatTimeDomainData(array){
					return checkerWrapper(checker, this, arguments,
						fakeArrayCheckerCallback.bind(this, array, fakeFloat32Array)
					);
				};
			}
		},
		getByteTimeDomainData: {
			object: ["AnalyserNode"],
			fakeGenerator: function(checker){
				return function getByteTimeDomainData(array){
					return checkerWrapper(checker, this, arguments,
						fakeArrayCheckerCallback.bind(this, array, fakeUint8Array)
					);
				};
			}
		},
		getChannelData: {
			object: ["AudioBuffer"],
			fakeGenerator: function(checker){
				return function getChannelData(channel){
					return checkerWrapper(checker, this, arguments, function(args, check){
						const {prefs, notify, window, original} = check;
						const ret = original.call(this, ...args);
						if (!getChannelDataAlreadyFakedArrays.get(ret)){
							notify("fakedAudioReadout");
							fakeFloat32Array(ret, window, prefs);
							getChannelDataAlreadyFakedArrays.set(ret, true);
						}
						return ret;
					});
				};
			}
		},
		copyFromChannel: {
			object: ["AudioBuffer"],
			fakeGenerator: function(checker){
				return function copyFromChannel(destination, channelNumber, startInChannel){
					return checkerWrapper(checker, this, arguments, function(args, check){
						const {prefs, notify, window, original} = check;
						const channelData = this.getChannelData(channelNumber);
						if (!getChannelDataAlreadyFakedArrays.get(channelData)){
							notify("fakedAudioReadout");
							fakeFloat32Array(channelData, window, prefs);
							getChannelDataAlreadyFakedArrays.set(channelData, true);
						}
						const ret = original.call(this, ...args);
						return ret;
					});
				};
			}
		},
		getFrequencyResponse: {
			object: ["BiquadFilterNode", "IIRFilterNode"],
			fakeGenerator: function(checker){
				return function getFrequencyResponse(frequencyArray, magResponseOutput, phaseResponseOutput){
					return checkerWrapper(checker, this, arguments, function(args, check){
						const {prefs, notify, window, original} = check;
						notify("fakedAudioReadout");
						const ret = original.call(this, ...args);
						fakeFloat32Array(magResponseOutput, window, prefs);
						fakeFloat32Array(phaseResponseOutput, window, prefs);
						return ret;
					});
				};
			}
		},
	};
	
	setFunctionProperties(scope.changedFunctions, {
		type: "readout",
		getStatus: getStatusByFlag("protectAudio"),
		api: "audio"
	});
}());
;

/* ===== lib/modifiedHistoryAPI.js ===== */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
(function(){
	"use strict";
	
	let scope;
	if ((typeof exports) !== "undefined"){
		scope = exports;
	}
	else {
		scope = require.register("./modifiedHistoryAPI", {});
	}
	
	const {checkerWrapper, setGetterProperties} = require("./modifiedAPIFunctions");
	
	scope.changedGetters = [
		{
			objectGetters: [function(window){return window.History && window.History.prototype;}],
			name: "length",
			getterGenerator: function(checker){
				const temp = {
					get length(){
						return checkerWrapper(checker, this, arguments, function(args, check){
							const {prefs, notify, window, original} = check;
							const originalLength = original.call(this, ...args);
							const threshold = prefs("historyLengthThreshold", window.location);
							if (originalLength > threshold){
								notify("fakedHistoryReadout");
								return threshold;
							}
							else {
								return originalLength;
							}
						});
					}
				};
				return Object.getOwnPropertyDescriptor(temp, "length").get;
			}
		}
	];
	
	
	function getStatus(obj, status){
		status = Object.create(status);
		status.active = true;
		return status;
	}
	
	setGetterProperties(scope.changedGetters, {
		type: "readout",
		getStatus: getStatus,
		api: "history"
	});
}());
;

/* ===== lib/modifiedWindowAPI.js ===== */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
(function(){
	"use strict";
	
	let scope;
	if ((typeof exports) !== "undefined"){
		scope = exports;
	}
	else {
		scope = require.register("./modifiedWindowAPI", {});
	}
	
	const {checkerWrapper, setGetterProperties, getStatusByFlag} = require("./modifiedAPIFunctions");
	
	const windowNames = new WeakMap();
	scope.changedGetters = [
		{
			objectGetters: [function(window){return window;}],
			name: "opener",
			getterGenerator: function(checker){
				const temp = {
					get opener(){
						return checkerWrapper(checker, this, arguments, function(args, check){
							const {notify, original} = check;
							const originalOpener = original.call(this, ...args);
							if (originalOpener !== null){
								notify("fakedWindowReadout");
							}
							return null;
						});
					}
				};
				return Object.getOwnPropertyDescriptor(temp, "opener").get;
			},
			valueGenerator: function({original, notify}){
				if (original !== null){
					notify("fakedWindowReadout");
				}
				return null;
			}
		},
		{
			objectGetters: [function(window){return window;}],
			name: "name",
			getterGenerator: function(checker){
				const temp = {
					get name(){
						return checkerWrapper(checker, this, arguments, function(args, check){
							const {notify, original, prefs} = check;
							const originalName = original.call(this, ...args);
							if (
								this !== this.top &&
								prefs("allowWindowNameInFrames", this.location)
							){
								return originalName;
							}
							const returnedName = windowNames.get(this) || "";
							if (originalName !== returnedName){
								notify("fakedWindowReadout");
							}
							return returnedName;
						});
					}
				};
				return Object.getOwnPropertyDescriptor(temp, "name").get;
			},
			setterGenerator: function(window, original){
				const temp = {
					set name(name){
						original.call(this, ...arguments);
						windowNames.set(this, name);
					}
				};
				return Object.getOwnPropertyDescriptor(temp, "name").set;
			}
		}
	];
	
	setGetterProperties(scope.changedGetters, {
		type: "readout",
		getStatus: getStatusByFlag("protectWindow"),
		api: "window"
	});
}());
;

/* ===== lib/modifiedDOMRectAPI.js ===== */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
(function(){
	"use strict";
	
	let scope;
	if ((typeof exports) !== "undefined"){
		scope = exports;
	}
	else {
		scope = require.register("./modifiedDOMRectAPI", {});
	}
	
	const extension = require("./extension");
	const {checkerWrapper, setProperties, getStatusByFlag} = require("./modifiedAPIFunctions");
	const {byteArrayToString: hash} = require("./hash");
	
	
	let randomSupply = null;
	scope.setRandomSupply = function(supply){
		randomSupply = supply;
	};
	
	/**
	 * Native property getters, captured while intercepting. Keyed by property
	 * name because the same name exists on DOMRect, DOMRectReadOnly and SVGRect
	 * with a different native getter each.
	 */
	const originalGetters = Object.create(null);
	function registerOriginalGetter(property, original){
		if (!originalGetters[property]){
			originalGetters[property] = [];
		}
		if (originalGetters[property].indexOf(original) === -1){
			originalGetters[property].push(original);
		}
	}
	/**
	 * Reads a property without going through the faking getter. Objects that are
	 * not intercepted at all (DOMPoint, for instance) fall back to a plain read.
	 */
	function readOriginal(object, property){
		const getters = originalGetters[property];
		if (getters){
			for (let i = 0; i < getters.length; i += 1){
				try {
					return getters[i].call(object);
				}
				catch (error){
					// Getter of a different interface - try the next one.
				}
			}
		}
		return object[property];
	}
	scope.readOriginal = readOriginal;

	function getHash(domRect){
		return hash(new Float64Array([
			readOriginal(domRect, "x"),
			readOriginal(domRect, "y"),
			readOriginal(domRect, "width"),
			readOriginal(domRect, "height")
		]));
	}
	function getValueHash(value){
		return hash(new Float32Array([value]));
	}
	
	const registeredRects = new WeakMap();
	function registerDOMRect(domRect, notify, window, prefs){
		registeredRects.set(extension.getWrapped(domRect), {
			notify: function(){
				let done = false;
				return function(message){
					if (!done){
						done = true;
						notify(message);
					}
				};
			}(),
			window,
			prefs
		});
	}
	function getDOMRectRegistration(domRect){
		return registeredRects.get(extension.getWrapped(domRect));
	}
	
	const cache = {};
	const valueCache = [{}, {}, {}, {}, {}, {}, {}];
	scope.cache = {
		valueCache,
		X: 0,
		Y: 1,
		WIDTH: 2,
		HEIGHT: 3,
		OTHER: 4,
		Z: 5,
		W: 6,
	};
	function getFakeValue(value, i, {window, prefs, rng}){
		const valueHash = getValueHash(value);
		const cache = valueCache[i];
		let cachedValue = cache[valueHash];
		if (typeof cachedValue === "number"){
			return cachedValue;
		}
		if ((value * prefs("domRectIntegerFactor", window.location)) % 1 === 0){
			cache[valueHash] = value;
			return value;
		}
		else {
			const fakedValue = value + 0.01 * (rng(i) / 0xffffffff - 0.5);
			const fakedHash = getValueHash(fakedValue);
			cache[valueHash] = fakedValue;
			cache[fakedHash] = fakedValue;
			return fakedValue;
		}
	}
	scope.getFakeValue = getFakeValue;
	function getFakeDomRect(window, domRect, prefs, notify){
		const hash = getHash(domRect);
		let cached = cache[hash];
		if (!cached){
			notify("fakedDOMRectReadout");
			const rng = randomSupply.getRng(4, window);
			const env = {window, prefs, rng};
			cached = new (domRect instanceof window.SVGRect? window.DOMRectReadOnly: domRect.constructor)(
				getFakeValue(readOriginal(domRect, "x"), 0, env),
				getFakeValue(readOriginal(domRect, "y"), 1, env),
				getFakeValue(readOriginal(domRect, "width"), 2, env),
				getFakeValue(readOriginal(domRect, "height"), 3, env)
			);
			cache[hash] = cached;
			cache[getHash(cached)] = cached;
		}
		return cached;
	}
	function getFakeDOMPoint(window, domPoint, prefs){
		const env = {window, prefs, rng: randomSupply.getRng(7, window)};
		return new domPoint.constructor(
			getFakeValue(readOriginal(domPoint, "x"), 0, env),
			getFakeValue(readOriginal(domPoint, "y"), 1, env),
			getFakeValue(readOriginal(domPoint, "z"), 5, env),
			getFakeValue(readOriginal(domPoint, "w"), 6, env)
		);
	}
	function getFakeSVGPoint(window, svgPoint, prefs){
		const env = {window, prefs, rng: randomSupply.getRng(2, window)};
		svgPoint.x = getFakeValue(readOriginal(svgPoint, "x"), 0, env);
		svgPoint.y = getFakeValue(readOriginal(svgPoint, "y"), 1, env);
		return svgPoint;
	}
	function getFakeDOMQuad(window, domQuad, prefs, notify){
		notify("fakedDOMRectReadout");
		return new domQuad.constructor(
			getFakeDOMPoint(window, domQuad.p1, prefs),
			getFakeDOMPoint(window, domQuad.p2, prefs),
			getFakeDOMPoint(window, domQuad.p3, prefs),
			getFakeDOMPoint(window, domQuad.p4, prefs)
		);
	}
	
	function registerCallback(args, check){
		const {prefs, notify, window, original} = check;
		const originalValue = args.length?
			original.call(this, ...args):
			original.call(this);
		registerDOMRect(originalValue, notify, window, prefs);
		return originalValue;
	}
	
	function fakePointCallback(args, check){
		const {prefs, notify, window, original} = check;
		const ret = args.length? original.call(this, ...args): original.call(this);
		notify("fakedDOMRectReadout");
		if (ret instanceof window.SVGPoint){
			return getFakeSVGPoint(window, ret, prefs);
		}
		else {
			return getFakeDOMPoint(window, ret, prefs);
		}
	}
	
	scope.changedFunctions = {
		getClientRects: {
			object: ["Range", "Element"],
			fakeGenerator: function(checker){
				return function getClientRects(){
					return checkerWrapper(checker, this, arguments, function(args, check){
						const {prefs, notify, window, original} = check;
						const ret = args.length? original.call(this, ...args): original.call(this);
						for (let i = 0; i < ret.length; i += 1){
							registerDOMRect(ret[i], notify, window, prefs);
						}
						return ret;
					});
				};
			}
		},
		getBoundingClientRect: {
			object: ["Range", "Element"],
			fakeGenerator: function(checker){
				return function getBoundingClientRect(){
					return checkerWrapper(checker, this, arguments, registerCallback);
				};
				
			}
		},
		getBoxQuads: {
			object: ["Document", "Element", "Text", "CSSPseudoElement"],
			fakeGenerator: function(checker){
				return function getBoxQuads(){
					return checkerWrapper(checker, this, arguments, function(args, check){
						const {prefs, notify, window, original} = check;
						const ret = args.length? original.call(this, ...args): original.call(this);
						for (let i = 0; i < ret.length; i += 1){
							ret[i] = getFakeDOMQuad(window, ret[i], prefs, notify);
						}
						return ret;
					});
				};
			}
		},
		// It seems only getBoxQuads creates a DOMQuad and this method is behind a flag.
		// So the only way to create one is manually by the constructor and then no fingerprinting is possible.
		// getBounds: {
		// 	object: ["DOMQuad"],
		// 	fakeGenerator: function(checker){
		// 		return function getBounds(){
		// 			return checkerWrapper(checker, this, arguments, registerCallback);
		// 		};
		// 	}
		// },
		getBBox: {
			object: ["SVGGraphicsElement"],
			fakeGenerator: function(checker){
				return function getBBox(){
					return checkerWrapper(checker, this, arguments, registerCallback);
				};
			}
		},
		
		getStartPositionOfChar: {
			object: ["SVGTextContentElement"],
			fakeGenerator: function(checker){
				return function getStartOfChar(){
					return checkerWrapper(checker, this, arguments, fakePointCallback);
				};
			}
		},
		getEndPositionOfChar: {
			object: ["SVGTextContentElement"],
			fakeGenerator: function(checker){
				return function getEndOfChar(){
					return checkerWrapper(checker, this, arguments, fakePointCallback);
				};
			}
		},
		getExtentOfChar: {
			object: ["SVGTextContentElement"],
			fakeGenerator: function(checker){
				return function getExtentOfChar(){
					return checkerWrapper(checker, this, arguments, registerCallback);
				};
			}
		},
		getPointAtLength: {
			object: ["SVGGeometryElement", "SVGPathElement"],
			fakeGenerator: function(checker){
				return function getPointAtLength(){
					return checkerWrapper(checker, this, arguments, fakePointCallback);
				};
			}
		},
	};
	
	function generateChangedDOMRectPropertyGetter(property, readonly = false){
		const changedGetter = {
			objectGetters: readonly?
				[
					function(window){return window.DOMRectReadOnly && window.DOMRectReadOnly.prototype;}
				]:
				[
					function(window){return window.DOMRect && window.DOMRect.prototype;},
					function(window){return window.SVGRect && window.SVGRect.prototype;},
					function(window){return window.DOMRectReadOnly && window.DOMRectReadOnly.prototype;}
				],
			name: property,
			getterGenerator: function(checker, original){
				registerOriginalGetter(property, original);
				const temp = {
					get [property](){
						const registration = getDOMRectRegistration(this);
						if (registration){
							return getFakeDomRect(
								registration.window,
								this,
								registration.prefs,
								registration.notify
							)[property];
						}
						// `original.call(this)` rather than `this[property]`:
						// this getter *is* `this[property]` here, because the
						// Chrome port runs inside the page instead of behind an
						// Xray wrapper that would have exposed the native value.
						return original.call(this);
					}
				};
				return Object.getOwnPropertyDescriptor(temp, property).get;
			}
		};
		if (!readonly){
			changedGetter.setterGenerator = function(window, original, prefs){
				const temp = {
					set [property](newValue){
						const registration = getDOMRectRegistration(this);
						if (registration){
							const fakeDomRect = getFakeDomRect(window, this, prefs, registration.notify);
							registeredRects.delete(extension.getWrapped(this));
							["x", "y", "width", "height"].forEach((prop) => {
								if (prop === property){
									this[prop] = newValue;
								}
								else {
									this[prop] = readOriginal(fakeDomRect, prop);
								}
							});
						}
						else {
							original.call(this, ...arguments);
						}
					}
				};
				return Object.getOwnPropertyDescriptor(temp, property).set;
			};
		}
		return changedGetter;
	}
	
	scope.changedGetters = [
		generateChangedDOMRectPropertyGetter("x",      false),
		generateChangedDOMRectPropertyGetter("y",      false),
		generateChangedDOMRectPropertyGetter("width",  false),
		generateChangedDOMRectPropertyGetter("height", false),
		generateChangedDOMRectPropertyGetter("left",   true),
		generateChangedDOMRectPropertyGetter("right",  true),
		generateChangedDOMRectPropertyGetter("top",    true),
		generateChangedDOMRectPropertyGetter("bottom", true),
		{
			objectGetters: [
				function(window){
					return window.IntersectionObserverEntry && window.IntersectionObserverEntry.prototype;
				}
			],
			name: "intersectionRect",
			getterGenerator: function(checker){
				const temp = {
					get intersectionRect(){
						return checkerWrapper(checker, this, arguments, registerCallback);
					}
				};
				return Object.getOwnPropertyDescriptor(temp, "intersectionRect").get;
			}
		},
		{
			objectGetters: [
				function(window){
					return window.IntersectionObserverEntry && window.IntersectionObserverEntry.prototype;
				}
			],
			name: "boundingClientRect",
			getterGenerator: function(checker){
				const temp = {
					get boundingClientRect(){
						return checkerWrapper(checker, this, arguments, registerCallback);
					}
				};
				return Object.getOwnPropertyDescriptor(temp, "boundingClientRect").get;
			}
		},
		{
			objectGetters: [
				function(window){
					return window.IntersectionObserverEntry && window.IntersectionObserverEntry.prototype;
				}
			],
			name: "rootBounds",
			getterGenerator: function(checker){
				const temp = {
					get rootBounds(){
						return checkerWrapper(checker, this, arguments, registerCallback);
					}
				};
				return Object.getOwnPropertyDescriptor(temp, "rootBounds").get;
			}
		}
	];
	
	setProperties(scope.changedFunctions, scope.changedGetters, {
		type: "readout",
		getStatus: getStatusByFlag("protectDOMRect"),
		api: "domRect"
	});
}());
;

/* ===== lib/modifiedSVGAPI.js ===== */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
(function(){
	"use strict";
	
	let scope;
	if ((typeof exports) !== "undefined"){
		scope = exports;
	}
	else {
		scope = require.register("./modifiedSVGAPI", {});
	}
	
	const {checkerWrapper, setProperties, getStatusByFlag} = require("./modifiedAPIFunctions");
	const {byteArrayToString: hash} = require("./hash");
	
	
	let randomSupply = null;
	scope.setRandomSupply = function(supply){
		randomSupply = supply;
	};
	
	function getValueHash(value){
		return hash(new Float32Array([value]));
	}
	
	const cache = {};
	function getFakeValue(value, window){
		const valueHash = getValueHash(value);
		let cachedValue = cache[valueHash];
		if (typeof cachedValue === "number"){
			return cachedValue;
		}
		else {
			const rng = randomSupply.getRng(1, window);
			const fakedValue = value + 0.01 * (rng(0) / 0xffffffff - 0.5);
			const fakedHash = getValueHash(fakedValue);
			cache[valueHash] = fakedValue;
			cache[fakedHash] = fakedValue;
			return fakedValue;
		}
	}
	scope.getFakeValue = getFakeValue;
	
	function getFakeValueCallback(args, check){
		const {notify, window, original} = check;
		const ret = args.length? original.call(this, ...args): original.call(this);
		notify("fakedSVGReadout");
		return getFakeValue(ret, window);
	}
	
	scope.changedFunctions = {
		getTotalLength: {
			object: ["SVGGeometryElement"],
			fakeGenerator: function(checker){
				return function getTotalLength(){
					return checkerWrapper(checker, this, arguments, getFakeValueCallback);
				};
			}
		},
		getComputedTextLength: {
			object: ["SVGTextContentElement"],
			fakeGenerator: function(checker){
				return function getComputedTextLength(){
					return checkerWrapper(checker, this, arguments, getFakeValueCallback);
				};
			}
		},
		getSubStringLength: {
			object: ["SVGTextContentElement"],
			fakeGenerator: function(checker){
				return function getSubStringLength(charnum, nchars){
					return checkerWrapper(checker, this, arguments, getFakeValueCallback);
				};
			}
		},
	};
	
	
	scope.changedGetters = [];
	
	setProperties(scope.changedFunctions, scope.changedGetters, {
		type: "readout",
		getStatus: getStatusByFlag("protectSVG"),
		api: "svg"
	});
}());
;

/* ===== lib/modifiedTextMetricsAPI.js ===== */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
(function(){
	"use strict";
	
	let scope;
	if ((typeof exports) !== "undefined"){
		scope = exports;
	}
	else {
		scope = require.register("./modifiedTextMetricsAPI", {});
	}
	
	const {checkerWrapper, setProperties, getStatusByFlag} = require("./modifiedAPIFunctions");
	const {byteArrayToString: hash} = require("./hash");
	const {cache} = require("./modifiedDOMRectAPI");
	const valueCache = cache.valueCache;
	
	function getValueHash(value){
		return hash(new Float32Array([value]));
	}
	
	let randomSupply = null;
	scope.setRandomSupply = function(supply){
		randomSupply = supply;
	};
	
	function getFakeValue(window, value, i, prefs){
		const valueHash = getValueHash(value);
		const cache = valueCache[i];
		let cachedValue = cache[valueHash];
		if (typeof cachedValue === "number"){
			return cachedValue;
		}
		if ((value * prefs("domRectIntegerFactor", window.location)) % 1 === 0){
			cache[valueHash] = value;
			return value;
		}
		else {
			const rng = randomSupply.getRng(5, window);
			const fakedValue = value + 0.01 * (rng(i) / 0xffffffff - 0.5);
			const fakedHash = getValueHash(fakedValue);
			cache[valueHash] = fakedValue;
			cache[fakedHash] = fakedValue;
			return fakedValue;
		}
	}
	
	function generateChangedTextMetricsPropertyGetter(property, cacheIndex){
		const changedGetter = {
			objectGetters: [
				function(window){return window.TextMetrics && window.TextMetrics.prototype;}
			],
			name: property,
			getterGenerator: function(checker){
				const temp = {
					get [property](){
						return checkerWrapper(checker, this, arguments, function(args, check){
							const {prefs, notify, window, original} = check;
							const originalValue = original.call(this, ...args);
							const returnValue = getFakeValue(window, originalValue, cacheIndex, prefs);
							if (originalValue !== returnValue){
								notify("fakedTextMetricsReadout");
							}
							return returnValue;
						});
					}
				};
				return Object.getOwnPropertyDescriptor(temp, property).get;
			}
		};
		return changedGetter;
	}
	
	scope.changedGetters = [
		generateChangedTextMetricsPropertyGetter("width", cache.WIDTH),
		generateChangedTextMetricsPropertyGetter("actualBoundingBoxAscent", cache.OTHER),
		generateChangedTextMetricsPropertyGetter("actualBoundingBoxDescent", cache.OTHER),
		generateChangedTextMetricsPropertyGetter("actualBoundingBoxLeft", cache.OTHER),
		generateChangedTextMetricsPropertyGetter("actualBoundingBoxRight", cache.OTHER),
		generateChangedTextMetricsPropertyGetter("alphabeticBaseline", cache.OTHER),
		generateChangedTextMetricsPropertyGetter("emHeightAscent", cache.OTHER),
		generateChangedTextMetricsPropertyGetter("emHeightDescent", cache.OTHER),
		generateChangedTextMetricsPropertyGetter("fontBoundingBoxAscent", cache.OTHER),
		generateChangedTextMetricsPropertyGetter("fontBoundingBoxDescent", cache.OTHER),
		generateChangedTextMetricsPropertyGetter("hangingBaseline", cache.OTHER),
		generateChangedTextMetricsPropertyGetter("ideographicBaseline", cache.OTHER),
	];
	
	setProperties({}, scope.changedGetters, {
		type: "readout",
		getStatus: getStatusByFlag("protectTextMetrics"),
		api: "textMetrics"
	});
}());
;

/* ===== lib/navigator.js ===== */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
(function(){
	"use strict";
	
	let scope;
	if ((typeof exports) !== "undefined"){
		scope = exports;
	}
	else {
		scope = require.register("./navigator", {});
	}
	
	const settings = require("./settings");
	const check = require("./check");
	
	scope.allProperties = [
		"appCodeName", "appName",
		"appVersion", "buildID", "oscpu", "platform",
		"product",
		"productSub", "userAgent", "vendor", "vendorSub"];
	const original = {};
	// `globalThis.navigator` instead of `window.navigator`: this module is also
	// loaded by the service worker, which has a WorkerNavigator and no window.
	// Properties Chrome does not implement (oscpu, buildID, ...) stay undefined;
	// lib/intercept.js skips properties that have no descriptor, so nothing is
	// invented for them.
	const navigatorObject = globalThis.navigator;
	scope.allProperties.forEach(function(property){
		original[property] = navigatorObject[property];
	});
	const userAgent = navigatorObject.userAgent || "";
	// Kept for templates written against the Firefox version. Chromium user
	// agents carry no Firefox token, so these resolve to the empty string
	// rather than to the whole user agent.
	const firefoxVersionMatch = /Firefox\/([\d.]+)/.exec(userAgent);
	const firefoxVersionRVMatch = /;\s*rv:([\d.]+)/.exec(userAgent);
	const chromeVersionMatch = /(?:Chrome|Chromium)\/([\d.]+)/.exec(userAgent);
	original["real Firefox version"] = firefoxVersionMatch? firefoxVersionMatch[1]: "";
	original["real Firefox version - rv"] = firefoxVersionRVMatch? firefoxVersionRVMatch[1]: "";
	original["real Chrome version"] = chromeVersionMatch? chromeVersionMatch[1]: "";
	
	let changedValues = {};
	
	settings.onloaded(function(){
		changedValues = settings.navigatorDetails;
	});
	settings.on("navigatorDetails", function({newValue}){
		changedValues = newValue;
	});
	
	const getValue = function(){
		function getChangedValues(getCookieStoreId){
			if (changedValues.contextualIdentities){
				const cookieStoreId = getCookieStoreId();
				if (
					cookieStoreId !== "" &&
					cookieStoreId !== "firefox-default" &&
					changedValues.contextualIdentities[cookieStoreId]
				){
					return changedValues.contextualIdentities[cookieStoreId];
				}
				else {
					return changedValues;
				}
			}
			else {
				return changedValues;
			}
		}
		
		return function getValue(name, getCookieStoreId){
			const changedValues = getChangedValues(getCookieStoreId);
			
			function getValueInternal(name, stack = []){
				if (stack.indexOf(name) !== -1){
					return "[ERROR: loop in property definition]";
				}
				stack.push(name);
				
				switch (name){
					case "original value":
						return original[stack[stack.length - 2]];
					case "random":
						return String.fromCharCode(Math.floor(65 + 85 * Math.random()));
					default:
						if (changedValues.hasOwnProperty(name)){
							return parseString(changedValues[name], stack.slice());
						}
						else {
							return original[name];
						}
				}
			}
			function parseString(string, stack){
				if (string === "{undefined}"){
					return undefined;
				}
				return string.replace(/{([a-z[\]_. -]*)}/ig, function(m, name){
					return getValueInternal(name, stack.slice());
				});
			}
			return getValueInternal(name);
		};
	}();
	
	scope.getNavigatorValue = function getNavigatorValue(name, getCookieStoreId){
		return getValue(name, getCookieStoreId);
	};
	
	/**
	 * Chrome has no blocking webRequest, so the User-Agent header is rewritten
	 * through declarativeNetRequest instead - see lib/navigatorHeaders.js.
	 * Contextual identities (Firefox containers) do not exist either; the
	 * per-container overrides in `navigatorDetails` are simply never selected.
	 */
	scope.isUserAgentProtectionActive = function isUserAgentProtectionActive(url){
		return !!(
			settings.get("protectNavigator", url) &&
			check.check({url}).mode !== "allow" &&
			(
				!settings.protectedAPIFeatures.hasOwnProperty("userAgent @ navigator") ||
				settings.protectedAPIFeatures["userAgent @ navigator"]
			)
		);
	};
}());
;

/* ===== lib/modifiedNavigatorAPI.js ===== */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
(function(){
	"use strict";
	
	let scope;
	if ((typeof exports) !== "undefined"){
		scope = exports;
	}
	else {
		scope = require.register("./modifiedNavigatorAPI", {});
	}
	
	const {checkerWrapper, setProperties, getStatusByFlag} = require("./modifiedAPIFunctions");
	const navigator = require("./navigator");
	
	// Chrome has no contextual identities (Firefox containers): there is never a
	// cookie store id to wait for, and Firefox's synchronous wait would dead
	// lock here because the answer arrives on this very thread.
	let cookieStoreId = "";
	scope.setCookieStoreId = function(newCookieStoreId){
		if (typeof newCookieStoreId === "string"){
			cookieStoreId = (
				newCookieStoreId !== "" &&
				newCookieStoreId !== "firefox-default"
			)? newCookieStoreId: "";
		}
	};
	function getCookieStoreId(){
		return cookieStoreId;
	}
	
	scope.changedGetters = navigator.allProperties.map(function(property){
		return {
			objectGetters: [function(window){return window.Navigator && window.Navigator.prototype;}],
			name: property,
			getterGenerator: function(checker){
				const temp = {
					get [property](){
						return checkerWrapper(checker, this, arguments, function(args, check){
							const {notify, original} = check;
							const originalValue = original.call(this, ...args);
							const returnValue = navigator.getNavigatorValue(property, getCookieStoreId);
							if (originalValue !== returnValue){
								notify("fakedNavigatorReadout");
							}
							return returnValue;
						});
					}
				};
				return Object.getOwnPropertyDescriptor(temp, property).get;
			}
		};
	});
	
	scope.changedFunctions = {
		estimate: {
			objectGetters: [function(window){return window.StorageManager && window.StorageManager.prototype;}],
			fakeGenerator: function(checker){
				const quota = 10 * 1024 * 1024 * 1024;
				return function estimate(){
					return checkerWrapper(checker, this, arguments, function(args, check){
						const {notify, original, window} = check;
						const This = this;
						return new window.Promise(async function(resolve, reject){
							try {
								const originalValue = await original.call(This, ...args);
								if (originalValue.quota !== quota){
									originalValue.usage = Math.min(
										quota,
										Math.max(0, quota - (originalValue.quota - originalValue.usage))
									);
									originalValue.quota = quota;
									
									notify("fakedNavigatorReadout");
								}
								resolve(originalValue);
							}
							catch (error){
								reject(error);
							}
						});
					});
				};
			}
		}
	};
	
	setProperties(scope.changedFunctions, scope.changedGetters, {
		type: "readout",
		getStatus: getStatusByFlag("protectNavigator"),
		api: "navigator"
	});
}());
;

/* ===== lib/modifiedScreenAPI.js ===== */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
(function(){
	"use strict";
	
	let scope;
	if ((typeof exports) !== "undefined"){
		scope = exports;
	}
	else {
		scope = require.register("./modifiedScreenAPI", {});
	}
	
	const {checkerWrapper, setGetterProperties, getStatusByFlag} = require("./modifiedAPIFunctions");
	
	const physical = {
		width: Math.round(window.screen.width * window.devicePixelRatio),
		height: Math.round(window.screen.height * window.devicePixelRatio)
	};
	if (!window.matchMedia(`(device-width: ${physical.width / window.devicePixelRatio}px`).matches){
		let minWidth = Math.ceil((window.screen.width - 0.5) * window.devicePixelRatio);
		let maxWidth = Math.floor((window.screen.width + 0.5) * window.devicePixelRatio);
		for (let width = minWidth; width <= maxWidth; width += 1){
			if (window.matchMedia(`(device-width: ${width / window.devicePixelRatio}px`).matches){
				physical.width = width;
				break;
			}
		}
	}
	if (!window.matchMedia(`(device-height: ${physical.height / window.devicePixelRatio}px`).matches){
		let minHeight = Math.ceil((window.screen.height - 0.5) * window.devicePixelRatio);
		let maxHeight = Math.floor((window.screen.height + 0.5) * window.devicePixelRatio);
		for (let height = minHeight; height <= maxHeight; height += 1){
			if (window.matchMedia(`(device-height: ${height / window.devicePixelRatio}px`).matches){
				physical.height = height;
				break;
			}
		}
	}
	
	const resolutions = {
		portrait: [
			{height: 1366, width: 768},
			{height: 1440, width: 900},
			{height: 1600, width: 900},
			{height: 1920, width: 1080},
			{height: 2560, width: 1440},
			{height: 4096, width: 2160},
			{height: 8192, width: 6144},
		],
		landscape: [
			{width: 1366, height: 768},
			{width: 1440, height: 900},
			{width: 1600, height: 900},
			{width: 1920, height: 1080},
			{width: 2560, height: 1440},
			{width: 4096, height: 2160},
			{width: 8192, height: 6144},
		]
	};
	
	function getScreenDimensions(prefs, window){
		const screenSize = prefs("screenSize", window.location);
		if (screenSize.match(/\s*\d+\s*x\s*\d+\s*$/)){
			const [width, height] = screenSize.split("x").map(function(value){
				return Math.round(parseFloat(value.trim()));
			});
			return {
				width: width / window.devicePixelRatio,
				height: height / window.devicePixelRatio
			};
		}
		if (!prefs("fakeMinimalScreenSize", window.location)){
			return window.screen;
		}
		const isLandscape = window.screen.width > window.screen.height;
		// subtract 0.5 to adjust for potential rounding errors
		const innerWidth = (window.innerWidth - 0.5) * window.devicePixelRatio;
		const innerHeight = (window.innerHeight - 0.5) * window.devicePixelRatio;
		for (let resolution of resolutions[isLandscape? "landscape": "portrait"]){
			if (resolution.width >= innerWidth && resolution.height >= innerHeight){
				return {
					width: resolution.width / window.devicePixelRatio,
					height: resolution.height / window.devicePixelRatio
				};
			}
		}
		return window.screen;
	}
	
	function getFaker(dimension){
		return function fake(args, check){
			const {prefs, notify, window, original} = check;
			const originalValue = original.call(this, ...args);
			const returnValue = (typeof dimension) === "function"?
				dimension(window):
				dimension?
					Math.round(getScreenDimensions(prefs, window)[dimension]):
					0;
			if (originalValue !== returnValue){
				notify("fakedScreenReadout");
			}
			return returnValue;
		};
	}
	
	scope.changedGetters = [
		{
			objectGetters: [function(window){return window.Screen && window.Screen.prototype;}],
			name: "width",
			getterGenerator: function(checker){
				const temp = {
					get width(){
						return checkerWrapper(checker, this, arguments, getFaker("width"));
					}
				};
				return Object.getOwnPropertyDescriptor(temp, "width").get;
			}
		},
		{
			objectGetters: [function(window){return window.Screen && window.Screen.prototype;}],
			name: "height",
			getterGenerator: function(checker){
				const temp = {
					get height(){
						return checkerWrapper(checker, this, arguments, getFaker("height"));
					}
				};
				return Object.getOwnPropertyDescriptor(temp, "height").get;
			}
		},
		{
			objectGetters: [function(window){return window.Screen && window.Screen.prototype;}],
			name: "availWidth",
			getterGenerator: function(checker){
				const temp = {
					get availWidth(){
						return checkerWrapper(checker, this, arguments, getFaker("width"));
					}
				};
				return Object.getOwnPropertyDescriptor(temp, "availWidth").get;
			}
		},
		{
			objectGetters: [function(window){return window.Screen && window.Screen.prototype;}],
			name: "availHeight",
			getterGenerator: function(checker){
				const temp = {
					get availHeight(){
						return checkerWrapper(checker, this, arguments, getFaker("height"));
					}
				};
				return Object.getOwnPropertyDescriptor(temp, "availHeight").get;
			}
		},
		{
			objectGetters: [function(window){return window.Screen && window.Screen.prototype;}],
			name: "availLeft",
			getterGenerator: function(checker){
				const temp = {
					get availLeft(){
						return checkerWrapper(checker, this, arguments, getFaker(0));
					}
				};
				return Object.getOwnPropertyDescriptor(temp, "availLeft").get;
			}
		},
		{
			objectGetters: [function(window){return window.Screen && window.Screen.prototype;}],
			name: "availTop",
			getterGenerator: function(checker){
				const temp = {
					get availTop(){
						return checkerWrapper(checker, this, arguments, getFaker(0));
					}
				};
				return Object.getOwnPropertyDescriptor(temp, "availTop").get;
			}
		},
		{
			objectGetters: [function(window){return window;}],
			name: "outerWidth",
			getterGenerator: function(checker){
				const temp = {
					get outerWidth(){
						return checkerWrapper(checker, this, arguments, getFaker(window => window.top.innerWidth));
					}
				};
				return Object.getOwnPropertyDescriptor(temp, "outerWidth").get;
			}
		},
		{
			objectGetters: [function(window){return window;}],
			name: "outerHeight",
			getterGenerator: function(checker){
				const temp = {
					get outerHeight(){
						return checkerWrapper(checker, this, arguments, getFaker(window => window.top.innerHeight));
					}
				};
				return Object.getOwnPropertyDescriptor(temp, "outerHeight").get;
			}
		},
		{
			objectGetters: [function(window){return window.MediaQueryList && window.MediaQueryList.prototype;}],
			name: "matches",
			getterGenerator: function(checker){
				function getAlteredMedia(originalMedia, prefs, window){
					const dimensions = getScreenDimensions(prefs, window);
					return originalMedia.replace(
						/\(\s*(?:(min|max)-)?device-(width|height):\s+(\d+\.?\d*)px\s*\)/,
						function(m, type, dimension, value){
							value = parseFloat(value);
							let newCompareValue;
							switch (type){
								case "min":
									if (value <= dimensions[dimension]){
										newCompareValue = 0;
									}
									else {
										newCompareValue = 2 * physical[dimension];
									}
									break;
								case "max":
									if (value >= dimensions[dimension]){
										newCompareValue = 2 * physical[dimension];
									}
									else {
										newCompareValue = 0;
									}
									break;
								default:
									if (
										Math.round(value * 100) ===
										Math.round(dimensions[dimension] * 100)
									){
										newCompareValue = physical[dimension];
									}
									else {
										newCompareValue = 0;
									}
							}
							return "(" + (type? type + "-": "") +
								"device-" + dimension + ": " +
								(
									newCompareValue /
									window.devicePixelRatio
								) + "px)";
						}
					);
				}
				const temp = {
					get matches(){
						return checkerWrapper(checker, this, arguments, function(args, check){
							const {prefs, notify, window, original} = check;
							const originalValue = original.call(this, ...args);
							const screenSize = prefs("screenSize", window.location);
							if (
								(
									screenSize.match(/\s*\d+\s*x\s*\d+\s*$/) ||
									prefs("fakeMinimalScreenSize", window.location)
								) &&
								this.media.match(/device-(width|height)/)
							){
								const originalMedia = this.media;
								const alteredMedia = getAlteredMedia(originalMedia, prefs, window);
								if (alteredMedia !== originalMedia){
									const alteredQuery = window.matchMedia(alteredMedia);
									const fakedValue = original.call(alteredQuery);
									if (originalValue !== fakedValue){
										notify("fakedScreenReadout");
									}
									return fakedValue;
								}
							}
							return originalValue;
						});
					}
				};
				return Object.getOwnPropertyDescriptor(temp, "matches").get;
			}
		},
	];
	
	setGetterProperties(scope.changedGetters, {
		type: "readout",
		getStatus: getStatusByFlag("protectScreen"),
		api: "screen"
	});
}());
;

/* ===== lib/modifiedAPI.js ===== */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
(function(){
	"use strict";
	
	let scope;
	if ((typeof exports) !== "undefined"){
		scope = exports;
	}
	else {
		scope = require.register("./modifiedAPI", {});
	}
	
	const randomSupplyCallbacks = [];
	scope.setRandomSupply = function(supply){
		randomSupplyCallbacks.forEach(function(callback){
			callback(supply);
		});
	};
	scope.changedFunctions = {};
	
	scope.changedGetters = [];
	
	function appendModified(collection){
		if (collection.setRandomSupply){
			randomSupplyCallbacks.push(collection.setRandomSupply);
		}
		Object.keys(collection.changedFunctions || {}).forEach(function(key){
			scope.changedFunctions[key] = collection.changedFunctions[key];
		});
		
		(collection.changedGetters || []).forEach(function(changedGetter){
			scope.changedGetters.push(changedGetter);
		});
	}
	appendModified(require("./modifiedCanvasAPI"));
	appendModified(require("./modifiedAudioAPI"));
	appendModified(require("./modifiedHistoryAPI"));
	appendModified(require("./modifiedWindowAPI"));
	appendModified(require("./modifiedDOMRectAPI"));
	appendModified(require("./modifiedSVGAPI"));
	appendModified(require("./modifiedTextMetricsAPI"));
	appendModified(require("./modifiedNavigatorAPI"));
	appendModified(require("./modifiedScreenAPI"));
}());
;

/* ===== lib/randomSupplies.js ===== */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
(function(){
	"use strict";
	
	let scope;
	if ((typeof exports) !== "undefined"){
		scope = exports;
	}
	else {
		scope = require.register("./randomSupplies", {});
	}
	
	const rngTemplate = {
		getBitRng: function(length, window){
			const rng = this.getRng(Math.ceil(length / 32), window);
			let rnd = 0;
			let mask = 0xffffffff * 2;
			return function(value, i){
				if (mask > 0xffffffff){
					mask = 1;
					rnd = rng(i / 32);
				}
				let bit = 1 * (!!(rnd & mask));
				mask *= 2;
				return bit;
			};
		},
		getIndexRng: function(length, maxIndex, window){
			const rng = this.getRng(length, window);
			
			return function(i){
				return Math.floor(rng(i) / 0xffffffff * maxIndex);
			};
		},
		getValueRng: function(length, window){
			const rng = this.getBitRng(length, window);
			return function(value, i){
				const rnd = rng(value, i);
				
				// XOR the last bit to alter it... or not
				return value ^ (rnd & 0x01);
			};
		},
		getPixelRng: function(length, window, ignoredColors){
			const rng = this.getValueRng(length, window);
			// eslint-disable-next-line max-params
			return function(r, g, b, a, i){
				const index = String.fromCharCode(r, g, b, a);
				if (ignoredColors[index]){
					return [r, g, b, a];
				}
				const baseIndex = i * 4;
				return [
					rng(r, baseIndex + 0),
					rng(g, baseIndex + 1),
					rng(b, baseIndex + 2),
					rng(a, baseIndex + 3)
				];
			};
		}
	};

	const settings = require("./settings");
	const extension = require("./extension");
	
	function getDomain(window){
		if (settings.sharePersistentRndBetweenDomains){
			return "shared://domain";
		}
		if (!window.location.href || window.location.href === "about:blank"){
			if (window !== window.parent && window.parent){
				return getDomain(window.parent);
			}
			else if (window.opener){
				return getDomain(window.opener);
			}
		}
		return window.location.host;
	}

	let persistentRnd = Object.create(null);
	// Chrome has no contextual identities (Firefox containers): there is never a
	// cookie store id to wait for, and Firefox's synchronous wait would dead
	// lock here because the answer arrives on this very thread.
	let cookieStoreId = "";
	function getCookieStoreId(){
		return cookieStoreId;
	}
	settings.onloaded(function(){
		try {
			let storedData = JSON.parse(
				extension.inIncognitoContext?
					settings.persistentIncognitoRndStorage:
					settings.persistentRndStorage
			);
			for (let domain in storedData){
				const value = storedData[domain];
				if (
					Array.isArray(value) &&
					value.length === 128 &&
					value.every(function(value){
						return typeof value === "number" && value >= 0 && value < 256;
					})
				){
					persistentRnd[domain] = new Uint8Array(value);
				}
			}
		}
		catch (error){
			// JSON is not valid -> ignore it
		}
	});
	const getPersistentRnd = (function(){
		
		extension.message.on(function(data){
			if (data["canvasBlocker-set-domain-rnd"]){
				const {domain, incognito, rnd} = data["canvasBlocker-set-domain-rnd"];
				if (incognito === extension.inIncognitoContext){
					persistentRnd[domain] = new Uint8Array(rnd);
				}
			}
			if (data["canvasBlocker-clear-domain-rnd"]){
				const domain = getCookieStoreId() + getDomain(window);
				let ownPersistendRnd = data["canvasBlocker-clear-domain-rnd"] !== "force"? persistentRnd[domain]: false;
				persistentRnd = Object.create(null);
				if (ownPersistendRnd){
					persistentRnd[domain] = ownPersistendRnd;
					extension.message.send({
						"canvasBlocker-new-domain-rnd": {
							domain,
							incognito: extension.inIncognitoContext,
							rnd: Array.from(persistentRnd[domain])
						}
					});
				}
			}
		});
		
		return function getPersistentRnd(window){
			const domain = getCookieStoreId() + getDomain(window);
			if (!persistentRnd[domain]){
				// create the (sub-)domains random numbers if not existing
				persistentRnd[domain] = new Uint8Array(128);
				window.crypto.getRandomValues(persistentRnd[domain]);
				extension.message.send({
					"canvasBlocker-new-domain-rnd": {
						domain,
						incognito: extension.inIncognitoContext,
						rnd: Array.from(persistentRnd[domain])
					}
				});
			}
			return persistentRnd[domain];
		};
	}());
	
	scope.persistent = Object.create(rngTemplate);
	scope.persistent.name = "persistent";
	scope.persistent.setDomainRnd = function(domain, rnd){
		persistentRnd[domain] = new Uint8Array(rnd);
	};
	scope.persistent.setCookieStoreId = function(newCookieStoreId){
		if (typeof newCookieStoreId === "string"){
			cookieStoreId = (
				newCookieStoreId !== "" &&
				newCookieStoreId !== "firefox-default"
			)? newCookieStoreId + "@": "";
		}
	};
	scope.persistent.getRng = function(length, window){
		const bitSet = new Uint32Array(getPersistentRnd(window).buffer);
		const bitSetLength = bitSet.length;
		return function(i){
			return bitSet[i % bitSetLength];
		};
	};
	scope.persistent.getBitRng = function(length, window){
		const bitSet = getPersistentRnd(window);
		
		return function(value, i){
			// use the last 7 bits from the value for the index of the
			// random number
			const index = value & 0x7F;
			
			// use the last 3 bits from the position and the first bit from
			// from the value to get bit to use from the random number
			const bitIndex = ((i & 0x03) << 1) | (value >>> 7);
			
			// extract the bit
			const bit = (bitSet[index] >>> bitIndex) & 0x01;
			
			return bit;
		};
	};
	
	scope.constant = Object.create(rngTemplate);
	scope.constant.name = "constant";
	scope.constant.getRng = function(length, window){
		return scope.nonPersistent.getRng(length, window);
	};
	scope.constant.getPixelRng = (function(){
		const colors = Object.create(null);
		return function getConstantPixelRng(length, window, ignoredColors){
			const rng = scope.nonPersistent.getValueRng(1024, window);
			
			// eslint-disable-next-line max-params
			return function(r, g, b, a, i){
				const index = String.fromCharCode(r, g, b, a);
				if (ignoredColors[index]){
					return [r, g, b, a];
				}
				let color = colors[index];
				if (!color){
					color = [
						rng(r, 0),
						rng(g, 0),
						rng(b, 0),
						rng(a, 0)
					];
					colors[index] = color;
				}
				return color;
			};
		};
	}());
	
	scope.nonPersistent = Object.create(rngTemplate);
	scope.nonPersistent.name = "nonPersistent";
	scope.nonPersistent.getRng = function(length, window){
		const maxLength = 0x4000;
		let randomI = maxLength;
		let randomNumbers = new Uint32Array(Math.min(maxLength, length));
		return function(i){
			if (randomI >= randomNumbers.length){
				// refill the random number bucket if empty
				randomI = 0;
				if (length - i < maxLength){
					randomNumbers = new Uint32Array(Math.max(1, length - i));
				}
				window.crypto.getRandomValues(randomNumbers);
			}
			const rnd = randomNumbers[randomI];
			randomI += 1;
			
			return rnd;
		};
	};
	
	scope.white = {
		name: "white",
		getRng: function(){
			return function(){
				return 255;
			};
		},
		getBitRng: function(){
			return function(){
				return 1;
			};
		},
		getIndexRng: function(){
			return function(){
				return 0;
			};
		},
		getValueRng: function(){
			return this.getRng();
		},
		getPixelRng: function(){
			return function(){
				return [255, 255, 255, 255];
			};
		}
	};
}());
;

/* ===== lib/intercept.js ===== */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
(function(){
	"use strict";
	
	let scope;
	if ((typeof exports) !== "undefined"){
		scope = exports;
	}
	else {
		scope = require.register("./intercept", {});
	}
	
	const {changedFunctions, changedGetters, setRandomSupply} = require("./modifiedAPI");
	const randomSupplies = require("./randomSupplies");
	const logging = require("./logging");
	const settings = require("./settings");
	const extension = require("./extension");

	setRandomSupply(randomSupplies.nonPersistent);
	const apiNames = Object.keys(changedFunctions);
	function setRandomSupplyByType(type){
		switch (type){
			case "persistent":
				setRandomSupply(randomSupplies.persistent);
				break;
			case "constant":
				setRandomSupply(randomSupplies.constant);
				break;
			case "white":
				setRandomSupply(randomSupplies.white);
				break;
			default:
				setRandomSupply(randomSupplies.nonPersistent);
		}
	}
	settings.on("rng", function(){
		setRandomSupplyByType(settings.rng);
	});
	if (!settings.isStillDefault){
		setRandomSupplyByType(settings.rng);
	}
	
	function getURL(windowToProcess){
		let href;
		try {
			href = windowToProcess.location.href;
		}
		catch (error){
			// unable to read location due to SOP
			// since we are not able to do anything in that case we can allow everything
			return "about:SOP";
		}
		if (!href || href === "about:blank"){
			if (windowToProcess !== windowToProcess.parent){
				return getURL(windowToProcess.parent);
			}
			else if (windowToProcess.opener){
				return getURL(windowToProcess.opener);
			}
		}
		return href;
	}
	const getAllFunctionObjects = function(windowToProcess, changedFunction){
		return (
			Array.isArray(changedFunction.object)?
				changedFunction.object:
				[changedFunction.object]
		).map(function(name){
			if (name){
				const constructor = extension.getWrapped(windowToProcess)[name];
				if (constructor){
					return constructor.prototype;
				}
			}
			return false;
		}).concat(
			changedFunction.objectGetters?
				changedFunction.objectGetters.map(function(objectGetter){
					return objectGetter(extension.getWrapped(windowToProcess));
				}):
				[]
		);
	};
	/**
	 * The groups `extension.changeProperty` is called with while intercepting -
	 * one per protected API. Reverting exactly these leaves the iframe
	 * protection and the matchMedia hook that lib/frame.js installs afterwards
	 * in place.
	 */
	const interceptedApiGroups = function(){
		const groups = [];
		function add(api){
			if (api && groups.indexOf(api) === -1){
				groups.push(api);
			}
		}
		apiNames.forEach(function(name){
			add(changedFunctions[name].api);
		});
		changedGetters.forEach(function(changedGetter){
			add(changedGetter.api);
		});
		return groups;
	}();

	function revertInterception(windowToProcess){
		interceptedApiGroups.forEach(function(api){
			extension.revertProperties(windowToProcess, api);
		});
	}
	
	/**
	 * Chrome port.
	 *
	 * Firefox stalled the page on a synchronous request until the settings had
	 * arrived (lib/settings.js forceLoad), so interception always ran with the
	 * real configuration. Chrome delivers the settings over the very thread the
	 * page runs on, so blocking is impossible, and the upstream fallback -
	 * answering every protected API with `undefined` until then - breaks pages
	 * that merely use a canvas from an inline script in <head>.
	 *
	 * Instead the page is protected with the built-in defaults from
	 * document_start on, and intercepted again once the user's settings arrive
	 * a few milliseconds later. The APIs are never left unprotected; calls made
	 * inside that window are faked according to the defaults rather than the
	 * user's configuration.
	 */
	scope.preIntercept = function preIntercept({subject: windowToProcess}, apis){
		if (!settings.isStillDefault){
			logging.message("settings already loaded -> intercept right away");
			scope.intercept({subject: windowToProcess}, apis);
			return;
		}

		logging.message("settings not loaded -> intercept with the default settings");
		scope.intercept({subject: windowToProcess}, apis);
		settings.onloaded(function(){
			logging.message("settings arrived -> intercept again with the real settings");
			revertInterception(windowToProcess);
			scope.intercept({subject: windowToProcess}, apis);
		});
	};

	function getDataURL(object, prefs){
		if (
			!object ||
			!prefs("storeImageForInspection") ||
			!prefs("showNotifications")
		){
			return false;
		}
		const canvas = object instanceof HTMLCanvasElement?
			object:
			(
				object.canvas instanceof HTMLCanvasElement?
					object.canvas:
					false
			);
		if (!canvas){
			return false;
		}
		// toDataURL is faked at this point - the guard keeps the call from
		// bouncing back into the checker that is asking for this image.
		return scope.callAsExtension(function(){
			return canvas.toDataURL();
		});
	}
	
	let extensionID = extension.extensionID;

	// V8 puts the error message on the first line of the stack, Gecko does not.
	const stackFrameOffset = ((new Error()).stack || "").startsWith("Error")? 1: 0;

	/**
	 * Re-entrancy guard.
	 *
	 * CanvasBlocker calls protected APIs itself - the notification thumbnail and
	 * the canvas preview of the "ask" dialog both read the canvas. Firefox
	 * recognised those calls by matching the extension URL in the calling stack.
	 * V8 formats stacks differently and drops frames once the stack gets deep, so
	 * an explicit counter is used instead. The stack check below is kept as an
	 * additional net for calls that originate in extension code we do not wrap.
	 */
	let extensionCallDepth = 0;
	scope.callAsExtension = function callAsExtension(callback){
		extensionCallDepth += 1;
		try {
			return callback();
		}
		finally {
			extensionCallDepth -= 1;
		}
	};

	function isExtensionFrame(errorStack, callingDepth){
		const index = callingDepth + 1 + stackFrameOffset;
		const frame = errorStack.split("\n", index + 1)[index];
		return (typeof frame) === "string" && frame.indexOf(extensionID) !== -1;
	}

	function generateChecker({
		name, changedFunction, siteStatus, original,
		window: windowToProcess, prefs, notify, checkStack, ask
	}){
		return function checker(callingDepth = 3){
			const errorStack = (new Error()).stack;

			// The extension asked for the value itself - never fake that.
			if (extensionCallDepth){
				return {allow: true, original, window: windowToProcess};
			}

			try {
				// return original if the extension itself requested the function
				if (isExtensionFrame(errorStack, callingDepth)){
					return {allow: true, original, window: windowToProcess};
				}
			}
			catch (error) {
				// stack had an unknown form
			}
			if (checkStack(errorStack)){
				return {allow: true, original, window: windowToProcess};
			}
			const funcStatus = changedFunction.getStatus(this, siteStatus, prefs);
			
			const This = this;
			function notifyCallback(messageId){
				notify({
					url: getURL(windowToProcess),
					errorStack,
					messageId,
					timestamp: new Date(),
					functionName: name,
					api: changedFunction.api,
					dataURL: getDataURL(This, prefs)
				});
			}
			const protectedAPIFeatures = prefs("protectedAPIFeatures");
			if (
				funcStatus.active &&
				(
					!protectedAPIFeatures.hasOwnProperty(name + " @ " + changedFunction.api) ||
					protectedAPIFeatures[name + " @ " + changedFunction.api]
				)
			){
				if (funcStatus.mode === "ask"){
					funcStatus.mode = ask({
						window: windowToProcess,
						type: changedFunction.type,
						api: changedFunction.api,
						canvas: this instanceof HTMLCanvasElement?
							this:
							(
								this &&
								(this.canvas instanceof HTMLCanvasElement)?
									this.canvas:
									false
							),
						errorStack
					});
				}
				switch (funcStatus.mode){
					case "allow":
						return {allow: true, original, window: windowToProcess};
					case "fake":
						return {
							allow: "fake",
							prefs,
							notify: notifyCallback,
							window: windowToProcess,
							original
						};
					//case "block":
					default:
						return {allow: false, notify: notifyCallback};
				}
			}
			else {
				return {allow: true, original, window: windowToProcess};
			}
		};
	}
	
	function interceptFunctions(windowToProcess, siteStatus, {checkStack, ask, notify, prefs}){
		apiNames.forEach(function(name){
			const changedFunction = changedFunctions[name];
			if (changedFunction.name){
				name = changedFunction.name;
			}
			const functionStatus = changedFunction.getStatus(undefined, siteStatus, prefs);
			logging.verbose("status for", name, ":", functionStatus);
			if (!functionStatus.active) return;
			
			getAllFunctionObjects(windowToProcess, changedFunction).forEach(function(object){
				if (!object) return;
				
				const original = object[name];
				const checker = generateChecker({
					name, changedFunction, siteStatus, original,
					window: windowToProcess, prefs, checkStack, ask, notify
				});
				const descriptor = Object.getOwnPropertyDescriptor(object, name);
				if (!descriptor) return;
				const type = descriptor.hasOwnProperty("value")? "value": "get";
				let changed;
				if (type ==="value"){
					if (changedFunction.fakeGenerator){
						const generated = changedFunction.fakeGenerator(checker, original, windowToProcess);
						if ((changedFunction.exportOptions || {}).allowCallbacks){
							changed = extension.exportFunctionWithName(generated, windowToProcess, original.name);
						}
						else {
							changed = extension.createProxyFunction(windowToProcess, original, generated);
						}
					}
					else {
						changed = null;
					}
				}
				else {
					changed = extension.createProxyFunction(windowToProcess, original, extension.exportFunctionWithName(
						changedFunction.fakeGenerator(checker),
						windowToProcess,
						original.name
					));
				}
				extension.changeProperty(windowToProcess, changedFunction.api, {
					object, name, type, changed
				});
			});
		});
	}
	function interceptGetters(windowToProcess, siteStatus, {checkStack, ask, notify, prefs}){
		changedGetters.forEach(function(changedGetter){
			const name = changedGetter.name;
			const functionStatus = changedGetter.getStatus(undefined, siteStatus, prefs);
			logging.verbose("status for", changedGetter, ":", functionStatus);
			if (!functionStatus.active) return;
			
			changedGetter.objectGetters.forEach(function(objectGetter){
				const object = objectGetter(extension.getWrapped(windowToProcess));
				if (!object) return;
			
				const descriptor = Object.getOwnPropertyDescriptor(object, name);
				if (!descriptor) return;
				
				if (descriptor.hasOwnProperty("get")){
					const original = descriptor.get;
					const checker = generateChecker({
						name, changedFunction: changedGetter, siteStatus, original,
						window: windowToProcess, prefs, checkStack, ask, notify
					});
					const getter = changedGetter.getterGenerator(checker, original, windowToProcess);
					extension.changeProperty(windowToProcess, changedGetter.api,
						{
							object, name, type: "get",
							changed: extension.createProxyFunction(windowToProcess, original, getter)
						}
					);
					
					if (descriptor.hasOwnProperty("set") && descriptor.set && changedGetter.setterGenerator){
						const original = descriptor.set;
						const setter = changedGetter.setterGenerator(
							windowToProcess,
							original,
							prefs
						);
						extension.changeProperty(windowToProcess, changedGetter.api,
							{
								object, name, type: "set",
								changed: extension.createProxyFunction(windowToProcess, original, setter)
							}
						);
					}
					
				}
				else if (
					changedGetter.valueGenerator &&
					descriptor.hasOwnProperty("value")
				){
					const protectedAPIFeatures = prefs("protectedAPIFeatures");
					if (
						protectedAPIFeatures.hasOwnProperty(name + " @ " + changedGetter.api) &&
						!protectedAPIFeatures[name + " @ " + changedGetter.api]
					){
						return;
					}
					switch (functionStatus.mode){
						case "ask": case "block": case "fake":
							extension.changeProperty(windowToProcess, changedGetter.api, {
								object, name, type: "value",
								changed: changedGetter.valueGenerator({
									mode: functionStatus.mode,
									original: descriptor.value,
									notify: function notifyCallback(messageId){
										notify({
											url: getURL(windowToProcess),
											errorStack: (new Error()).stack,
											messageId,
											timestamp: new Date(),
											functionName: name,
											api: changedGetter.api
										});
									}
								})
							});
							break;
					}
				}
				else {
					logging.error("Try to fake non getter property:", changedGetter);
				}
			});
		});
	}
	scope.intercept = function intercept({subject: windowToProcess}, apis){
		const siteStatus = apis.check({url: getURL(windowToProcess)});
		logging.verbose("status for page", windowToProcess, siteStatus);
		if (siteStatus.mode !== "allow"){
			interceptFunctions(windowToProcess, siteStatus, apis);
			interceptGetters(windowToProcess, siteStatus, apis);
		}
	};
}());
;

/* ===== lib/callingStack.js ===== */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
(function(){
	"use strict";
	
	let scope;
	if ((typeof exports) !== "undefined"){
		scope = exports;
	}
	else {
		scope = require.register("./callingStack", {});
	}

	const settings = require("./settings");
	const extension = require("./extension");
	
	// Translation
	const _ = function(name, replace, translateAPI){
		if (!translateAPI){
			translateAPI = extension.getTranslation;
		}
		
		let str = translateAPI(name) || name;
		if (replace){
			// replace generic content in the translation by given parameter
			Object.keys(replace).forEach(function(name){
				str = str.replace(new RegExp("{" + name + "}", "g"), replace[name]);
			});
		}
		return str;
	};
	
	// Stack parsing
	// Gecko:  "name@https://host/file.js:12:34"
	// V8:     "    at name (https://host/file.js:12:34)"
	//         "    at https://host/file.js:12:34"
	const geckoStackEntry = /@(.*):(\d*):(\d*)$/;
	const v8StackEntry = /^\s*at\s+(?:.*?\s+\()?(.*):(\d+):(\d+)\)?$/;
	function parseStackEntry(entry){
		const m = geckoStackEntry.exec(entry) ||
			v8StackEntry.exec(entry) ||
			["", entry, "--", "--"];
		return {
			url: m[1],
			line: parseInt(m[2], 10),
			column: parseInt(m[3], 10),
			raw: entry
		};
	}
	
	function stackRuleMatch(stackEntry, stackRule){
		if (!stackEntry){
			return false;
		}
		if (stackEntry.url !== stackRule.url){
			return false;
		}
		if ((typeof stackRule.line) !== "undefined" && stackEntry.line !== stackRule.line){
			return false;
		}
		if ((typeof stackRule.column) !== "undefined" && stackEntry.column !== stackRule.column){
			return false;
		}
		return true;
	}

	// parse calling stack
	const extensionID = extension.extensionID;
	function parseErrorStack(errorStack){
		const callers = errorStack.trim().split("\n").filter(function(line){
			// V8 starts the stack with the error message - that is not a frame.
			return !/^[A-Za-z]*Error\b/.test(line);
		}).map(parseStackEntry).filter(function(caller){
			return !caller.url.startsWith(extensionID);
		});
		return {
			toString: function(translateAPI){
				let msg = "";
				msg += "\n\n" + _("sourceOutput", undefined, translateAPI) + ": ";
				if (settings.showCompleteCallingStack){
					msg += callers.reduce(function(stack, c){
						return stack + "\n\t" + _("stackEntryOutput", c, translateAPI);
					}, "");
				}
				else{
					msg += _("stackEntryOutput", callers[0], translateAPI);
				}
				
				return msg;
			},
			match: function(stackRule){
				if (typeof stackRule.stackPosition !== "undefined"){
					let pos = stackRule.stackPosition;
					if (pos < 0){
						pos += callers.length;
					}
					return stackRuleMatch(callers[pos], stackRule);
				}
				else {
					return callers.some(function(stackEntry){
						return stackRuleMatch(stackEntry, stackRule);
					});
				}
			}
		};
	}
	
	scope.parseErrorStack = parseErrorStack;
}());
;

/* ===== lib/askForPermission.js ===== */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
(function(){
	"use strict";
	let scope;
	if ((typeof exports) !== "undefined"){
		scope = exports;
	}
	else {
		scope = require.register("./askForPermission", {});
	}
	
	const {parseErrorStack} = require("./callingStack");
	
	// Check canvas appearance
	function canvasAppearance(window, api, context){
		let oldBorder = false;
		let canvas = false;
		let inDOM = null;
		if (api === "canvas" && context){
			let nodeName;
			try {
				nodeName = context.nodeName;
			}
			catch (error){
				nodeName = "";
			}
			if (nodeName === "CANVAS"){
				canvas = context;
			}
			else if (
				context instanceof window.CanvasRenderingContext2D ||
				context instanceof window.WebGLRenderingContext
			){
				canvas = context.canvas;
			}
		}
		if (canvas){
			oldBorder = canvas.style.border;
			canvas.style.border = "2px solid red";
			inDOM = canvas.ownerDocument.contains(canvas);
		}
		return {
			canvas: canvas,
			askCategory: canvas? (inDOM? "visible": "invisible"): (api === "canvas"? "nocanvas": api),
			get text(){
				const text = canvas? (this.visible? "visible": "invisible"): (api === "canvas"? "nocanvas": api);
				Object.defineProperty(this, "text", {value: text});
				return text;
			},
			inDom: inDOM,
			get visible(){
				let visible = inDOM;
				if (inDOM){
					canvas.scrollIntoView();
					const rect = canvas.getBoundingClientRect();
					const foundEl = window.document.elementFromPoint(
						rect.left + rect.width / 2,
						rect.top + rect.height / 2
					);
					visible = (foundEl === canvas);
				}
				Object.defineProperty(this, "visible", {value: visible});
				return visible;
			},
			reset: function(){
				if (canvas){
					canvas.style.border = oldBorder;
				}
			}
		};
	}
	
	const modes = new WeakMap();
	function getAskMode(window, type, _){
		let mode = modes.get(window);
		if (mode){
			return mode[type];
		}
		else {
			mode = {
				context: {
					askText: {
						visible: _("askForVisiblePermission"),
						invisible: _("askForInvisiblePermission"),
						nocanvas: _("askForPermission"),
						audio: _("askForAudioPermission"),
						history: _("askForHistoryPermission"),
						window: _("askForWindowPermission"),
						domRect: _("askForDOMRectPermission"),
						svg: _("askForSVGPermission"),
					},
					askStatus: {
						alreadyAsked: {},
						answer: {}
					}
				},
				input: {
					askText: {
						visible: _("askForVisibleInputPermission"),
						invisible: _("askForInvisibleInputPermission"),
						nocanvas: _("askForInputPermission"),
						audio: _("askForAudioInputPermission"),
						history: _("askForHistoryInputPermission"),
						window: _("askForWindowInputPermission"),
						domRect: _("askForDOMRectInputPermission"),
						svg: _("askForSVGInputPermission"),
					},
					askStatus: {
						alreadyAsked: {},
						answer: {}
					}
				},
				readout: {
					askText: {
						visible: _("askForVisibleReadoutPermission"),
						invisible: _("askForInvisibleReadoutPermission"),
						nocanvas: _("askForReadoutPermission"),
						audio: _("askForAudioReadoutPermission"),
						history: _("askForHistoryReadoutPermission"),
						window: _("askForWindowReadoutPermission"),
						domRect: _("askForDOMRectReadoutPermission"),
						svg: _("askForSVGReadoutPermission"),
					},
					askStatus: {
						alreadyAsked: {},
						answer: {}
					}
				}
			};
			modes.set(window, mode);
			return mode[type];
		}
	}
	
	scope.ask = function({window, type, api, canvas, errorStack}, {_, prefs}){
		let answer;
		const askMode = getAskMode(window, type, _);
		const askStatus = askMode.askStatus;
		const appearance = canvasAppearance(window, api, canvas);
		let category = appearance.askCategory;
		if (prefs("askOnlyOnce") !== "no" && askStatus.alreadyAsked[category]){
			// already asked
			appearance.reset();
			return askStatus.answer[category];
		}
		else {
			let imgContainer = null;
			if (type === "readout" && prefs("showCanvasWhileAsking") && canvas){
				try {
					let document = window.top.document;
					imgContainer = document.createElement("div");
					imgContainer.style.cssText = `
						position: fixed;
						top: 0;
						left: 0;
						right: 0;
						bottom: 0;
						background-color: rgba(0, 0, 0, 0.7);
						color: white;
						text-align: center;
						z-index: 100000000000000;
						padding: 1em;`;
					
					let heading = document.createElement("h1");
					heading.textContent = "CanvasBlocker";
					imgContainer.appendChild(heading);
					
					let text = document.createElement("div");
					text.style.margin = "0.5em auto";
					text.textContent = _("showCanvasWhileAsking_message");
					imgContainer.appendChild(text);
					
					let img = document.createElement("img");
					img.style.backgroundColor = "white";
					img.style.border = "2px solid lightgray";
					img.src = HTMLCanvasElement.prototype.toDataURL.call(canvas);
					imgContainer.appendChild(img);
					document.body.appendChild(imgContainer);
				}
				catch (error){
					// unable to read the canvas
				}
			}
			// asking
			let msg = askMode.askText[appearance.text];
			
			// visible vs invisible is only calculated here correctly
			category = appearance.text;
			if (prefs("showCallingFile")){
				msg += parseErrorStack(errorStack).toString(_);
			}
			answer = window.top.confirm(msg)? "allow": prefs("askDenyMode");
			if (imgContainer && imgContainer.parentNode){
				imgContainer.parentNode.removeChild(imgContainer);
			}

			if (prefs("askOnlyOnce") === "combined"){
				["context", "readout", "input"].forEach(function(type){
					const askMode = getAskMode(window, type, _);
					const askStatus = askMode.askStatus;
					askStatus.alreadyAsked[category] = true;
					askStatus.answer[category] = answer;
				});
			}
			else {
				askStatus.alreadyAsked[category] = true;
				askStatus.answer[category] = answer;
			}
			appearance.reset();
			return answer;
		}
	};
}());
;

/* ===== lib/lists.js ===== */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

(function(){
	"use strict";
	
	
	let scope;
	if ((typeof exports) !== "undefined"){
		scope = exports;
	}
	else {
		scope = require.register("./lists", {});
	}
	
	const settings = require("./settings");
	const logging = require("./logging");
	
	
	function getDomainRegExpList(domainList){
		const list = domainList
			.split(",")
			.map(function(entry){
				return entry.replace(/^\s+|\s+$/g, "");
			})
			.filter(function(entry){
				return !!entry.length;
			})
			.map(function(entry){
				let regExp;
				const domain = !!entry.match(/^[A-Za-z0-9_.*-]+$/);
				if (domain){
					regExp = new RegExp(
						"(?:^|\\.)" + entry.replace(/([\\+?[^\]$(){}=!|.])/g, "\\$1").replace(/\*/g, ".+") + "\\.?$",
						"i"
					);
				}
				else {
					try {
						regExp = new RegExp(entry, "i");
					}
					catch (error){
						logging.error("Error in regular expression", entry, error);
						regExp = new RegExp(
							"(?:^|\\.)" + entry.replace(/([\\+*?[^\]$(){}=!|.])/g, "\\$1") + "\\.?$",
							"i"
						);
					}
				}
				return {
					value: entry,
					match: function(url){
						if (domain){
							return (url.hostname || "").match(regExp);
						}
						else {
							return url.href.match(regExp);
						}
					}
				};
			});
			
		return addMatchToList(list);
	}
	function addMatchToList(list){
		list.match = function(url){
			return this.some(function(entry){
				return entry.match(url);
			});
		};
		
		return list;
	}

	const lists = {
		white: [],
		sessionWhite: [],
		"ignore": [],
		black: []
	};

	function updateList(type, value){
		if (typeof value === "undefined"){
			value = settings[type + "List"];
		}
		lists[type] = getDomainRegExpList(value);
		return lists[type];
	}
	Object.keys(lists).forEach(function(type){
		settings.on(type + "List", function({newValue}){
			updateList(type, newValue);
		});
		updateList(type, settings[type + "List"]);
	});

	function updateStackList(value){
		let list;
		try {
			let data = JSON.parse(value);
			if (!Array.isArray(data)){
				data = [data];
			}
			list = data.filter(function(entry){
				return typeof entry === "object" && typeof entry.url === "string";
			});
		}
		catch(error){
			list = [];
		}
		list.match = function(stack){
			return this.some(function(stackRule){
				return stack.match(stackRule);
			});
		};
		lists.stack = list;
	}
	lists.stack = [];
	settings.on("stackList", function({newValue}){
		updateStackList(newValue);
	});
	updateStackList(settings.stackList);

	scope.get = function getList(type){
		if (type === "white"){
			const combined = lists.white.slice().concat(lists.sessionWhite);
			return addMatchToList(combined);
		}
		return lists[type];
	};
	scope.appendTo = async function appendToList(type, entry){
		const oldValue = settings[type + "List"];
		await settings.set(type + "List", oldValue + (oldValue? ",": "") + entry);
		return updateList(type);
	};
	scope.removeFrom = async function removeFromList(type, entry){
		const oldValue = settings[type + "List"];
		const filter = entry.forEach? v => entry.indexOf(v) === -1: v => v !== entry;
		await settings.set(
			type + "List",
			oldValue
				.split(",")
				.map(v => v.replace(/^\s+|\s+$/, ""))
				.filter(filter)
				.join(",")
		);
		return updateList(type);
	};
	scope.update = updateList;
	scope.updateAll = function updateAllLists(){
		updateList("white");
		updateList("sessionWhite");
		updateList("ignore");
		updateList("black");
		updateStackList(settings.stackList);
	};
	settings.onloaded(scope.updateAll);
}());
;

/* ===== lib/check.js ===== */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
(function(){
	"use strict";
	
	let scope;
	if ((typeof exports) !== "undefined"){
		scope = exports;
	}
	else {
		scope = require.register("./check", {});
	}
	
	const settings = require("./settings");
	const lists = require("./lists");
	const {parseErrorStack} = require("./callingStack");
	const logging = require("./logging");

	scope.check = function check({url, errorStack}){
		url = new URL(url || "about:blank");
		const match = checkBoth(errorStack, url, settings.get("blockMode", url)).match(
			/^(block|allow|fake|ask)(|Everything|Internal)$/
		);
		if (match){
			return {
				url: url,
				internal: match[2] === "Internal",
				mode: match[1]
			};
		}
		else {
			return {
				url: url,
				internal: false,
				mode: "block"
			};
		}
		
	};

	function checkBoth(errorStack, url, blockMode){
		if (settings.enableStackList && errorStack && checkStack(errorStack)){
			return "allow";
		}
		else {
			return checkURL(url, blockMode);
		}
	}

	function checkURL(url, blockMode){
		logging.message("check url %s for block mode %s", url, blockMode);
		switch (url.protocol){
			case "about:":
				if (url.pathname === "blank"){
					logging.message("use regular mode on about:blank");
					break;
				}
				logging.message("allow internal URLs");
				return "allowInternal";
			case "chrome:":
				logging.message("allow internal URLs");
				return "allowInternal";
		}
		
		let mode = "block";
		switch (blockMode){
			case "blockEverything":
				mode = "block";
				break;
			case "block":
			case "ask":
			case "fake":
			case "allow":
				if (url && lists.get("white").match(url)){
					mode = "allow";
				}
				else if (url && lists.get("black").match(url)){
					mode = "block";
				}
				else {
					mode = blockMode;
				}
				break;
			case "allowEverything":
				mode = "allow";
				break;
			default:
				logging.warning("Unknown blocking mode (" + blockMode + "). Default to block everything.");
		}
		return mode;
	}

	function checkStack(errorStack){
		if (settings.enableStackList){
			const stackList = lists.get("stack");
			if (stackList.length){
				const callingStack = parseErrorStack(errorStack);
				return stackList.match(callingStack);
			}
		}
		return false;
	}
	scope.checkStack = checkStack;
}());
;

/* ===== lib/iframeProtection.js ===== */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
(function(){
	"use strict";
	
	let scope;
	if ((typeof exports) !== "undefined"){
		scope = exports;
	}
	else {
		scope = require.register("./iframeProtection", {});
	}
	
	const settings = require("./settings");
	const extension = require("./extension");
	const lists = require("./lists");
	
	function isWhitelisted(url){
		return lists.get("white").match(url) || settings.get("blockMode", url).startsWith("allow");
	}
	
	function createChangeProperty(window){
		function changeProperty(object, name, type, changed){
			const descriptor = Object.getOwnPropertyDescriptor(object, name);
			const original = descriptor[type];
			if ((typeof changed) === "function"){
				changed = extension.createProxyFunction(window, original, changed);
			}
			extension.changeProperty(window, "iframeProtection", {object, name, type, changed});
		}
		if (settings.isStillDefault){
			settings.onloaded(function(){
				if (isWhitelisted(window.location)){
					extension.revertProperties(window, "iframeProtection");
				}
			});
		}
		else {
			if (isWhitelisted(window.location)){
				return false;
			}
		}
		window.addEventListener("unload", function(){
			extension.revertProperties(window, "iframeProtection");
		});
		return changeProperty;
	}
	
	function protectFrameProperties({window, wrappedWindow, changeProperty, singleCallback}){
		["HTMLIFrameElement", "HTMLFrameElement"].forEach(function(constructorName){
			const constructor = window[constructorName];
			const wrappedConstructor = wrappedWindow[constructorName];
			
			const contentWindowDescriptor = Object.getOwnPropertyDescriptor(
				constructor.prototype,
				"contentWindow"
			);
			const originalContentWindowGetter = contentWindowDescriptor.get;
			const contentWindowTemp = {
				get contentWindow(){
					const window = originalContentWindowGetter.call(this);
					if (window){
						singleCallback(window);
					}
					return window;
				}
			};
			changeProperty(wrappedConstructor.prototype, "contentWindow", "get",
				Object.getOwnPropertyDescriptor(contentWindowTemp, "contentWindow").get
			);
			
			const contentDocumentDescriptor = Object.getOwnPropertyDescriptor(
				constructor.prototype,
				"contentDocument"
			);
			const originalContentDocumentGetter = contentDocumentDescriptor.get;
			const contentDocumentTemp = {
				get contentDocument(){
					const document = originalContentDocumentGetter.call(this);
					if (document){
						singleCallback(document.defaultView);
					}
					return document;
				}
			};
			changeProperty(wrappedConstructor.prototype, "contentDocument", "get",
				Object.getOwnPropertyDescriptor(contentDocumentTemp, "contentDocument").get
			);
		});
	}
	
	function protectDOMModifications({window, wrappedWindow, changeProperty, allCallback}){
		[
			// useless as length could be obtained before the iframe is created and window.frames === window
			// {
			// 	object: wrappedWindow,
			// 	methods: [],
			// 	getters: ["length", "frames"],
			// 	setters: []
			// },
			{
				object: wrappedWindow.Node.prototype,
				methods: ["appendChild", "insertBefore", "replaceChild"],
				getters: [],
				setters: []
			},
			{
				object: wrappedWindow.Element.prototype,
				methods: [
					"append", "prepend",
					"insertAdjacentElement", "insertAdjacentHTML", "insertAdjacentText",
					"replaceWith"
				],
				getters: [],
				setters: [
					"innerHTML",
					"outerHTML"
				]
			}
		].forEach(function(protectionDefinition){
			const object = protectionDefinition.object;
			protectionDefinition.methods.forEach(function(method){
				const descriptor = Object.getOwnPropertyDescriptor(object, method);
				const original = descriptor.value;
				changeProperty(object, method, "value", class {
					[method](){
						const value = arguments.length?
							original.call(this, ...arguments):
							original.call(this);
						allCallback();
						return value;
					}
				}.prototype[method]);
			});
			protectionDefinition.getters.forEach(function(property){
				const originalGetter = Object.getOwnPropertyDescriptor(object, property).get;
				const temp = {
					get [property](){
						// Same reason as in lib/modifiedDOMRectAPI.js: reading
						// `this[property]` would call this getter again.
						const ret = originalGetter.call(this);
						allCallback();
						return ret;
					}
				};
				changeProperty(object, property, "get",
					Object.getOwnPropertyDescriptor(temp, property).get
				);
			});
			protectionDefinition.setters.forEach(function(property){
				const descriptor = Object.getOwnPropertyDescriptor(object, property);
				const setter = descriptor.set;
				const temp = {
					set [property](value){
						const ret = setter.call(this, value);
						// const ret = this.${property} = value;
						allCallback();
						return ret;
					}
				};
				changeProperty(object, property, "set",
					Object.getOwnPropertyDescriptor(temp, property).set
				);
			});
		});
	}
	
	function enableMutationObserver({window, allCallback}){
		const observer = new MutationObserver(allCallback);
		let observing = false;
		function observe(){
			if (
				!observing &&
				window.document
			){
				observer.observe(window.document, {subtree: true, childList: true});
				observing = true;
			}
		}
		observe();
		window.document.addEventListener("DOMContentLoaded", function(){
			if (observing){
				observer.disconnect();
				observing = false;
			}
		});
		return observe;
	}
	
	function protectDocumentWrite({window, wrappedWindow, changeProperty, observe, allCallback}){
		const documentWriteDescriptorOnHTMLDocument = Object.getOwnPropertyDescriptor(
			wrappedWindow.HTMLDocument.prototype,
			"write"
		);
		const documentWriteDescriptor = documentWriteDescriptorOnHTMLDocument || Object.getOwnPropertyDescriptor(
			wrappedWindow.Document.prototype,
			"write"
		);
		const documentWrite = documentWriteDescriptor.value;
		changeProperty(
			documentWriteDescriptorOnHTMLDocument?
				wrappedWindow.HTMLDocument.prototype:
				wrappedWindow.Document.prototype,
			"write", "value", function write(markup){
				for (let i = 0, l = arguments.length; i < l; i += 1){
					const str = "" + arguments[i];
					// weird problem with waterfox and google docs
					const parts = (
						str.match(/^\s*<!doctype/i) &&
						!str.match(/frame/i)
					)? [str]: str.split(/(?=<)/);
					const length = parts.length;
					const scripts = window.document.getElementsByTagName("script");
					for (let i = 0; i < length; i += 1){
						documentWrite.call(this, parts[i]);
						allCallback();
						if (scripts.length && scripts[scripts.length - 1].src){
							observe();
						}
					}
				}
			}
		);
		
		const documentWritelnDescriptorOnHTMLDocument = Object.getOwnPropertyDescriptor(
			wrappedWindow.HTMLDocument.prototype,
			"writeln"
		);
		const documentWritelnDescriptor = documentWritelnDescriptorOnHTMLDocument || Object.getOwnPropertyDescriptor(
			wrappedWindow.Document.prototype,
			"writeln"
		);
		const documentWriteln = documentWritelnDescriptor.value;
		changeProperty(
			documentWritelnDescriptorOnHTMLDocument?
				wrappedWindow.HTMLDocument.prototype:
				wrappedWindow.Document.prototype,
			"writeln", "value", function writeln(markup){
				for (let i = 0, l = arguments.length; i < l; i += 1){
					const str = "" + arguments[i];
					const parts = str.split(/(?=<)/);
					const length = parts.length;
					const scripts = window.document.getElementsByTagName("script");
					for (let i = 0; i < length; i += 1){
						documentWrite.call(this, parts[i]);
						allCallback();
						if (scripts.length && scripts[scripts.length - 1].src){
							observe();
						}
					}
				}
				documentWriteln.call(this, "");
			}
		);
	}
	
	function protectWindowOpen({window, wrappedWindow, changeProperty, singleCallback}){
		const windowOpenDescriptor = Object.getOwnPropertyDescriptor(
			wrappedWindow,
			"open"
		);
		const windowOpen = windowOpenDescriptor.value;
		const getDocument = Object.getOwnPropertyDescriptor(
			window,
			"document"
		).get;
		changeProperty(
			wrappedWindow,
			"open", "value", function open(){
				const newWindow = arguments.length?
					windowOpen.call(this, ...arguments):
					windowOpen.call(this);
				if (newWindow){
					// if we use windowOpen from the normal window we see some SOP errors
					// BUT we need the unwrapped window...
					singleCallback(getDocument.call(newWindow).defaultView);
				}
				return newWindow;
			}
		);
	}
	
	scope.protect = function protect(window, wrappedWindow, singleCallback, allCallback){
		const changeProperty = createChangeProperty(window);
		
		if (!changeProperty){
			return;
		}
		
		const api = {window, wrappedWindow, changeProperty, singleCallback, allCallback};
		
		protectFrameProperties(api);
		
		protectDOMModifications(api);
		
		// MutationObserver to intercept iFrames while generating the DOM.
		api.observe = enableMutationObserver(api);
		
		// MutationObserver does not trigger fast enough when document.write is used
		protectDocumentWrite(api);
		
		protectWindowOpen(api);
	};
}());
;

/* ===== lib/frame.js ===== */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
(function(require){
	"use strict";
	
	const settings = require("./settings");
	const {preIntercept: intercept, callAsExtension} = require("./intercept");
	const {ask} = require("./askForPermission");
	const {sha256String: hashing} = require("./hash");
	const {check: originalCheck, checkStack: originalCheckStack} = require("./check");
	const extension = require("./extension");
	const iframeProtection = require("./iframeProtection");
	
	const logging = require("./logging");
	logging.setPrefix("frame script");
	
	// Variable to "unload" the script
	let enabled = true;
	
	logging.message("starting", location.href);
	
	function check(message){
		if (enabled){
			return originalCheck(message);
		}
		else {
			return {type: [], mode: "allow"};
		}
	}
	function checkStack(stack){
		if (enabled){
			return originalCheckStack(stack);
		}
		else {
			return true;
		}
	}
	function askWrapper(data){
		// The dialog draws the canvas that is being asked about, so CanvasBlocker
		// itself hits a protected API here.
		return callAsExtension(function(){
			return ask(data, {
				_: extension.getTranslation,
				prefs
			});
		});
	}
	
	let extensionSecret;
	function computeExtensionSecret(){
		function hashString(string){
			return hashing(new Uint16Array(
				string.split("").map(function(c){
					return c.charCodeAt(0);
				})
			));
		}
		const now = new Date();
		const lastTenMinutes = Math.floor(now.getMinutes() / 10) * 10;
		const nextRun = new Date(
			now.getFullYear(), now.getMonth(), now.getDate(),
			now.getHours(), lastTenMinutes + 10, 0, 0
		);
		window.setTimeout(
			computeExtensionSecret,
			nextRun .getTime() - now.getTime()
		);
		
		let string =
			extension.extensionID +
			`${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()} ${now.getHours()}:${lastTenMinutes}`;
		extensionSecret = [hashString("input" + string), hashString(string + "output")];
	}
	computeExtensionSecret();
	
	logging.message("open port to background script");
	const port = browser.runtime.connect();
	if (window === window.top){
		logging.message("Is top level window -> tab had navigation -> clear page action");
		port.postMessage({"canvasBlocker-clear-page-action": true});
	}
	let tabId;
	port.onMessage.addListener(function(data){
		logging.message("Got data from port", data);
		if (data.hasOwnProperty("tabId")){
			logging.notice("my tab id is", data.tabId);
			tabId = data.tabId;
		}
		if (data.hasOwnProperty("cookieStoreId")){
			logging.notice("my tab cookie store id is", data.cookieStoreId);
			const {persistent: persistentRnd} = require("./randomSupplies");
			persistentRnd.setCookieStoreId(data.cookieStoreId);
			const modifiedNavigatorAPI = require("./modifiedNavigatorAPI");
			modifiedNavigatorAPI.setCookieStoreId(data.cookieStoreId);
		}
		const persistentRndName = "persistent" + (extension.inIncognitoContext? "Incognito": "") + "Rnd";
		if (data.hasOwnProperty(persistentRndName)){
			const persistentRndValue = data[persistentRndName];
			logging.notice("got persistent random data", persistentRndValue);
			const {persistent: persistentRnd} = require("./randomSupplies");
			Object.keys(persistentRndValue).forEach(function(domain){
				logging.verbose("random data for", domain, persistentRndValue[domain]);
				persistentRnd.setDomainRnd(domain, persistentRndValue[domain]);
			});
		}
	});
	const notifications = [];
	const notificationCounter = {};
	const sentAPIs = {};
	function notify(data){
		if (!settings.ignoredAPIs[data.api]){
			if (settings.storeNotificationData){
				notifications.push(data);
			}
			if (!notificationCounter[data.messageId]){
				notificationCounter[data.messageId] = {
					count: 0,
					api: data.api
				};
			}
			notificationCounter[data.messageId].count += 1;
			if (!sentAPIs[data.api]){
				sentAPIs[data.api] = true;
				port.postMessage({"canvasBlocker-notify": data});
			}
		}
	}
	
	function prefs(...args){
		return settings.get(...args);
	}
	
	const interceptedWindows = new WeakMap();
	function interceptWindow(window){
		let wrappedTry;
		try {
			const href = window.location.href;
			wrappedTry = extension.getWrapped(window);
		}
		catch (error){
			// we are unable to read the location due to SOP
			// therefore we also can not intercept anything.
			logging.notice("NOT intercepting window due to SOP", window);
			return false;
		}
		const wrappedWindow = wrappedTry;
		
		if (!enabled || interceptedWindows.get(wrappedWindow)){
			return false;
		}
		const canvasBlockerData = wrappedWindow.matchMedia(extensionSecret[0]);
		if (canvasBlockerData.secret === extensionSecret[1]){
			if (wrappedWindow.top === wrappedWindow){
				canvasBlockerData.undoIntercept(extension.extensionID);
			}
			else {
				interceptedWindows.set(wrappedWindow, true);
				return false;
			}
		}
		
		logging.message("intercepting window", window);
		intercept(
			{subject: window},
			{check, checkStack, ask: askWrapper, notify, prefs}
		);
		logging.message("prepare to intercept (i)frames.");
		
		function interceptAllFrames(){
			const currentLength = window.length;
			for (let i = currentLength; i--;){
				if (!interceptedWindows.get(wrappedWindow[i])){
					interceptWindow(window[i]);
				}
			}
		}
		iframeProtection.protect(window, wrappedWindow, interceptWindow, interceptAllFrames);
		
		const matchMediaDescriptor = Object.getOwnPropertyDescriptor(wrappedWindow, "matchMedia");
		const originalMatchMedia = matchMediaDescriptor.value;
		extension.changeProperty(window, "matchMedia", {
			object: wrappedWindow,
			name: "matchMedia",
			type: "value",
			changed: extension.exportFunctionWithName(function matchMedia(query){
				if (query === extensionSecret[0]){
					return {
						secret: extensionSecret[1],
						undoIntercept: function(token){
							if (token === extension.extensionID){
								extension.revertProperties(window);
							}
						}
					};
				}
				else {
					return arguments.length > 1?
						originalMatchMedia.call(this, ...arguments):
						originalMatchMedia.call(this, query);
				}
			}, window, originalMatchMedia.name)
		});
		
		interceptedWindows.set(wrappedWindow, true);
		return true;
	}
	
	logging.message("register listener for messages from background script");
	extension.message.on(function(data){
		if (data["canvasBlocker-unload"]){
			extension.revertProperties(window);
			for (let frameIndex = 0; frameIndex < window.length; frameIndex += 1){
				extension.revertProperties(window[frameIndex]);
			}
			enabled = false;
		}
		if (
			data.hasOwnProperty("canvasBlocker-sendNotifications") &&
			data["canvasBlocker-sendNotifications"] === tabId
		){
			logging.notice("sending notifications:", notifications);
			extension.message.send({
				sender: tabId,
				url: window.location.href,
				"canvasBlocker-notificationCounter": notificationCounter,
				"canvasBlocker-notifications": notifications
			});
			logging.notice("notifications sent");
		}
	});
	
	interceptWindow(window);
}(require));
;

}());
