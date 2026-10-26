import { NextResponse } from "next/server";
import { authorizeCronRequest } from "@/lib/auth/cronSecret";
import { readControlDoc } from "@/lib/control/read";
import { reviewCompanionNurtureDuty } from "@/lib/validation/githubStations";
import { runWorkerAutoscale } from "@/lib/services/workerAutoscale";

export const maxDuration = 150;
export async function GET(request: Request) {
  if (!authorizeCronRequest(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  // Fail closed during mirror switch and if active-site ownership is unknown.
  const site = (await readControlDoc())?.activeSiteId ?? null;
  const duty = reviewCompanionNurtureDuty(process.env.SITE_ID ?? "", site);
  if (!duty.feed) return NextResponse.json({ ok: true, skipped: true, why: duty.why });
  const result = await runWorkerAutoscale();
  return NextResponse.json(result, { status: result.ok ? 200 : 503 });
}
