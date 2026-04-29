import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { shop as shopTable } from "@/lib/db/schema";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default async function DashboardPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/signin");

  const shops = await db
    .select()
    .from(shopTable)
    .where(eq(shopTable.userId, session.user.id))
    .orderBy(shopTable.installedAt);

  return (
    <div className="space-y-8">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Stores</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Connect a Shopify store to start running AEO playbooks against it.
          </p>
        </div>
        <Link href="/connect">
          <Button>Connect Shopify store</Button>
        </Link>
      </div>

      {shops.length === 0 ? (
        <Card className="border-dashed">
          <CardHeader>
            <CardTitle className="text-base">No stores connected yet</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Connect your first Shopify store to run an audit and start
              generating AEO improvements. We recommend starting with a free{" "}
              <a
                href="https://partners.shopify.com/"
                target="_blank"
                rel="noreferrer"
                className="font-medium text-foreground underline-offset-2 hover:underline"
              >
                Shopify Partners development store
              </a>{" "}
              while you test things out.
            </p>
            <Link href="/connect">
              <Button>Connect a store</Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {shops.map((s) => (
            <Card key={s.id} className="transition-colors hover:border-foreground/40">
              <CardHeader>
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="text-base">
                    {s.name ?? s.shopDomain}
                  </CardTitle>
                  <Badge variant="secondary" className="text-[10px]">
                    Connected
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">{s.shopDomain}</p>
              </CardHeader>
              <CardContent className="flex gap-2">
                <Link href={`/shops/${s.id}/audit`} className="flex-1">
                  <Button variant="default" size="sm" className="w-full">
                    Open audit
                  </Button>
                </Link>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
