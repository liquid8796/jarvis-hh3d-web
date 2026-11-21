import { createHash } from "node:crypto";
import { sql, type SQL } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { db, schema } from "@/lib/db/client";
import { normalizeQuestSchedules } from "@/lib/quest-engine/questSchedules.mjs";
import { QuestScheduleLegacyJobsError, type QuestScheduleRule } from "@/lib/validation/questSchedules";

type QuestScheduleDatabase = Pick<NodePgDatabase<typeof schema>, "execute">;

// Server-owned metadata on the running job. claimNextJob removes the key from
// every source snapshot before writing the worker's declared capability.
export const QUEST_SCHEDULE_SNAPSHOT_VERSION_KEY = "$questSchedulesVersion";
export const QUEST_SCHEDULE_WAITING_KEY = "$questScheduleWaiting";

// "HH3D", slot 1. Serialize policy saves with legacy leases and schedule-driven
// requeues; ordinary polls, capable claims and unrelated settings stay independent.
const LOCK_NAMESPACE = 0x48483344;
const LOCK_SLOT = 1;

export async function lockQuestScheduleUpdate(tx: QuestScheduleDatabase): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(${LOCK_NAMESPACE}, ${LOCK_SLOT})`);
}

export async function lockQuestScheduleRead(tx: QuestScheduleDatabase): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock_shared(${LOCK_NAMESPACE}, ${LOCK_SLOT})`);
}

export async function getQuestScheduleRules(database: QuestScheduleDatabase = db()) {
  // Read this branch independently. A malformed sibling setting must not
  // affect the authoritative schedule, and a DB failure must reject.
  const { rows } = await database.execute<{ rules: unknown; present: boolean }>(sql`
    select value->'questSchedules' as rules, value ? 'questSchedules' as present
    from ${schema.appSettings}
    where id = 'global'
  `);
  const row = rows[0];
  return normalizeQuestSchedules(row?.present ? row.rules : undefined);
}

export async function assertNoLegacyQuestScheduleJobs(tx: QuestScheduleDatabase): Promise<void> {
  const { rows } = await tx.execute(sql`
    select 1
    from ${schema.automationJobs}
    where status in ('running', 'stopping')
      and (config_snapshot->${QUEST_SCHEDULE_SNAPSHOT_VERSION_KEY}::text) is distinct from '1'::jsonb
    limit 1
  `);
  if (rows.length > 0) throw new QuestScheduleLegacyJobsError();
}

export function questScheduleRevision(rules: readonly QuestScheduleRule[]): string {
  return createHash("sha256").update(JSON.stringify(rules)).digest("hex");
}

export function questScheduleSnapshot(snapshot: SQL, metadata = sql`'{}'::jsonb`): SQL {
  // Job snapshots may come from either a fresh user config or a legacy row.
  // Strip server-reserved keys from every source before adding trusted metadata.
  return sql`(
    select (case when jsonb_typeof(config) = 'object'
      then config - ARRAY[${QUEST_SCHEDULE_SNAPSHOT_VERSION_KEY}, ${QUEST_SCHEDULE_WAITING_KEY}]::text[]
      else '{}'::jsonb end) || ${metadata}
    from (select ${snapshot} as config) as job_snapshot
  )`;
}

export async function wakeQuestScheduleJobs(tx: QuestScheduleDatabase): Promise<void> {
  await tx.execute(sql`
    update ${schema.automationJobs}
    set next_run_at = least(next_run_at, greatest(clock_timestamp(), last_heartbeat + interval '30 seconds')),
      config_snapshot = config_snapshot - ${QUEST_SCHEDULE_WAITING_KEY}::text
    where status = 'queued'
      and next_run_at > clock_timestamp()
      and config_snapshot->${QUEST_SCHEDULE_WAITING_KEY}::text = 'true'::jsonb
  `);
}
