import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  agentRun,
  changeProposal,
  shop as shopTable,
} from "@/lib/db/schema";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ProposalCard } from "@/components/proposal-card";
import { RunActions } from "@/components/run-actions";

export default async function RunReviewPage({
  params,
}: {
  params: Promise<{ shopId: string; runId: string }>;
}) {
  const { shopId, runId } = await params;

  const [run] = await db
    .select()
    .from(agentRun)
    .where(and(eq(agentRun.id, runId), eq(agentRun.shopId, shopId)))
    .limit(1);
  if (!run) notFound();

  const [s] = await db
    .select()
    .from(shopTable)
    .where(eq(shopTable.id, shopId))
    .limit(1);
  if (!s) notFound();

  const proposals = await db
    .select()
    .from(changeProposal)
    .where(eq(changeProposal.runId, runId));

  const counts = {
    pending: 0,
    approved: 0,
    rejected: 0,
    applied: 0,
    failed: 0,
    rolledBack: 0,
  };
  for (const p of proposals) {
    if (p.status === "pending") counts.pending++;
    else if (p.status === "approved") counts.approved++;
    else if (p.status === "rejected") counts.rejected++;
    else if (p.status === "applied") counts.applied++;
    else if (p.status === "failed") counts.failed++;
    else if (p.status === "rolled_back") counts.rolledBack++;
  }
  const reviewLocked = counts.applied > 0 || run.status === "applying";

  const metrics = run.metricsJson
    ? (JSON.parse(run.metricsJson) as Record<string, string | number>)
    : null;

  return (
    <div className="space-y-8">
      <div>
        <Link
          href={`/shops/${shopId}/audit`}
          className="text-sm text-muted-foreground hover:underline"
        >
          ← Back to {s.shopDomain}
        </Link>
        <div className="mt-2 flex items-center gap-3">
          <h1 className="text-3xl font-semibold tracking-tight capitalize">
            {run.playbook.replace(/-/g, " ")}
          </h1>
          <StatusBadge status={run.status} />
        </div>
        {run.summary && (
          <p className="mt-2 text-sm text-muted-foreground">{run.summary}</p>
        )}
        {run.errorMessage && (
          <p className="mt-2 text-sm text-destructive">{run.errorMessage}</p>
        )}
      </div>

      {metrics && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Run metrics</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-4 text-sm md:grid-cols-5">
              {Object.entries(metrics).map(([k, v]) => (
                <div key={k}>
                  <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                    {k}
                  </dt>
                  <dd className="mt-1 font-medium">{v}</dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>
      )}

      {counts.applied > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Live on your store</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p className="text-muted-foreground">
              These changes are now live. Verify them on your storefront:
            </p>
            <div className="flex flex-wrap gap-2">
              <PreviewLink
                href={`https://${s.shopDomain}/pages/llms.txt`}
                label="/pages/llms.txt"
              />
              <PreviewLink
                href={`https://${s.shopDomain}/pages/llms-full.txt`}
                label="/pages/llms-full.txt"
              />
              <PreviewLink
                href={`https://${s.shopDomain}/?view=machine`}
                label="?view=machine"
              />
              <PreviewLink
                href={`https://${s.shopDomain}/robots.txt`}
                label="/robots.txt"
              />
            </div>
          </CardContent>
        </Card>
      )}

      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 className="text-xl font-semibold tracking-tight">
          Proposed changes ({proposals.length})
        </h2>
        <RunActions runId={runId} status={run.status} counts={counts} />
      </div>

      {proposals.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No changes needed. Your store already matches what this playbook
            would generate.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {proposals.map((p) => (
            <ProposalCard
              key={p.id}
              proposal={p}
              reviewLocked={reviewLocked}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<
    string,
    { label: string; variant: "default" | "secondary" | "destructive" | "outline" }
  > = {
    running: { label: "Running", variant: "secondary" },
    awaiting_approval: { label: "Awaiting approval", variant: "default" },
    succeeded: { label: "Applied", variant: "secondary" },
    failed: { label: "Failed", variant: "destructive" },
    applying: { label: "Applying", variant: "secondary" },
    cancelled: { label: "Rolled back", variant: "outline" },
  };
  const cfg = map[status] ?? { label: status, variant: "outline" as const };
  return <Badge variant={cfg.variant}>{cfg.label}</Badge>;
}

function PreviewLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="rounded-md border bg-muted/40 px-3 py-1.5 text-xs font-medium hover:bg-muted"
    >
      {label} ↗
    </a>
  );
}
