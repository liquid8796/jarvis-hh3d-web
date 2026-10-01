/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/*
 * Makes the translation files acceptable to Chrome.
 *
 * Firefox allows any string as a message name. Chrome restricts them to
 * [A-Za-z0-9_] and rejects the whole extension otherwise - 97 of CanvasBlocker's
 * names contain ".", "-" or "%", mostly the "<setting>_options.<value>" family.
 *
 * Every illegal character is replaced by "_". lib/extension.js applies the exact
 * same transformation in getTranslation(), so ids built at runtime - such as
 * `setting.name + "_options." + value` in options/optionsGui.js - keep resolving
 * without touching any of the call sites.
 *
 * The script is idempotent: running it on already converted files is a no-op.
 *
 * Run with:  node build/locales.js
 */
"use strict";

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const localesDirectory = path.join(root, "_locales");

/** Keep in sync with sanitizeMessageName() in lib/extension.js. */
function sanitizeMessageName(name){
	return name.replace(/[^A-Za-z0-9_]/g, "_");
}

function convert(file){
	const original = fs.readFileSync(file, "utf8");
	const messages = JSON.parse(original);
	const converted = {};
	let renamed = 0;

	Object.keys(messages).forEach(function(name){
		const safeName = sanitizeMessageName(name);
		if (Object.prototype.hasOwnProperty.call(converted, safeName)){
			throw new Error(
				`Name collision in ${file}: "${name}" and another key both map to "${safeName}"`
			);
		}
		if (safeName !== name){
			renamed += 1;
		}
		converted[safeName] = messages[name];
	});

	const output = JSON.stringify(converted, null, 2) + "\n";
	if (output !== original){
		fs.writeFileSync(file, output, "utf8");
	}
	return {renamed, total: Object.keys(converted).length};
}

function main(){
	const locales = fs.readdirSync(localesDirectory).filter(function(entry){
		return fs.statSync(path.join(localesDirectory, entry)).isDirectory();
	});
	if (!locales.length){
		throw new Error("No locales found in " + localesDirectory);
	}
	let totalRenamed = 0;
	locales.forEach(function(locale){
		const file = path.join(localesDirectory, locale, "messages.json");
		if (!fs.existsSync(file)){
			console.warn(`warning: ${locale} has no messages.json`);
			return;
		}
		const {renamed, total} = convert(file);
		totalRenamed += renamed;
		console.log(`  ${locale}: ${renamed} of ${total} names converted`);
	});
	console.log(`${locales.length} locale(s) processed, ${totalRenamed} name(s) converted in total`);
}

main();
