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