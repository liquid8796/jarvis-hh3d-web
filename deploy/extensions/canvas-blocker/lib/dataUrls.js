/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/*
 * Chrome port of the data-URL protection.
 *
 * A document loaded from a data: URL gets an opaque origin, so the surrounding
 * page cannot reach into it - but a script inside it can fingerprint freely and
 * post the result back out. Firefox closed that hole with a blocking
 * webRequest listener that appended a Content-Security-Policy header.
 *
 * Manifest V3 has no blocking webRequest; the same header is appended with a
 * declarativeNetRequest rule instead. Appending (rather than setting) keeps a
 * CSP the site sends itself intact - the browser enforces every policy it
 * receives, so the two combine rather than replace each other.
 *
 * Independently of this setting the protection now also reaches into data:,
 * blob: and about: frames directly, because the content scripts are registered
 * with "match_origin_as_fallback".
 */
(function(){
	"use strict";

	let scope;
	if ((typeof exports) !== "undefined"){
		scope = exports;
	}
	else {
		scope = require.register("./dataUrls", {});
	}

	const logging = require("./logging");
	const settings = require("./settings");
	const settingContainers = require("./settingContainers");
	const dnrRules = require("./dnrRules");

	const range = dnrRules.ranges.dataUrls;

	// Everything but data: - blob: and filesystem: documents do get the content
	// scripts, "*" covers the regular network schemes.
	const CSP_SOURCES = "blob: filesystem: *";
	const CSP_VALUE = `object-src ${CSP_SOURCES}; frame-src ${CSP_SOURCES}`;
	const RESOURCE_TYPES = ["main_frame", "sub_frame", "object"];

	function buildRules(){
		const urlEntries = settingContainers.urlContainer.get();

		if (settings.blockDataURLs){
			const off = [];
			urlEntries.forEach(function(entry){
				if (entry.hasOwnProperty("blockDataURLs") && !entry.blockDataURLs){
					off.push(entry.url);
				}
			});
			const excludedRequestDomains = dnrRules.toDomainList(off, "data-URL exception");
			const condition = {resourceTypes: RESOURCE_TYPES};
			if (excludedRequestDomains.length){
				condition.excludedRequestDomains = excludedRequestDomains;
			}
			return [makeRule(condition)];
		}

		const on = [];
		urlEntries.forEach(function(entry){
			if (entry.hasOwnProperty("blockDataURLs") && entry.blockDataURLs){
				on.push(entry.url);
			}
		});
		const requestDomains = dnrRules.toDomainList(on, "data-URL per site");
		if (!requestDomains.length){
			return [];
		}
		return [makeRule({
			resourceTypes: RESOURCE_TYPES,
			requestDomains: requestDomains
		})];
	}

	function makeRule(condition){
		return {
			id: range.first,
			priority: 1,
			action: {
				type: "modifyHeaders",
				responseHeaders: [{
					header: "content-security-policy",
					operation: "append",
					value: CSP_VALUE
				}]
			},
			condition: condition
		};
	}

	let pending = Promise.resolve();
	function update(){
		// Serialise so overlapping updates cannot interleave remove and add.
		pending = pending.then(async function(){
			const rules = buildRules();
			logging.message("Updating data-URL CSP rules:", rules.length, "rule(s).");
			const applied = await dnrRules.apply(range, rules);
			if (!applied && rules.length){
				logging.error(
					"The data-URL protection could not be installed. " +
					"This browser does not allow appending a Content-Security-Policy " +
					"response header through declarativeNetRequest."
				);
			}
			return applied;
		}).catch(function(error){
			logging.error("Unable to update the data-URL CSP rules", error);
		});
		return pending;
	}

	scope.update = update;
	scope.init = function init(){
		settings.onloaded(update);
		settings.on("blockDataURLs", update);
		settingContainers.urlContainer.on(update);
	};
}());
