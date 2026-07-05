import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { and, desc, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { measurement, site as siteTable } from "@/lib/db/schema";
import { recentActivity, type ActivityLine } from "@/lib/agent/measurement/activity";
import { runningScanJob } from "@/lib/agent/measurement/batch-scan";

// Feed for the dashboard terminal: what Pigeon is doing + whether a scan runs.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ siteId: string }> },
) {
  const { siteId } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const [site] = await db
    .select({ id: siteTable.id })
    .from(siteTable)
    .where(and(eq(siteTable.id, siteId), eq(siteTable.userId, session.user.id)))
    .limit(1);
  if (!site)
    return NextResponse.json({ error: "not found" }, { status: 404 });

  const limit = Math.min(
    500,
    Math.max(20, Number(new URL(req.url).searchParams.get("limit")) || 60),
  );
  let lines = await recentActivity(siteId, limit);
  if (lines.length === 0) lines = await synthesize(siteId);

  const scanning = !!(await runningScanJob(siteId));
  return NextResponse.json({ lines, scanning, hasMore: lines.length >= limit });
}

// For sites scanned before the activity feed existed: derive a short recap from
// the latest measurement so the terminal isn't empty.
async function synthesize(siteId: string): Promise<ActivityLine[]> {
  const [m] = await db
    .select()
    .from(measurement)
    .where(eq(measurement.siteId, siteId))
    .orderBy(desc(measurement.createdAt))
    .limit(1);
  if (!m) return [];

  const at = m.createdAt.getTime();
  const out: ActivityLine[] = [
    { message: "Scanned your site across AI assistants.", kind: "info", at },
  ];
  try {
    const d = JSON.parse(m.detailJson ?? "{}") as {
      competitors?: { competitors?: unknown[] };
      audit?: { passed?: number; total?: number };
      fixPack?: unknown[];
    };
    const comp = d.competitors?.competitors?.length ?? 0;
    if (comp)
      out.push({ message: `Mapped ${comp} competitors.`, kind: "info", at });
    if (d.audit?.total)
      out.push({
        message: `AI-readiness — ${d.audit.passed ?? 0}/${d.audit.total} checks passing.`,
        kind: "info",
        at,
      });
    if (Array.isArray(d.fixPack) && d.fixPack.length)
      out.push({
        message: `Generated ${d.fixPack.length} ready-to-apply fixes.`,
        kind: "info",
        at,
      });
  } catch {
    /* partial recap is fine */
  }
  out.push({
    message: `Last scan: you show up on ${m.appeared}/${m.total} AI searches.`,
    kind: "done",
    at,
  });
  return out;
}
