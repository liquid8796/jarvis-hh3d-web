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
		scope = require.register("./notification", {});
	}
	
	const extension = require("./extension");
	const settings = require("./settings");
	const lists = require("./lists");
	const logging = require("./logging");
	
	function isWhitelisted(url){
		if (!(url instanceof URL)){
			url = new URL(url);
		}
		return lists.get("white").match(url) ||
			lists.get("sessionWhite").match(url) ||
			settings.get("blockMode", url).startsWith("allow");
	}
	
	function getBrowserActionIconName(tabData, notified){
		if (tabData.whitelisted){
			return "whitelisted";
		}
		else if (notified) {
			return settings.highlightBrowserAction;
		}
		else {
			return "none";
		}
	}
	
	// Chrome only accepts raster images for the toolbar icon - build/icons.js
	// renders the shipped SVGs into these PNGs.
	// The leading slash is required: setIcon resolves a relative path against
	// the calling script, and this module is loaded from background/, so
	// "icons/..." would be looked up as "background/icons/..." and silently
	// leave the icon unchanged.
	function iconSet(name){
		return {
			16: `/icons/png/${name}-16.png`,
			32: `/icons/png/${name}-32.png`,
			48: `/icons/png/${name}-48.png`
		};
	}
	const paths = {
		browserAction: {
			none: iconSet("browserAction-notPrinted"),
			color: iconSet("browserAction-printed"),
			blink: iconSet("browserAction-printedBlink"),
			whitelisted: iconSet("browserAction-whitelisted")
		}
	};

	/**
	 * Tabs close while these calls are in flight, and manifest V3 surfaces that
	 * as a rejected promise. It is expected, not an error.
	 */
	function forTab(promise){
		return Promise.resolve(promise).catch(function(error){
			logging.verbose("Tab action failed (tab most likely gone):", error);
		});
	}

	if (browser.browserAction.setBadgeBackgroundColor){
		forTab(browser.browserAction.setBadgeBackgroundColor({
			color: "rgba(255, 0, 0, 0.6)"
		}));
	}
	
	const tabsData = new Map();
	function getTabData(tabId){
		let data = tabsData.get(tabId);
		if (!data){
			data = {
				url: "",
				apis: new Set(),
				whitelisted: false
			};
			tabsData.set(tabId, data);
		}
		return data;
	}
	scope.show = function showNotification(tabId, url, api){
		if (settings.ignoredAPIs[api]){
			return;
		}
		logging.notice("Show notification for tab", tabId);
		const tabData = getTabData(tabId);
		// Chrome has no page action; the toolbar icon carries the notification.
		if (browser.browserAction.setIcon){
			forTab(browser.browserAction.setIcon({
				tabId: tabId,
				path: paths.browserAction[getBrowserActionIconName(tabData, true)]
			}));
		}
		
		const apis = tabData.apis;
		apis.add(api);
		if (
			settings.get("displayBadge", url) &&
			browser.browserAction.setBadgeText
		){
			forTab(browser.browserAction.setBadgeText({
				tabId: tabId,
				text: apis.size > 1? apis.size.toString(): api.charAt(0).toUpperCase()
			}));
		}
		
		let apiList = "";
		apis.forEach(function(api){
			apiList += extension.getTranslation("browserAction_title_protectedAPIs").replace(/{api}/g, api);
		});
		
		let browserActionTitle = extension.getTranslation("browserAction_title_default");
		if (tabData.whitelisted){
			browserActionTitle += extension.getTranslation("browserAction_title_whitelisted")
				.replace(/{url}/g, tabData.url);
		}
		browserActionTitle += extension.getTranslation("browserAction_title_notified");
		browserActionTitle += apiList;
		forTab(browser.browserAction.setTitle({
			tabId: tabId,
			title: browserActionTitle
		}));
	};
	
	scope.hide = function hideNotification(tabId, url){
		logging.notice("Hide page action for tab", tabId);
		// clear old data
		tabsData.delete(tabId);
		const tabData = getTabData(tabId);
		tabData.url = url;
		tabData.whitelisted = isWhitelisted(url);
		
		if (browser.browserAction.setIcon){
			forTab(browser.browserAction.setIcon({
				tabId: tabId,
				path: paths.browserAction[getBrowserActionIconName(tabData, false)]
			}));
		}
		if (browser.browserAction.setBadgeText){
			forTab(browser.browserAction.setBadgeText({
				tabId: tabId,
				text: ""
			}));
		}
		let browserActionTitle = extension.getTranslation("browserAction_title_default");
		if (tabData.whitelisted){
			browserActionTitle += extension.getTranslation("browserAction_title_whitelisted").replace(/{url}/g, url);
		}
		forTab(browser.browserAction.setTitle({
			tabId: tabId,
			title: browserActionTitle
		}));
	};
	
	settings.on("showNotifications", async function({newValue}){
		if (!newValue){
			logging.message("notifications were disabled -> reset all toolbar icons");
			const tabs = await browser.tabs.query({});
			tabs.forEach(function(tab){
				if (browser.browserAction.setIcon){
					forTab(browser.browserAction.setIcon({
						tabId: tab.id,
						path: paths.browserAction[getBrowserActionIconName(getTabData(tab.id), false)]
					}));
				}
			});
		}
	});
	
	browser.tabs.onRemoved.addListener(function(tabId){
		tabsData.delete(tabId);
	});
	settings.on("displayBadge", async function({newValue}){
		if (!newValue){
			logging.message("badge was disabled -> hide all badges");
			if (browser.browserAction.setBadgeText){
				const tabs = await browser.tabs.query({});
				tabs.forEach(function(tab){
					forTab(browser.browserAction.setBadgeText({
						tabId: tab.id,
						text: ""
					}));
				});
			}
		}
	});
}());