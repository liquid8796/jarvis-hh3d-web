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
		scope = require.register("./mobile", {});
	}
	
	const settings = require("./settings");
	const settingDefinitions = require("./settingDefinitions");
	
	scope.isMobile = async function isMobile(){
		// The Firefox version additionally treated a missing pageAction API as
		// "mobile". Chrome never has a pageAction (manifest V3 merged it into
		// `action`), so the platform is the only usable signal here.
		try {
			const platformInfo = await browser.runtime.getPlatformInfo();
			return !!(platformInfo && platformInfo.os === "android");
		}
		catch (error){
			return false;
		}
	};
	
	scope.ifMobile = async function ifMobile(ifCallback, elseCallback){
		const isMobile = await scope.isMobile();
		if (isMobile){
			return ifCallback();
		}
		else if (elseCallback){
			return elseCallback();
		}
		else {
			return false;
		}
	};
	
	scope.applyMobileDefaults = async function applyMobileDefaults(storage = false){
		await Promise.all(settingDefinitions.filter(function(definition){
			return definition.hasOwnProperty("mobileDefaultValue") && (
				!storage ||
				!storage.hasOwnProperty(definition.name)
			);
		}).map(function(definition){
			return settings.set(definition.name, definition.mobileDefaultValue);
		}));
	};
}());