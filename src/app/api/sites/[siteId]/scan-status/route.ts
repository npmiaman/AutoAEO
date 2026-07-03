import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { and, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { site as siteTable } from "@/lib/db/schema";
import { pollSiteScan } from "@/lib/agent/measurement/batch-scan";

// Poll endpoint: checks the site's running batch scan and finalizes it if the
// batch is done. Returns the current status so the client can refresh.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ siteId: string }> },
) {
  const { siteId } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const [owned] = await db
    .select({ id: siteTable.id })
    .from(siteTable)
    .where(and(eq(siteTable.id, siteId), eq(siteTable.userId, session.user.id)))
    .limit(1);
  if (!owned) return NextResponse.json({ error: "not found" }, { status: 404 });

  const status = await pollSiteScan(siteId);
  return NextResponse.json({ status });
}
