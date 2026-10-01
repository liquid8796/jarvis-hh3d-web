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