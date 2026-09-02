/** Offline checks: real account services with only the PostgreSQL transport mocked. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Pool } from "pg";
import { getTableColumns } from "drizzle-orm";
import { gameAccounts } from "../src/lib/db/schema";
import {
  listAccounts,
  recordDetectedPillBagCapsForJob,
  updateAccountCookie,
} from "../src/lib/services/accounts";
import { pillBagCapsSchema, type PillBagCaps } from "../src/lib/validation/pillBagCaps";

const capsA: PillBagCaps = { ha: 10, trung: 6, thuong: 4, cuc: 2 };
const capsB: PillBagCaps = { ha: 30, trung: 18, thuong: 12, cuc: 0 };
assert.deepEqual(pillBagCapsSchema.parse(capsB), capsB);
assert.equal(pillBagCapsSchema.safeParse({ ...capsA, ha: Number.MAX_SAFE_INTEGER }).success, true);
for (const invalid of [
  null,
  {},
  { ha: 10, trung: 6, thuong: 4 },
  { ...capsA, ha: -1 },
  { ...capsA, ha: 1.5 },
  { ...capsA, ha: "10" },
  { ...capsA, ha: NaN },
  { ...capsA, ha: Infinity },
  { ...capsA, ha: Number.MAX_SAFE_INTEGER + 1 },
  { ...capsA, unrelated: 5 },
]) {
  assert.equal(pillBagCapsSchema.safeParse(invalid).success, false);
}

const userId = "00000000-0000-4000-8000-000000000001";
const jobId = "00000000-0000-4000-8000-000000000002";
const accountId = "00000000-0000-4000-8000-000000000003";
const observedAt = "2026-09-02T08:00:00.000Z";
const fixture = {
  id: accountId,
  userId,
  label: "Tài khoản A",
  cookieEnvelope: "fixture-cookie-only",
  accountTier: "vip",
  pillBagCaps: capsA,
  pillBagCapsObservedAt: observedAt,
  enabled: true,
  createdAt: observedAt,
  updatedAt: observedAt,
};
const fixtures = [
  fixture,
  { ...fixture, id: "00000000-0000-4000-8000-000000000004", label: "Tài khoản B", pillBagCaps: capsB },
  { ...fixture, id: "00000000-0000-4000-8000-000000000005", label: "Chưa dò", pillBagCaps: null, pillBagCapsObservedAt: null },
  { ...fixture, id: "00000000-0000-4000-8000-000000000006", label: "JSON hỏng", pillBagCaps: { ...capsA, ha: "bad" } },
  { ...fixture, id: "00000000-0000-4000-8000-000000000007", label: "Mốc giờ hỏng", pillBagCapsObservedAt: "not-a-date" },
];
const columns = Object.keys(getTableColumns(gameAccounts));
const rowValues = (row: Record<string, unknown>) => columns.map((name) => row[name]);
const queries: Array<{ text: string; values: unknown[] }> = [];
const originalQuery = Pool.prototype.query;
const originalDatabaseUrl = process.env.DATABASE_URL;
const originalEncryptionKey = process.env.ENCRYPTION_KEY;

// No env loading and no network: the fake connection string is never opened.
process.env.DATABASE_URL = "postgresql://offline:offline@127.0.0.1:1/offline";
process.env.ENCRYPTION_KEY = "01".repeat(32);
Pool.prototype.query = (async (query: { text: string; rowMode?: string }, values: unknown[]) => {
  queries.push({ text: query.text, values });
  let rows: unknown[] = [];
  if (query.text.startsWith("select ")) {
    rows = fixtures.map(rowValues);
  } else if (query.text.startsWith('update "game_accounts"')) {
    rows = [rowValues({ ...fixture, accountTier: null, pillBagCaps: null, pillBagCapsObservedAt: null })];
  }
  return { rows, rowCount: rows.length, command: "", oid: 0, fields: [] };
}) as typeof Pool.prototype.query;

try {
  await recordDetectedPillBagCapsForJob(jobId, capsB);
  const report = queries.at(-1)!;
  assert.deepEqual(report.values, [JSON.stringify(capsB), jobId]);
  assert.match(report.text, /acc\.id = job\.account_id/);
  assert.match(report.text, /acc\.user_id = job\.user_id/);
  assert.match(report.text, /acc\.cookie_envelope = job\.config_snapshot ->> 'gameCookie'/);
  assert.match(report.text, /job\.status in \('running', 'stopping'\)/);
  assert.match(report.text, /pill_bag_caps_observed_at = now\(\)/);

  const beforeInvalid = queries.length;
  await assert.rejects(recordDetectedPillBagCapsForJob(jobId, { ...capsA, ha: -1 }));
  assert.equal(queries.length, beforeInvalid, "invalid report must not reach storage");

  const views = await listAccounts(userId);
  assert.deepEqual(views.map((view) => view.pillBagCaps), [capsA, capsB, null, null, capsA]);
  assert.deepEqual(views.map((view) => view.pillBagCapsObservedAt), [observedAt, observedAt, null, null, null]);
  for (const view of views) {
    assert.equal("cookieEnvelope" in view, false);
    assert.equal("gameCookie" in view, false);
  }

  const updated = await updateAccountCookie(userId, accountId, "new-fixture-cookie-only");
  assert.equal(updated.ok, true);
  assert.equal(updated.account.pillBagCaps, null);
  assert.equal(updated.account.pillBagCapsObservedAt, null);
  const cookieUpdate = queries.at(-1)!;
  for (const column of ["account_tier", "pill_bag_caps", "pill_bag_caps_observed_at"]) {
    const parameter = cookieUpdate.text.match(new RegExp(`"${column}" = \\$(\\d+)`));
    assert.ok(parameter, `cookie update must clear ${column}`);
    assert.equal(cookieUpdate.values[Number(parameter[1]) - 1], null);
  }
  assert.match(cookieUpdate.text, /"game_accounts"\."id" = \$\d+/);
  assert.match(cookieUpdate.text, /"game_accounts"\."user_id" = \$\d+/);

  const route = readFileSync(new URL("../src/app/api/worker/route.ts", import.meta.url), "utf8");
  assert.match(route, /op: z\.literal\("pillBagCaps"\),\s*jobId: z\.string\(\)\.uuid\(\),\s*caps: pillBagCapsSchema/);
  assert.match(route, /case "pillBagCaps": \{\s*if \(!\(await jobBelongsTo\(body\.jobId, scope\)\)\)/);
  console.log("PASS: pill capacity validation, per-account projection, cookie reset, SQL ownership/snapshot guards, API authorization wiring.");
} finally {
  Pool.prototype.query = originalQuery;
  if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = originalDatabaseUrl;
  if (originalEncryptionKey === undefined) delete process.env.ENCRYPTION_KEY;
  else process.env.ENCRYPTION_KEY = originalEncryptionKey;
}
