#!/usr/bin/env node
/** Pure/service/action tests. Infrastructure fixtures never touch live users or jobs. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";
import * as tags from "../src/lib/validation/tags";
import * as permissions from "../src/lib/auth/permissions";
import * as userValidation from "../src/lib/validation/user";
import * as schema from "../src/lib/db/schema";
import * as presence from "../src/lib/validation/presence";

const now = Date.parse("2026-11-07T12:00:00.000Z");
const past = "2026-11-07T11:59:59.999Z";
const future = "2099-11-07T12:00:00.000Z";
const member = { roles: ["de-tu"], tags: ["VIP"], tagExpirations: { vip: past } };
assert.equal(permissions.canUseFishingQuest(member, now), false, "expired VIP must not grant fishing");
assert.equal(permissions.canUseFishingQuest({ ...member, tagExpirations: { vip: new Date(now).toISOString() } }, now), false, "expiry instant is exclusive");
assert.equal(permissions.canUseFishingQuest({ ...member, tagExpirations: { vip: future } }, now), true);
assert.equal(permissions.canUseFishingQuest({ roles: [], tags: ["VIP"] }, now), true, "legacy tags remain unlimited");
assert.equal(permissions.canUseFishingQuest({ ...member, tagExpirations: { vip: null } }, now), true);
assert.equal(permissions.canUseFishingQuest({ ...member, tagExpirations: { vip: "invalid" } }, now), false, "malformed stored expiry fails closed");
assert.equal(permissions.canUseFishingQuest({ ...member, roles: ["gia-chu"] }, now), true);
assert.equal(permissions.canUseFishingQuest(null, now), false);
assert.deepEqual(permissions.fishingAccessForUser(member, now), { allowed: false, expiresAt: null });
assert.deepEqual(permissions.fishingAccessForUser({ ...member, tagExpirations: { vip: future } }, now), { allowed: true, expiresAt: future });

assert.deepEqual(tags.getActiveTags(["VIP", "Thánh nữ", "Old"], { vip: past, old: future }, now), ["Thánh nữ", "Old"]);
assert.deepEqual(tags.getActiveTags([" VIP "], { vip: past }, now), []);
assert.deepEqual(tags.getActiveTags(["toString", "__proto__"], {}, now), ["toString", "__proto__"]);
for (const malformed of [[], "bad", 123, true]) {
  assert.deepEqual(tags.getActiveTags(["VIP"], malformed as unknown as tags.TagExpirations, now), [], "malformed stored map fails closed");
}
assert.deepEqual(tags.parseTagExpirations(JSON.stringify({ " VIP ": "2026-11-07T19:00:00+07:00", "Thánh Nữ": null }), ["VIP", "Thánh nữ"]),
  { ok: true, tagExpirations: { vip: "2026-11-07T12:00:00.000Z" } });
assert.deepEqual(tags.parseTagExpirations("{}", ["VIP"]), { ok: true, tagExpirations: {} });
for (const raw of ["[]", "null", "broken", '{"vip":1}', '{"vip":""}', '{"vip":"2026-11-07T19:00"}', '{"vip":"2026-02-31T00:00:00Z"}', '{"vip":"not-a-date"}', '{"other":null}', '{"VIP":null,"vip":null}']) {
  assert.equal(tags.parseTagExpirations(raw, ["VIP"]).ok, false, "reject invalid expiry payload: " + raw);
}
assert.equal(tags.parseTagExpirations(JSON.stringify({ vip: past }), ["VIP"]).ok, true, "expired dates remain editable");
console.log("PASS expiry parser, independent tags, unlimited compatibility, UTC and privilege boundaries");

const require = createRequire(import.meta.url);
function load<T>(file: string, dependencies: Record<string, unknown>): T {
  const source = readFileSync(new URL("../" + file, import.meta.url), "utf8");
  const output = ts.transpileModule(source, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true,
  }, fileName: file }).outputText;
  const module = { exports: {} };
  new Function("require", "module", "exports", output)((id: string) => {
    if (Object.hasOwn(dependencies, id)) return dependencies[id];
    if (id === "drizzle-orm" || id === "zod") return require(id);
    throw new Error("Unexpected fixture dependency: " + id);
  }, module, module.exports);
  return module.exports as T;
}
let row: Record<string, unknown> = {
  id: "fixture-user", username: "fixture", displayName: "Fixture", email: "fixture@example.test",
  tags: ["VIP", "Thánh nữ"], tagExpirations: { vip: past }, roles: ["de-tu"], status: "active",
};
const patches: Record<string, unknown>[] = [];
const fixtureDb = {
  select(columns: Record<string, unknown>) {
    const rows = () => [Object.fromEntries(Object.keys(columns).map(key => [key, row[key]]))];
    return { from: () => ({ where: () => ({
      limit: async () => rows(), orderBy: async () => rows(),
    }) }) };
  },
  update() { return { set(value: Record<string, unknown>) {
    patches.push(value);
    return { where: async () => { row = { ...row, ...value }; } };
  } }; },
};
const users = load<typeof import("../src/lib/services/users")>("src/lib/services/users.ts", {
  "@/lib/db/client": { db: () => fixtureDb, schema },
  "@/lib/auth/permissions": permissions, "@/lib/auth/password": {}, "@/lib/services/settings": {},
  "@/lib/validation/presence": presence, "@/lib/validation/tags": tags,
});
for (const result of [await users.findById("fixture-user"), await users.findByUsername("fixture"), await users.findByEmail("fixture@example.test"), ...(await users.listUsers({}))]) {
  assert.ok(result);
  assert.deepEqual(result.tags, ["Thánh nữ"], "every read exposes active tags only");
  assert.deepEqual(result.tagAssignments, [{ label: "VIP", expiresAt: past }, { label: "Thánh nữ", expiresAt: null }]);
  assert.deepEqual(result.tagExpirations, { vip: past });
}
await users.adminUpdate("fixture-user", { tags: ["VIP", "New"] });
assert.deepEqual(row.tagExpirations, { vip: past }, "old form preserves retained expiry");
await users.adminUpdate("fixture-user", { tags: ["VIP", "New"], tagExpirations: { vip: future } });
assert.deepEqual(row.tags, ["VIP", "New"]);
assert.deepEqual(row.tagExpirations, { vip: future });
assert.deepEqual(patches.at(-1)?.tags, ["VIP", "New"], "labels and expiry are written atomically");
assert.deepEqual(patches.at(-1)?.tagExpirations, { vip: future });
await users.adminUpdate("fixture-user", { tags: ["New"] });
assert.deepEqual(row.tagExpirations, {}, "removed tag loses stale expiry");
await users.adminUpdate("fixture-user", { tags: ["VIP"], tagExpirations: {} });
assert.deepEqual(row.tagExpirations, {}, "explicit unlimited clears expiry");
const writesBefore = patches.length;
assert.equal((await users.adminUpdate("fixture-user", { tags: ["VIP"], tagExpirations: { vip: "invalid" } })).ok, false);
assert.equal(patches.length, writesBefore);
await users.adminUpdate("fixture-user", { displayName: "Changed" });
assert.equal(Object.hasOwn(patches.at(-1)!, "tagExpirations"), false, "profile edit preserves expiry");
console.log("PASS user reads, atomic update payload, old forms and explicit unlimited");

let admin = { id: "admin", roles: ["gia-chu"], status: "active" };
const saved: Record<string, unknown>[] = [];
const action = load<typeof import("../src/app/actions/admin")>("src/app/actions/admin.ts", {
  "next/cache": { revalidatePath() {} }, "@/lib/auth/guards": { requireAdmin: async () => admin },
  "@/lib/auth/permissions": permissions, "@/lib/validation/tags": tags, "@/lib/validation/user": userValidation,
  "@/lib/services/users": {
    findById: async () => ({ ...row, roles: ["de-tu"] }),
    adminUpdate: async (_id: string, input: Record<string, unknown>) => { saved.push(input); return { ok: true }; },
  },
  "@/lib/realtime/dashboardChannel": {}, "@/lib/quest-engine/cookies.mjs": {},
  "@/lib/services/chat": {}, "@/lib/services/media": {}, "@/lib/services/jobs": {},
  "@/lib/services/bulkStopJobs": {}, "@/lib/changelog": {}, "@/lib/services/settings": {},
  "@/lib/validation/retention": {}, "@/lib/validation/chat": {},
});
const form = () => {
  const value = new FormData();
  for (const [key, item] of Object.entries({ userId: "fixture-user", displayName: "Fixture User", email: "fixture@example.test", status: "active", password: "", tags: "VIP, New" })) value.set(key, item);
  return value;
};
let input = form(); input.set("tagExpirations", JSON.stringify({ vip: future }));
assert.equal((await action.updateUserAction(null, input)).ok, true);
assert.deepEqual(saved.at(-1)?.tagExpirations, { vip: future });
input = form(); input.set("tagExpirations", '{"vip":"bad"}');
const actionsBefore = saved.length;
assert.equal((await action.updateUserAction(null, input)).ok, false);
assert.equal(saved.length, actionsBefore);
assert.equal((await action.updateUserAction(null, form())).ok, true);
assert.equal(saved.at(-1)?.tagExpirations, undefined);
admin = { id: "other", roles: ["de-tu"], status: "active" };
const authorizedWrites = saved.length;
assert.equal((await action.updateUserAction(null, form())).ok, false);
assert.equal(saved.length, authorizedWrites, "forged form cannot bypass management permission");
console.log("PASS admin action expiry payload, old forms and authorization");
const deployment = readFileSync(new URL("./deployBackend.mts", import.meta.url), "utf8");
const migrationStep = deployment.indexOf('"cd $REL && sudo -u jarvis npm run db:migrate');
const buildStep = deployment.indexOf('"cd $REL && sudo -u jarvis npm run build');
assert.ok(migrationStep > 0 && migrationStep < buildStep, "OCI staged release must migrate its shared database before building/switching traffic");
