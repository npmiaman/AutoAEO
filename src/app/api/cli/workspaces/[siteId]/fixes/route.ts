import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { measurement, site as siteTable } from "@/lib/db/schema";
import { authCliToken } from "@/lib/cli-token";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
};

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

// The changes Pigeon wants applied to a workspace's codebase: the generated fix
// pack + the technical audit from the latest scan. `pigeon apply` writes these
// into the repo. Ownership is enforced via the CLI token's account.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ siteId: string }> },
) {
  const userId = await authCliToken(req);
  if (!userId)
    return NextResponse.json(
      { error: "Invalid or missing CLI token" },
      { status: 401, headers: CORS },
    );

  const { siteId } = await params;
  const [site] = await db
    .select({
      id: siteTable.id,
      name: siteTable.name,
      primaryDomain: siteTable.primaryDomain,
    })
    .from(siteTable)
    .where(and(eq(siteTable.id, siteId), eq(siteTable.userId, userId)))
    .limit(1);
  if (!site)
    return NextResponse.json(
      { error: "Workspace not found" },
      { status: 404, headers: CORS },
    );

  const [latest] = await db
    .select({ detailJson: measurement.detailJson, createdAt: measurement.createdAt })
    .from(measurement)
    .where(eq(measurement.siteId, siteId))
    .orderBy(desc(measurement.createdAt))
    .limit(1);

  let fixPack: unknown[] = [];
  let audit: unknown = null;
  if (latest?.detailJson) {
    try {
      const d = JSON.parse(latest.detailJson) as {
        fixPack?: unknown[];
        audit?: unknown;
      };
      fixPack = d.fixPack ?? [];
      audit = d.audit ?? null;
    } catch {
      /* leave empty */
    }
  }

  return NextResponse.json(
    {
      site,
      fixPack,
      audit,
      scannedAt: latest?.createdAt ? latest.createdAt.getTime() : null,
    },
    { headers: CORS },
  );
}
