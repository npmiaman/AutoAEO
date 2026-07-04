import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { and, desc, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { measurement, site as siteTable } from "@/lib/db/schema";
import { Card, CardContent } from "@/components/ui/card";

interface AgentRow {
  name: string;
  what: string;
  status: string;
}

export default async function AgentsPage({
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

  let auditStr = "—";
  let fixesStr = "—";
  if (latest?.detailJson) {
    try {
      const d = JSON.parse(latest.detailJson) as {
        audit?: { passed?: number; total?: number };
        fixPack?: unknown[];
      };
      if (d.audit?.total)
        auditStr = `${d.audit.passed ?? 0}/${d.audit.total} checks passing`;
      if (Array.isArray(d.fixPack))
        fixesStr = `${d.fixPack.length} ready-to-apply fixes`;
    } catch {
      /* leave defaults */
    }
  }

  const scannedAt = latest?.createdAt
    ? latest.createdAt.toLocaleDateString()
    : "not yet run";

  const agents: AgentRow[] = [
    {
      name: "Visibility scan",
      what: "Runs your searches across AI assistants and maps who ranks.",
      status: latest
        ? `${latest.appeared}/${latest.total} searches · last ran ${scannedAt}`
        : "waiting for first scan",
    },
    {
      name: "AI-readiness audit",
      what: "Crawls the whole site and checks crawler access, SSR, and schema.",
      status: auditStr,
    },
    {
      name: "Fix generator",
      what: "Writes the concrete fixes — schema, FAQ blocks, atomic facts.",
      status: fixesStr,
    },
    {
      name: "Codebase agent",
      what: "Applies fixes straight into your repo (Next.js / Astro / static).",
      status: "connect via CLI",
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-3xl tracking-tight">Agents</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {site.name} — what Pigeon&rsquo;s agents are doing for you.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {agents.map((a) => (
          <Card key={a.name}>
            <CardContent className="space-y-2 py-5">
              <div className="flex items-center gap-2">
                <span className="size-2 rounded-full bg-emerald-500" />
                <h2 className="font-heading text-lg tracking-tight">{a.name}</h2>
              </div>
              <p className="text-sm text-muted-foreground">{a.what}</p>
              <p className="text-[13px] font-medium">{a.status}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 py-5">
          <div>
            <div className="text-sm font-medium">Let Pigeon apply the fixes</div>
            <p className="text-xs text-muted-foreground">
              Install the CLI and the codebase agent opens the changes for you.
            </p>
          </div>
          <Link
            href="/profile"
            className="rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background hover:opacity-90"
          >
            Connect your codebase
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
