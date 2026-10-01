/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/*
 * Chrome port helper.
 *
 * Manifest V3 removed blocking webRequest, so the two features that used it -
 * the User-Agent header rewrite and the data-URL CSP - are expressed as
 * declarativeNetRequest rules instead. This module owns the plumbing that both
 * of them share: reserved rule id ranges, resource type discovery and the
 * translation of CanvasBlocker's list entries into DNR domain conditions.
 */
(function(){
	"use strict";

	let scope;
	if ((typeof exports) !== "undefined"){
		scope = exports;
	}
	else {
		scope = require.register("./dnrRules", {});
	}

	const logging = require("./logging");

	/**
	 * Every feature gets its own contiguous id block. `apply` clears the whole
	 * block before installing the new rules, so a feature can never leave
	 * stale rules behind.
	 */
	scope.ranges = {
		navigatorHeaders: {first: 4001, last: 4099},
		dataUrls: {first: 4101, last: 4199}
	};

	/**
	 * Resource types the running browser actually knows. Passing an unknown one
	 * makes updateDynamicRules reject the whole call.
	 * Note the explicit list matters: a rule that omits `resourceTypes` does not
	 * match main_frame requests.
	 */
	scope.allResourceTypes = function allResourceTypes(){
		const types = browser.declarativeNetRequest && browser.declarativeNetRequest.ResourceType;
		if (types){
			return Object.keys(types).map(function(key){
				return types[key];
			});
		}
		return [
			"main_frame", "sub_frame", "stylesheet", "script", "image", "font",
			"object", "xmlhttprequest", "ping", "csp_report", "media",
			"websocket", "other"
		];
	};

	/**
	 * CanvasBlocker list entries may be regular expressions. Only literal
	 * domains can be mapped onto a DNR domain condition - the rest is reported
	 * to the log so the limitation is visible instead of silent.
	 */
	const plainDomain = /^[A-Za-z0-9_.-]+$/;
	scope.toDomainList = function toDomainList(entries, context){
		const domains = [];
		const unsupported = [];
		entries.forEach(function(entry){
			const value = (entry || "").replace(/^\s+|\s+$/g, "").toLowerCase();
			if (!value){
				return;
			}
			if (plainDomain.test(value)){
				domains.push(value);
			}
			else {
				unsupported.push(value);
			}
		});
		if (unsupported.length){
			logging.warning(
				"Chrome's declarativeNetRequest cannot express these",
				context,
				"entries as HTTP level rules:",
				unsupported.join(", ")
			);
		}
		return domains;
	};

	/**
	 * Replaces every rule of one feature in a single atomic update.
	 * Returns true when the rules are in place.
	 */
	scope.apply = async function applyRules(range, rules){
		const removeRuleIds = [];
		for (let id = range.first; id <= range.last; id += 1){
			removeRuleIds.push(id);
		}
		try {
			await browser.declarativeNetRequest.updateDynamicRules({
				removeRuleIds: removeRuleIds,
				addRules: rules
			});
			logging.verbose("Installed", rules.length, "dynamic rule(s) for ids", range.first, "-", range.last);
			return true;
		}
		catch (error){
			logging.error("Unable to update the dynamic rules", rules, error);
			// Leave nothing half applied.
			try {
				await browser.declarativeNetRequest.updateDynamicRules({removeRuleIds: removeRuleIds});
			}
			catch (cleanupError){
				logging.error("Unable to clean up the dynamic rules", cleanupError);
			}
			return false;
		}
	};
}());
