#!/usr/bin/env node
/** End-to-end: session cookie → Next route SSE → Neon NOTIFY → frame tới browser client. */
import { neon } from "@neondatabase/serverless";
import { SignJWT } from "jose";
import type { DashboardLivePayload } from "../src/lib/realtime/dashboardTypes";
import { addEvent, clearLatestJobEvents } from "../src/lib/services/jobs";
import { loadEnv } from "./loadEnv.mjs";

loadEnv(".env.local");
loadEnv();

if (!process.env.DATABASE_URL || !process.env.AUTH_SECRET) {
  throw new Error("Thiếu DATABASE_URL/AUTH_SECRET để kiểm SSE.");
}

const baseUrl = (process.env.REALTIME_VERIFY_URL ?? "http://127.0.0.1:3017").replace(/\/$/, "");
const sql = neon(process.env.DATABASE_URL);
const username = `__sse_test_${Date.now()}`;
const marker = `[verify-sse] ${crypto.randomUUID()}`;
const abort = new AbortController();
let userId = "";

type Waiting = {
  predicate: (payload: DashboardLivePayload) => boolean;
  resolve: (value: { payload: DashboardLivePayload; at: number }) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

const waiting = new Set<Waiting>();
const waitFor = (predicate: Waiting["predicate"], timeoutMs = 8_000) =>
  new Promise<{ payload: DashboardLivePayload; at: number }>((resolve, reject) => {
    const item: Waiting = {
      predicate,
      resolve,
      reject,
      timer: setTimeout(() => {
        waiting.delete(item);
        reject(new Error(`Không nhận frame SSE mong đợi sau ${timeoutMs}ms`));
      }, timeoutMs),
    };
    waiting.add(item);
  });

try {
  const users = await sql`
    insert into users (username, display_name, password_hash, status)
    values (${username}, 'SSE verifier', 'not-a-login-hash', 'active')
    returning id
  `;
  userId = String(users[0].id);

  const token = await new SignJWT({ username, role: "user" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(new TextEncoder().encode(process.env.AUTH_SECRET));

  const response = await fetch(`${baseUrl}/api/dashboard/stream`, {
    headers: { cookie: `jarvis_session=${token}` },
    signal: abort.signal,
  });
  if (!response.ok || !response.body) {
    throw new Error(`SSE trả HTTP ${response.status}: ${await response.text()}`);
  }
  if (!response.headers.get("content-type")?.startsWith("text/event-stream")) {
    throw new Error(`Sai content-type: ${response.headers.get("content-type")}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  void (async () => {
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true }).replace(/\r\n/g, "\n");
        let boundary = buffer.indexOf("\n\n");
        while (boundary >= 0) {
          const block = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          boundary = buffer.indexOf("\n\n");
          if (!block.includes("event: dashboard")) continue;
          const data = block
            .split("\n")
            .filter((line) => line.startsWith("data: "))
            .map((line) => line.slice(6))
            .join("\n");
          const payload = JSON.parse(data) as DashboardLivePayload;
          for (const item of [...waiting]) {
            if (!item.predicate(payload)) continue;
            waiting.delete(item);
            clearTimeout(item.timer);
            item.resolve({ payload, at: Date.now() });
          }
        }
      }
    } catch (error) {
      if (!abort.signal.aborted) {
        for (const item of waiting) item.reject(error as Error);
        waiting.clear();
      }
    }
  })();

  await waitFor((payload) => payload.job === null);

  const jobs = await sql`
    insert into automation_jobs (user_id, status, config_snapshot, runner, next_run_at)
    values (${userId}, 'running', '{}'::jsonb, 'local', now())
    returning id
  `;
  const jobId = String(jobs[0].id);

  const eventFrame = waitFor((payload) => payload.events.some((event) => event.message === marker));
  const eventStarted = Date.now();
  await addEvent(jobId, "info", marker);
  const eventLatency = (await eventFrame).at - eventStarted;

  const resetFrame = waitFor((payload) => payload.resetEvents === true);
  const resetStarted = Date.now();
  await clearLatestJobEvents(userId);
  const resetLatency = (await resetFrame).at - resetStarted;

  if (eventLatency >= 2_000 || resetLatency >= 2_000) {
    throw new Error(`SSE quá chậm: event=${eventLatency}ms, reset=${resetLatency}ms`);
  }
  console.log(`✔ SSE end-to-end: event ${eventLatency}ms, reset ${resetLatency}ms.`);
} finally {
  abort.abort();
  for (const item of waiting) {
    clearTimeout(item.timer);
    item.reject(new Error("Verifier kết thúc"));
  }
  waiting.clear();
  if (userId) await sql`delete from users where id = ${userId}`;
}
