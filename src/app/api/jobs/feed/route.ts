import { NextResponse, type NextRequest } from "next/server";
import { currentUser } from "@/lib/auth/guards";
import { eventsAfter, getLatestJob, reapStaleJobs } from "@/lib/services/jobs";

/**
 * The dashboard's polling feed: latest job + its events after a cursor. A route handler
 * rather than a server action because the client polls it on an interval — this is a READ,
 * cacheable-never, side-effect-light (the stale-job reaper piggybacks here, which is what
 * lets the whole system run without a cron at small scale).
 */
export async function GET(request: NextRequest) {
  const user = await currentUser();
  if (!user || user.status !== "active") {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  await reapStaleJobs();

  const job = await getLatestJob(user.id);
  if (!job) {
    return NextResponse.json({ job: null, events: [] });
  }

  const after = Number(request.nextUrl.searchParams.get("after") ?? 0) || 0;
  const events = await eventsAfter(job.id, after);

  return NextResponse.json({
    job: {
      id: job.id,
      status: job.status,
      createdAt: job.createdAt,
      nextRunAt: job.nextRunAt,
      attempts: job.attempts,
      workerId: job.workerId,
    },
    events: events.map((e) => ({
      id: e.id,
      at: e.at,
      level: e.level,
      message: e.message,
    })),
  });
}
