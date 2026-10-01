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
