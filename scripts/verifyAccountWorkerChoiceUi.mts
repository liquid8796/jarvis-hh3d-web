#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AccountWorkerChoices } from "../src/app/dashboard/AccountWorkerChoices";

for (const value of ["default", "sect", "mine"] as const) {
  const html = renderToStaticMarkup(createElement(AccountWorkerChoices, {
    accountId: "sample-account", selected: value, disabled: false,
    onSelect: () => {},
  }));
  assert.equal((html.match(/type="checkbox"/g) ?? []).length, 3, "exactly three native checkboxes");
  assert.equal((html.match(/checked=""/g) ?? []).length, 1, "exactly one checked");
  const selectedInput = (html.match(/<input[^>]+>/g) ?? []).find(tag => tag.includes('value="' + value + '"'));
  assert(selectedInput?.includes('checked=""'), "selected checkbox " + value + " must be checked");
  assert.match(html, /Mặc định/);
  assert.match(html, /Khôi lỗi tông môn/);
  assert.match(html, /Máy nhà/);
  assert.match(html, /Chọn một nơi chạy cho tài khoản/);
  assert(!html.includes("<select"), "not a dropdown");
}
{
  const html = renderToStaticMarkup(createElement(AccountWorkerChoices, {
    accountId: "sample-account", selected: "mine", disabled: true, saving: true,
    onSelect: () => {},
  }));
  assert.match(html, /disabled=""/);
  assert.match(html, /Đang lưu/);
  assert.match(html, /aria-busy="true"/);
}
const source = readFileSync(new URL("../src/app/dashboard/AccountManager.tsx", import.meta.url), "utf8");
const inline = source.indexOf("<AccountWorkerAssignment account={account}");
const editor = source.indexOf("{editing && (");
assert(inline > 0 && editor > inline, "inline checkboxes must render OUTSIDE collapsed editor");
assert(!source.includes('id={' + String.fromCharCode(96) + 'account-worker-'), "old edit-only dropdown must be gone");
assert(source.includes("if (!result.ok) setSelected(before)"), "failed writes roll back optimistic selection");
console.log("PASS: 3 exclusive checkboxes in the account card, all choices, pending, accessibility and error rollback.");
