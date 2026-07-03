import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { and, desc, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { site as siteTable } from "@/lib/db/schema";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { AddWebsiteDialog } from "@/components/add-website-dialog";

export default async function DashboardPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/signin?next=/dashboard");

  const sites = await db
    .select({
      id: siteTable.id,
      name: siteTable.name,
      primaryDomain: siteTable.primaryDomain,
    })
    .from(siteTable)
    .where(
      and(
        eq(siteTable.userId, session.user.id),
        eq(siteTable.platform, "generic"),
      ),
    )
    .orderBy(desc(siteTable.createdAt));

  return (
    <div className="space-y-8">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="font-heading text-3xl tracking-tight">Your websites</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Add a site and Pigeon shows where you stand in AI search.
          </p>
        </div>
        {sites.length > 0 && <AddWebsiteDialog />}
      </div>

      {sites.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-4 py-14 text-center">
            <div>
              <p className="font-medium">No websites yet</p>
              <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
                Add your website to run a free visibility scan and see which AI
                searches you show up on — and who&rsquo;s winning the rest.
              </p>
            </div>
            <AddWebsiteDialog />
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {sites.map((s) => (
            <Link key={s.id} href={`/sites/${s.id}`} className="group">
              <Card className="h-full transition-colors group-hover:border-foreground/40">
                <CardContent className="space-y-3 py-6">
                  <div>
                    <div className="font-medium leading-tight">{s.name}</div>
                    <div className="text-sm text-muted-foreground">
                      {s.primaryDomain}
                    </div>
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="w-full rounded-lg"
                  >
                    Open
                  </Button>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
