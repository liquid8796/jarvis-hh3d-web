/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/*
 * Chrome port of the User-Agent part of lib/navigator.js.
 *
 * Firefox rewrote the header per request inside a blocking webRequest listener.
 * Manifest V3 has no blocking webRequest, so the same job is done with a static
 * declarativeNetRequest rule that is rebuilt whenever the relevant settings
 * change.
 *
 * Two consequences of that trade are documented here because they are visible
 * to the user:
 *   - A "{random}" placeholder in the User-Agent template is resolved once per
 *     rule build instead of once per request.
 *   - Whitelist entries that are regular expressions cannot be turned into a
 *     DNR condition. They keep working for the JavaScript level protection;
 *     only the HTTP header is unaffected by them. dnrRules logs which ones.
 */
(function(){
	"use strict";

	let scope;
	if ((typeof exports) !== "undefined"){
		scope = exports;
	}
	else {
		scope = require.register("./navigatorHeaders", {});
	}

	const settings = require("./settings");
	const settingContainers = require("./settingContainers");
	const logging = require("./logging");
	const lists = require("./lists");
	const navigator = require("./navigator");
	const dnrRules = require("./dnrRules");

	const range = dnrRules.ranges.navigatorHeaders;

	function isFeatureEnabled(){
		const protectedAPIFeatures = settings.protectedAPIFeatures;
		return !protectedAPIFeatures.hasOwnProperty("userAgent @ navigator") ||
			!!protectedAPIFeatures["userAgent @ navigator"];
	}

	function isAllowMode(blockMode){
		return (typeof blockMode) === "string" && blockMode.startsWith("allow");
	}

	function buildRules(){
		if (!isFeatureEnabled()){
			logging.verbose("User-Agent protection disabled via protectedAPIFeatures.");
			return [];
		}

		// No contextual identities in Chrome - always the default set.
		const userAgent = navigator.getNavigatorValue("userAgent", function(){
			return "";
		});
		if ((typeof userAgent) !== "string" || !userAgent.length){
			logging.verbose("No User-Agent replacement configured.");
			return [];
		}

		const urlEntries = settingContainers.urlContainer.get();
		const globallyActive = !!settings.protectNavigator && !isAllowMode(settings.get("blockMode"));

		let condition;
		if (globallyActive){
			const off = lists.get("white").map(function(entry){
				return entry.value;
			});
			urlEntries.forEach(function(entry){
				const disabled =
					(entry.hasOwnProperty("protectNavigator") && !entry.protectNavigator) ||
					isAllowMode(entry.blockMode);
				if (disabled){
					off.push(entry.url);
				}
			});
			const excludedRequestDomains = dnrRules.toDomainList(off, "User-Agent exception");
			condition = {resourceTypes: dnrRules.allResourceTypes()};
			if (excludedRequestDomains.length){
				condition.excludedRequestDomains = excludedRequestDomains;
			}
		}
		else {
			const on = [];
			urlEntries.forEach(function(entry){
				if (
					entry.hasOwnProperty("protectNavigator") &&
					entry.protectNavigator &&
					!isAllowMode(entry.blockMode)
				){
					on.push(entry.url);
				}
			});
			const requestDomains = dnrRules.toDomainList(on, "User-Agent per site");
			if (!requestDomains.length){
				return [];
			}
			condition = {
				resourceTypes: dnrRules.allResourceTypes(),
				requestDomains: requestDomains
			};
		}

		return [{
			id: range.first,
			priority: 1,
			action: {
				type: "modifyHeaders",
				requestHeaders: [{
					header: "user-agent",
					operation: "set",
					value: userAgent
				}]
			},
			condition: condition
		}];
	}

	let pending = Promise.resolve();
	function update(){
		// Serialise: updateDynamicRules calls that overlap can interleave their
		// remove and add steps and leave the wrong rule installed.
		pending = pending.then(function(){
			const rules = buildRules();
			logging.message("Updating User-Agent header rules:", rules.length, "rule(s).");
			return dnrRules.apply(range, rules);
		}).catch(function(error){
			logging.error("Unable to update the User-Agent header rules", error);
		});
		return pending;
	}

	scope.update = update;
	scope.init = function init(){
		settings.onloaded(update);
		settings.on([
			"protectNavigator",
			"navigatorDetails",
			"protectedAPIFeatures",
			"blockMode",
			"whiteList",
			"sessionWhiteList"
		], update);
		settingContainers.urlContainer.on(update);
	};
}());
