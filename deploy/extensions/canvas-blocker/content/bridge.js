/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/*
 * Chrome port - isolated world half of the content script.
 *
 * Firefox ran the whole protection inside the content script sandbox and
 * reached into the page through Xray wrappers. Chrome has no equivalent, so the
 * protection itself runs in the page's MAIN world (content/injected.js) where
 * no extension API exists. This file is its counterpart: it lives in the
 * isolated world, owns the `chrome.*` access and relays everything the page
 * side needs.
 *
 * Transport: CustomEvents on `document` under a per-document random name. The
 * name is exchanged through an attribute on <html> that whichever half runs
 * first writes and the other one consumes - both are document_start content
 * scripts, so the attribute is gone long before any page script can look at it.
 * Payloads are JSON strings, which cross the world boundary unchanged.
 */
(function(){
	"use strict";

	const HANDSHAKE_ATTRIBUTE = "data-canvasblocker-channel";
	const root = document.documentElement;

	function createToken(){
		const buffer = new Uint8Array(16);
		crypto.getRandomValues(buffer);
		return Array.prototype.map.call(buffer, function(byte){
			return byte.toString(16).padStart(2, "0");
		}).join("");
	}

	let token;
	let handshake = null;
	if (root){
		const existing = root.getAttribute(HANDSHAKE_ATTRIBUTE);
		if (existing){
			// The page world half got here first.
			root.removeAttribute(HANDSHAKE_ATTRIBUTE);
			try {
				handshake = JSON.parse(existing);
			}
			catch (error){
				handshake = null;
			}
		}
	}
	if (handshake && handshake.t){
		token = handshake.t;
	}
	else {
		token = createToken();
		if (root){
			root.setAttribute(HANDSHAKE_ATTRIBUTE, JSON.stringify({
				t: token,
				u: chrome.runtime.getURL(""),
				i: !!chrome.extension.inIncognitoContext
			}));
		}
	}

	const TO_PAGE = token + "-i";
	const FROM_PAGE = token + "-o";

	// Declared up here because the FROM_PAGE listener below replays them.
	let initMessage = null;
	let settingsMessage = null;

	function send(message){
		if (!message){
			return;
		}
		document.dispatchEvent(new CustomEvent(TO_PAGE, {
			detail: JSON.stringify(message)
		}));
	}

	/* ------------------------------------------------------------------ i18n */

	// build/bundle.js writes content/messageKeys.js, which declares this global
	// in the shared isolated world scope. Only the strings the page side can
	// actually display are collected - `getMessage` is synchronous over there,
	// so the values have to be shipped up front.
	function collectMessages(){
		const messages = {};
		const keys = (typeof canvasBlockerMessageKeys) !== "undefined"? canvasBlockerMessageKeys: [];
		keys.forEach(function(key){
			const message = chrome.i18n.getMessage(key);
			if (message){
				messages[key] = message;
			}
		});
		return messages;
	}

	/* --------------------------------------------------------------- port */

	let port = null;
	// Set once the extension context is gone for good (reload / uninstall);
	// retrying after that would only produce noise in the console.
	let portUnavailable = false;
	const pendingPortMessages = [];

	function flushPortMessages(){
		while (port && pendingPortMessages.length){
			const data = pendingPortMessages.shift();
			try {
				port.postMessage(data);
			}
			catch (error){
				// The worker went away between the check and the call - keep the
				// message and reconnect on the next attempt.
				pendingPortMessages.unshift(data);
				port = null;
				return;
			}
		}
	}

	function connectPort(){
		if (port || portUnavailable){
			return;
		}
		try {
			port = chrome.runtime.connect();
		}
		catch (error){
			portUnavailable = true;
			return;
		}
		port.onMessage.addListener(function(data){
			send({type: "portMessage", data: data});
		});
		port.onDisconnect.addListener(function(){
			// A manifest V3 service worker drops long lived ports after a few
			// minutes of idling. Reconnecting eagerly would keep the worker
			// alive forever, so the port is re-established lazily - on the next
			// message the page side actually wants to send.
			port = null;
		});
		flushPortMessages();
	}

	function postToPort(data){
		pendingPortMessages.push(data);
		connectPort();
		flushPortMessages();
	}

	/* ------------------------------------------------------- page -> bridge */

	document.addEventListener(FROM_PAGE, function(event){
		let message;
		try {
			message = JSON.parse(event.detail);
		}
		catch (error){
			return;
		}
		switch (message.type){
			case "ready":
				// The page half attached its listener after we opened. Repeat
				// what it missed - whichever half is injected second needs this.
				send(initMessage);
				if (settingsMessage){
					send(settingsMessage);
				}
				break;
			case "portMessage":
				postToPort(message.data);
				break;
			case "runtimeMessage":
				Promise.resolve(chrome.runtime.sendMessage(message.data)).catch(function(){
					// Nothing listening (no options page open) - not an error.
				});
				break;
			case "storageSet":
				respond(message.id, chrome.storage.local.set(message.data));
				break;
			case "storageRemove":
				respond(message.id, chrome.storage.local.remove(message.key));
				break;
			default:
				// Unknown message - ignore rather than throw into the page.
				break;
		}
	}, false);

	function respond(id, promise){
		if (id === undefined){
			return;
		}
		Promise.resolve(promise).then(function(){
			send({type: "reply", id: id});
		}, function(error){
			send({type: "reply", id: id, error: String(error && error.message || error)});
		});
	}

	/* ------------------------------------------------------- bridge -> page */

	chrome.runtime.onMessage.addListener(function(data){
		send({type: "runtimeMessage", data: data});
		return false;
	});

	chrome.storage.onChanged.addListener(function(changes, area){
		send({type: "storageChanged", changes: changes, area: area});
	});

	// Kick everything off. The settings arrive asynchronously - until then the
	// page side keeps the protected APIs pre-intercepted.
	initMessage = {
		type: "init",
		url: chrome.runtime.getURL(""),
		incognito: !!chrome.extension.inIncognitoContext,
		messages: collectMessages()
	};
	send(initMessage);

	chrome.storage.local.get(null).then(function(storage){
		settingsMessage = {type: "settings", data: storage};
		send(settingsMessage);
	}, function(error){
		// Without settings the page side would stay pre-intercepted forever,
		// which breaks the site. Fall back to the built in defaults.
		console.error("[CanvasBlocker] unable to read the settings", error);
		settingsMessage = {type: "settings", data: {}};
		send(settingsMessage);
	});

	connectPort();
}());
