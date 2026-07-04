import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { and, desc, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { measurement, site as siteTable } from "@/lib/db/schema";
import { Card, CardContent } from "@/components/ui/card";
import { runningScanJob } from "@/lib/agent/measurement/batch-scan";
import { runScan } from "./actions";
import { RunScanButton } from "./run-scan-button";
import { ScanReport, type ScanDetail } from "./scan-report";
import { ScanPoller } from "./scan-poller";

export default async function SitePage({
  params,
}: {
  params: Promise<{ siteId: string }>;
}) {
  const { siteId } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/signin");

  const [site] = await db
    .select()
    .from(siteTable)
    .where(and(eq(siteTable.id, siteId), eq(siteTable.userId, session.user.id)))
    .limit(1);
  if (!site) redirect("/dashboard");

  const [latest] = await db
    .select()
    .from(measurement)
    .where(eq(measurement.siteId, siteId))
    .orderBy(desc(measurement.createdAt))
    .limit(1);

  const scanning = !!(await runningScanJob(siteId));

  let detail: ScanDetail | null = null;
  if (latest?.detailJson) {
    try {
      detail = JSON.parse(latest.detailJson) as ScanDetail;
    } catch {
      detail = null;
    }
  }

  return (
    <div className="space-y-8">
      {scanning && <ScanPoller siteId={siteId} />}

      <div>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="font-heading text-3xl tracking-tight">{site.name}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {site.primaryDomain}
            </p>
          </div>
          <form action={runScan.bind(null, siteId)}>
            <RunScanButton hasScan={!!detail} scanning={scanning} />
          </form>
        </div>
      </div>

      {scanning && (
        <Card className="border-dashed">
          <CardContent className="flex items-center gap-3 py-4">
            <span className="size-2 animate-pulse rounded-full bg-foreground" />
            <p className="text-sm text-muted-foreground">
              Scanning in the background — running all searches as one batch.
              This usually takes a few minutes; the results appear here
              automatically.
            </p>
          </CardContent>
        </Card>
      )}

      {detail ? (
        <ScanReport
          detail={detail}
          siteId={siteId}
          appeared={latest.appeared}
          total={latest.total}
          ranAt={latest.createdAt}
          ourName={site.name}
          ourDomain={site.primaryDomain}
        />
      ) : (
        !scanning && (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
              <p className="font-medium">No scan yet</p>
              <p className="max-w-sm text-sm text-muted-foreground">
                Run a visibility scan to see which AI searches you show up on,
                who&rsquo;s winning the rest, and where the quick wins are.
              </p>
            </CardContent>
          </Card>
        )
      )}
    </div>
  );
}
