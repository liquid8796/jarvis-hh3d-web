#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const form = readFileSync(new URL("../src/app/dashboard/ConfigForm.tsx", import.meta.url), "utf8");
const action = readFileSync(new URL("../src/app/actions/automation.ts", import.meta.url), "utf8");
const sf = ts.createSourceFile("ConfigForm.tsx", form, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
type Role = "host" | "join" | "shared";
const fields = new Map<string, Role>();
const sections = new Set<string>();

function attrsOf(node: ts.Node): ts.JsxAttributes | null {
  if (ts.isJsxElement(node)) return node.openingElement.attributes;
  if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) return node.attributes;
  return null;
}
function attr(attrs: ts.JsxAttributes, key: string): ts.JsxAttribute | undefined {
  return attrs.properties.find((part): part is ts.JsxAttribute =>
    ts.isJsxAttribute(part) && part.name.getText(sf) === key);
}
function textAttr(attrs: ts.JsxAttributes, key: string): string | null {
  const value = attr(attrs, key)?.initializer;
  return value && ts.isStringLiteral(value) ? value.text : null;
}
function exprAttr(attrs: ts.JsxAttributes, key: string): string | null {
  const value = attr(attrs, key)?.initializer;
  return value && ts.isJsxExpression(value) ? (value.expression?.getText(sf) ?? null) : null;
}
function inspect(node: ts.Node, role: Role = "shared"): void {
  const attrs = attrsOf(node);
  let current = role;
  if (attrs) {
    const section = textAttr(attrs, "data-maze-role-fields");
    if (section) {
      assert(section === "host" || section === "join", "Unexpected maze role group");
      assert.equal(exprAttr(attrs, "hidden"), 'meCungRole !== "' + section + '"', "Incorrect role visibility");
      sections.add(section);
      current = section;
    }
    const tag = ts.isJsxElement(node) ? node.openingElement.tagName.getText(sf) :
      ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node) ? node.tagName.getText(sf) : "";
    if (tag === "input" || tag === "select") {
      const name = textAttr(attrs, "name");
      if (name?.startsWith("meCung")) fields.set(name, current);
    }
  }
  ts.forEachChild(node, child => inspect(child, current));
}
inspect(sf);

const expected: Record<Role, string[]> = {
  join: ["meCungRoomCode", "meCungHostWaitSec"],
  host: ["meCungKickHp", "meCungMinPlayers", "meCungKickIdle", "meCungChatLobby", "meCungChatFight"],
  shared: ["meCungEnabled", "meCungRole", "meCungMode", "meCungCapCheck"],
};
for (const [role, names] of Object.entries(expected) as [Role, string[]][]) {
  for (const name of names) {
    assert.equal(fields.get(name), role, name + " is not grouped as " + role);
    assert(action.includes('formData.get("' + name + '")'), name + " is not saved server-side");
  }
}
assert.equal(fields.size, Object.values(expected).flat().length, "Unexpected Maze fields");
assert.equal(sections.size, 2, "Both role sections need to remain in DOM");
assert(form.includes('const [meCungRole, setMeCungRole] = useState<"host" | "join">(config.quests.meCung.role)'));
assert(form.includes('onChange={(event) => setMeCungRole(event.target.value as "host" | "join")}'));
assert(form.includes("noValidate"), "Inactive form fields must not block saving");
assert(!form.includes("disabled={meCungRole"), "Hidden form fields must retain submitted values");
console.log("PASS: host 5, join 2, shared 4, mode switch and preserved FormData.");
