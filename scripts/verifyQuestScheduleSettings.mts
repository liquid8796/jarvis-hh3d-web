import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import { build } from "esbuild";
import type { AppSettings } from "../src/lib/services/settings";
import type { QuestScheduleRule } from "../src/lib/validation/questSchedules";

const rules: QuestScheduleRule[] = [
  { questKey: "cauCa", enabled: true, windows: [{ start: "09:00", end: "10:00" }] },
];

const { outputFiles } = await build({
  entryPoints: ["src/lib/services/settings.ts"],
  bundle: true,
  write: false,
  platform: "node",
  format: "cjs",
  packages: "external",
  plugins: [{
    name: "offline-postgres",
    setup(builder) {
      builder.onResolve({ filter: /^@\/lib\/db\/client$/ }, () => ({ path: "client", namespace: "fixture" }));
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
        // Keep the real schema, Drizzle's SQL compiler, and transaction handling.
        contents: [
          'import { drizzle } from "drizzle-orm/node-postgres";',
          'import * as schema from "@/lib/db/schema";',
          'export { schema };',
          'export const db = () => drizzle(globalThis.__questSettingsPgClient, { schema });',
        ].join("\n"),
        resolveDir: process.cwd(),
      }));
    },
  }],
});
const module = { exports: {} as typeof import("../src/lib/services/settings") };
new Function("require", "module", "exports", outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const { getAppSettings, saveAppSettings, saveQuestSchedules } = module.exports;

type SettingsDocument = Record<string, unknown>;
type Query = { text: string; rowMode?: "array" };
type Statement = { sql: string; params: readonly unknown[] };

function parseDocument(value: unknown): SettingsDocument {
  assert.equal(typeof value, "string");
  return JSON.parse(value as string);
}

function database(initial?: SettingsDocument, { legacyLease = false } = {}) {
  let value = structuredClone(initial);
  let transaction: { previous: SettingsDocument | undefined; locked: boolean } | undefined;
  const statements: Statement[] = [];

  // Model only the SQL emitted for this document. Unexpected or overly broad writes fail.
  Object.assign(globalThis, { __questSettingsPgClient: { query } });
  async function query({ text, rowMode }: Query, params: readonly unknown[]) {
    const sql = text.trim().replace(/\s+/g, " ");
    statements.push({ sql, params });
    if (sql === "begin") {
      assert.equal(transaction, undefined);
      transaction = { previous: structuredClone(value), locked: false };
    } else if (sql === "commit" || sql === "rollback") {
      assert.ok(transaction);
      if (sql === "rollback") value = transaction.previous;
      transaction = undefined;
    } else if (/^select pg_advisory_xact_lock\(\$1, \$2\)$/.test(sql)) {
      assert.ok(transaction);
      transaction.locked = true;
    } else if (/^select 1 from "automation_jobs" /.test(sql)) {
      assert.ok(transaction?.locked, "Check legacy leases while holding the exclusive lock");
      assert.match(sql, /where status in \('running', 'stopping'\) and \(config_snapshot->\$1::text\) is distinct from '1'::jsonb limit 1$/);
      assert.deepEqual(params, ["$questSchedulesVersion"]);
      return { rows: legacyLease ? [{ "?column?": 1 }] : [] };
    } else if (/^select value->'questSchedules' as rules,/.test(sql)) {
      assert.ok(transaction?.locked, "Read the previous policy while holding the exclusive lock");
      assert.match(sql, /from "app_settings" where id = 'global'$/);
      return { rows: value ? [{ rules: value.questSchedules ?? null, present: Object.hasOwn(value, "questSchedules") }] : [] };
    } else if (/^select "value" from "app_settings" /.test(sql)) {
      assert.equal(rowMode, "array");
      assert.deepEqual(params, ["global", 1]);
      return { rows: value ? [[structuredClone(value)]] : [] };
    } else if (/^select "id", "value", "updated_at" from "app_settings" /.test(sql)) {
      assert.ok(transaction);
      assert.match(sql, /for update$/);
      assert.deepEqual(params, ["global"]);
      return { rows: value ? [["global", structuredClone(value), "2026-11-20T00:00:00Z"]] : [] };
    } else if (/^insert into "app_settings" /.test(sql)) {
      assert.ok(transaction);
      assert.equal(params[0], "global");
      const document = parseDocument(params[1]);
      if (sql.includes(" on conflict do nothing")) {
        value ??= document;
      } else {
        assert.ok(transaction.locked, "Save the policy while holding the exclusive lock");
        assert.match(sql, /on conflict \("id"\) do update set "value" = jsonb_set\("app_settings"\."value", '\{questSchedules\}', \$4::jsonb, true\), "updated_at" = now\(\)$/);
        assert.equal(typeof params[3], "string");
        const policy: unknown = JSON.parse(params[3] as string);
        assert.deepEqual(document.questSchedules, policy, "Insert and conflict update must save the same rules");
        value = value ? { ...value, questSchedules: policy } : document;
      }
    } else if (/^update "app_settings" /.test(sql)) {
      assert.ok(transaction);
      assert.match(sql, /set "value" = \$1, "updated_at" = now\(\) where "app_settings"\."id" = \$2$/);
      assert.equal(params[1], "global");
      value = parseDocument(params[0]);
    } else if (/^update "automation_jobs" /.test(sql)) {
      assert.ok(transaction?.locked, "Wake jobs in the same transaction as the policy update");
      assert.match(sql, /^update "automation_jobs" set next_run_at = .+, config_snapshot = config_snapshot - \$1::text where status = 'queued' and next_run_at > clock_timestamp\(\) and config_snapshot->\$2::text = 'true'::jsonb$/);
      assert.deepEqual(params, ["$questScheduleWaiting", "$questScheduleWaiting"]);
    } else {
      assert.fail("Unexpected SQL: " + sql);
    }
    return { rows: [] };
  }

  return { statements, value: () => value };
}

test("a legacy global document and missing global row both default to no schedule", async () => {
  database();
  assert.deepEqual((await getAppSettings()).questSchedules, []);

  database({ chat: { retentionDays: 19 } });
  const settings = await getAppSettings();
  assert.deepEqual(settings.questSchedules, []);
  assert.equal(settings.chat.retentionDays, 19);
});

test("a stale unrelated writer preserves the live schedule with or without its read baseline", async () => {
  const state = database({ chat: { retentionDays: 7 } });
  const settings = await getAppSettings();
  assert.deepEqual(settings.questSchedules, []);

  await saveQuestSchedules(rules);
  settings.chat.retentionDays = 18;
  await saveAppSettings(settings);
  assert.deepEqual(state.value()?.questSchedules, rules);
  assert.equal((await getAppSettings()).chat.retentionDays, 18);

  const detached: AppSettings = { ...settings, chat: { ...settings.chat, retentionDays: 24 } };
  await saveAppSettings(detached);
  const current = await getAppSettings();
  assert.deepEqual(current.questSchedules, rules);
  assert.equal(current.chat.retentionDays, 24);
});

test("only the schedule writer can activate rules on a new or existing settings document", async () => {
  database();
  const settings = await getAppSettings();
  settings.questSchedules = rules;
  await saveAppSettings(settings);
  assert.deepEqual((await getAppSettings()).questSchedules, []);

  await saveAppSettings({ ...settings });
  assert.deepEqual((await getAppSettings()).questSchedules, []);
});

test("the guarded upsert initializes new documents and updates just the schedule branch on conflict", async () => {
  database();
  await saveQuestSchedules(rules);
  assert.deepEqual((await getAppSettings()).questSchedules, rules);

  const sibling = { chat: { retentionDays: 31 }, futureSettings: { keep: ["unrecognized", true] } };
  const state = database(sibling);
  await saveQuestSchedules(rules);
  assert.deepEqual(state.value(), { ...sibling, questSchedules: rules });
  assert.deepEqual(state.statements.map(({ sql }) => sql.split(" ").slice(0, 2).join(" ")), [
    "begin",
    "select pg_advisory_xact_lock($1,",
    "select 1",
    "select value->'questSchedules'",
    'insert into',
    'update "automation_jobs"',
    "commit",
  ]);
});

test("saving an unchanged policy leaves schedule waiters asleep", async () => {
  const state = database({ questSchedules: rules });
  await saveQuestSchedules(structuredClone(rules));
  assert.deepEqual(state.value()?.questSchedules, rules);
  assert.equal(state.statements.some(({ sql }) => sql.startsWith('update "automation_jobs"')), false);
});

test("malformed schedule input is rejected before touching the database", async () => {
  const state = database({ questSchedules: rules });
  const invalid: QuestScheduleRule[] = [{ ...rules[0], windows: [{ start: "24:00", end: "10:00" }] }];
  await assert.rejects(saveQuestSchedules(invalid), { name: "ZodError" });
  assert.deepEqual(state.statements, []);
  assert.deepEqual(state.value()?.questSchedules, rules);
});

test("a legacy worker lease blocks activation without writing but permits clearing", async () => {
  const blocked = database({ chat: { retentionDays: 20 } }, { legacyLease: true });
  await assert.rejects(saveQuestSchedules(rules), { name: "QuestScheduleLegacyJobsError" });
  assert.equal(blocked.statements.at(-1)?.sql, "rollback");
  assert.equal(blocked.statements.some(({ sql }) => /^(insert|update)/.test(sql)), false);
  assert.deepEqual(blocked.value(), { chat: { retentionDays: 20 } });

  const cleared = database({ questSchedules: rules }, { legacyLease: true });
  await saveQuestSchedules([]);
  assert.deepEqual(cleared.value()?.questSchedules, []);
  assert.equal(cleared.statements.some(({ sql }) => sql.startsWith("select 1 ")), false);
  assert.ok(cleared.statements.some(({ sql }) => sql.startsWith('update "automation_jobs"')));
  assert.equal(cleared.statements.at(-1)?.sql, "commit");
});
