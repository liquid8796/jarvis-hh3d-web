/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/*
 * Manifest V3 service worker entry point.
 *
 * The Firefox manifest listed the background scripts and let the browser load
 * them in order. A service worker has to do that itself; importScripts() is
 * synchronous and shares the global scope, so the module order below is the
 * same one the original manifest used - only browserShim (which maps
 * `browser.*` onto `chrome.*`) and the two declarativeNetRequest modules are
 * new.
 *
 * Loading synchronously matters beyond ordering: lib/main.js registers the
 * runtime listeners at the top level, and a service worker only receives the
 * event that woke it if the listener existed in its first event loop turn.
 */
importScripts(
	"/lib/browserShim.js",
	"/lib/require.js",
	"/lib/logging.js",
	"/lib/extension.js",
	"/lib/settingDefinitions.js",
	"/lib/settingContainers.js",
	"/lib/settingsMigration.js",
	"/lib/settings.js",
	"/lib/lists.js",
	"/lib/persistentRndStorage.js",
	"/lib/callingStack.js",
	"/lib/check.js",
	"/lib/dnrRules.js",
	"/lib/dataUrls.js",
	"/lib/notification.js",
	"/lib/navigator.js",
	"/lib/navigatorHeaders.js",
	"/lib/mobile.js",
	"/lib/main.js"
);
