import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { agentRun, shop as shopTable } from "@/lib/db/schema";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PLAYBOOKS } from "@/lib/agent/playbooks";
import { RunPlaybookButton } from "@/components/run-playbook-button";

export default async function AuditPage({
  params,
}: {
  params: Promise<{ shopId: string }>;
}) {
  const { shopId } = await params;
  const [s] = await db.select().from(shopTable).where(eq(shopTable.id, shopId));
  if (!s) return null;

  const runs = await db
    .select()
    .from(agentRun)
    .where(eq(agentRun.shopId, shopId))
    .orderBy(desc(agentRun.startedAt))
    .limit(10);

  return (
    <div className="space-y-10">
      <div>
        <Link
          href="/dashboard"
          className="text-sm text-muted-foreground hover:underline"
        >
          ← All stores
        </Link>
        <div className="mt-2 flex items-center gap-3">
          <h1 className="text-3xl font-semibold tracking-tight">
            {s.name ?? s.shopDomain}
          </h1>
          <Badge variant="secondary">Connected</Badge>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">{s.shopDomain}</p>
      </div>

      <section className="space-y-4">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Playbooks</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Run a playbook to generate proposed changes. You&apos;ll review and
            approve every change before anything is published to your store.
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {PLAYBOOKS.map((p) => (
            <Card key={p.id} className="flex flex-col">
              <CardHeader>
                <CardTitle className="text-base">{p.name}</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-1 flex-col justify-between gap-4">
                <p className="text-sm text-muted-foreground">{p.description}</p>
                <RunPlaybookButton shopId={shopId} playbookId={p.id} />
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold tracking-tight">Recent runs</h2>
        {runs.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              No runs yet. Run a playbook above to generate your first set of
              proposed changes.
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {runs.map((r) => (
              <Link
                key={r.id}
                href={`/shops/${shopId}/runs/${r.id}`}
                className="block rounded-lg border p-4 transition-colors hover:bg-muted/40"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium capitalize">
                        {r.playbook.replace(/-/g, " ")}
                      </span>
                      <Badge variant="outline" className="text-[10px]">
                        {r.status.replace(/_/g, " ")}
                      </Badge>
                    </div>
                    {r.summary && (
                      <p className="mt-1 text-sm text-muted-foreground">
                        {r.summary}
                      </p>
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {r.startedAt.toLocaleString()}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
