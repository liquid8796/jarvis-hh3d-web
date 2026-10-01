/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/*
 * Chrome port of the background script.
 *
 * Two structural differences to the Firefox original:
 *
 * 1. There is no persistent background page. A manifest V3 service worker is
 *    started on demand and torn down again, and it only receives an event if
 *    the matching listener was registered during the very first turn of its
 *    event loop. Every runtime listener is therefore registered synchronously
 *    at the top level and defers its work until the settings have loaded.
 *
 * 2. browser.contentScripts.register() does not exist. Firefox used it to bake
 *    the current settings into a document_start content script so the page
 *    world had them synchronously. Chrome's content scripts read the settings
 *    from storage through content/bridge.js instead; until they arrive the
 *    protected APIs stay pre-intercepted (see lib/intercept.js).
 */
(function(){
	"use strict";

	const settings = require("./settings");
	const logging = require("./logging");
	logging.setPrefix("main script");
	const persistentRndStorage = require("./persistentRndStorage");
	const notification = require("./notification");
	const mobile = require("./mobile");
	const extension = require("./extension");

	logging.message("start of background script");

	function sendToTab(tabId, data){
		// Tabs without a content script reject - that is normal.
		return Promise.resolve(browser.tabs.sendMessage(tabId, data)).catch(function(error){
			logging.verbose("Unable to reach tab", tabId, error);
		});
	}

	async function broadcast(data){
		logging.notice("pass the message to the tabs");
		const tabs = await browser.tabs.query({});
		await Promise.all(tabs.map(function(tab){
			return sendToTab(tab.id, data);
		}));
	}

	logging.message("register non port message listener");
	browser.runtime.onMessage.addListener(function(data, sender, sendResponse){
		logging.notice("got data without port", data);
		const keys = Object.keys(data);
		let handledCompletely = false;

		if (data["canvasBlocker-new-domain-rnd"]){
			persistentRndStorage.setDomainData(
				data["canvasBlocker-new-domain-rnd"].domain,
				data["canvasBlocker-new-domain-rnd"].incognito,
				data["canvasBlocker-new-domain-rnd"].rnd
			);
			handledCompletely = handledCompletely || keys.length === 1;
		}
		if (data["canvasBlocker-clear-domain-rnd"]){
			persistentRndStorage.clear(data["canvasBlocker-clear-domain-rnd"] === "force");
			handledCompletely = handledCompletely || keys.length === 1;
		}
		if (data["canvasBlocker-clear-container-rnd"]){
			persistentRndStorage.clearContainerData(data["canvasBlocker-clear-container-rnd"]);
			handledCompletely = handledCompletely || keys.length === 1;
		}
		if (!handledCompletely){
			broadcast(data);
		}
		// No asynchronous response - do not keep the message channel open.
		return false;
	});

	logging.message("register port listener");
	browser.runtime.onConnect.addListener(function(port){
		logging.notice("got port", port);
		if (!port.sender || !port.sender.tab){
			logging.notice("got port without tab:", port);
			return;
		}
		const tabId = port.sender.tab.id;
		const url = new URL(port.sender.url);

		port.onMessage.addListener(function(data){
			logging.verbose("got data", data, "from port", port);
			settings.onloaded(function(){
				if (data.hasOwnProperty("canvasBlocker-notify")){
					notification.show(tabId, url, data["canvasBlocker-notify"].api);
				}
				if (data.hasOwnProperty("canvasBlocker-clear-page-action")){
					notification.hide(tabId, url);
				}
			});
		});

		// The persistent random data is only complete once the settings are in.
		settings.onloaded(function(){
			logging.verbose("send back the tab id", tabId);
			logging.verbose("send back the persistent random seeds", persistentRndStorage.persistentRnd);
			try {
				port.postMessage({
					tabId: tabId,
					// Chrome has no contextual identities (Firefox containers).
					cookieStoreId: "",
					persistentRnd: persistentRndStorage.persistentRnd,
					persistentIncognitoRnd: persistentRndStorage.persistentIncognitoRnd
				});
			}
			catch (error){
				logging.verbose("Port already closed:", error);
			}
		});
	});

	logging.message("register alarm listener");
	browser.alarms.onAlarm.addListener(function(alarm){
		if (alarm.name === "canvasBlocker-clearPersistentRnd"){
			logging.message("persistent random data clearing alarm fired");
			settings.onloaded(function(){
				persistentRndStorage.onClearAlarm();
			});
		}
	});

	browser.runtime.onInstalled.addListener(function(details){
		function openOptions(reason){
			browser.tabs.create({
				url: extension.getURL("options/options.html?notice=" + reason)
			});
		}
		switch (details.reason){
			case "install":
				logging.message("CanvasBlocker installed");
				openOptions(details.reason);
				settings.onloaded(function(){
					if (settings.showPresetsOnInstallation){
						browser.tabs.create({
							url: extension.getURL("options/presets.html?notice=" + details.reason)
						});
					}
				});
				break;
			case "update":
				settings.onloaded(function(){
					if (!settings.dontShowOptionsOnUpdate){
						logging.message("CanvasBlocker updated");
						openOptions(details.reason);
					}
				});
		}

		// mobile default settings
		mobile.ifMobile(async function(){
			const storage = await browser.storage.local.get(null);
			mobile.applyMobileDefaults(storage);
		});
	});

	if (browser.runtime.onSuspend){
		browser.runtime.onSuspend.addListener(async function(){
			logging.message("Suspending CanvasBlocker");
			await broadcast({"canvasBlocker-unload": true});
		});
	}
	if (browser.runtime.onUpdateAvailable){
		browser.runtime.onUpdateAvailable.addListener(async function(details){
			logging.message("Update available", details);
			if (settings.disruptSessionOnUpdate){
				await broadcast({"canvasBlocker-unload": true});
				setTimeout(function(){
					logging.verbose("Reload extension after one second");
					browser.runtime.reload();
				}, 1000);
			}
			else {
				settings.updatePending = true;
			}
		});
	}

	logging.message("waiting for settings to be loaded");
	settings.onloaded(function(){
		logging.notice("everything loaded");

		logging.message("perform startup reset");
		settings.startupReset();

		persistentRndStorage.init();
	});

	logging.message("Initialize data-URL protection.");
	require("./dataUrls").init();

	logging.message("Initialize navigator HTTP header protection.");
	require("./navigatorHeaders").init();

	logging.message("end");
}());
