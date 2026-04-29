import { headers } from "next/headers";
import { redirect, notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { shop as shopTable } from "@/lib/db/schema";
import { DashboardShell } from "@/components/dashboard-shell";

export default async function ShopLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ shopId: string }>;
}) {
  const { shopId } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/signin");

  // Confirm the shop belongs to this user
  const owned = await db
    .select({ id: shopTable.id })
    .from(shopTable)
    .where(and(eq(shopTable.id, shopId), eq(shopTable.userId, session.user.id)))
    .limit(1);
  if (!owned[0]) notFound();

  const shops = await db
    .select({ id: shopTable.id, shopDomain: shopTable.shopDomain })
    .from(shopTable)
    .where(eq(shopTable.userId, session.user.id));

  return (
    <DashboardShell user={session.user} shops={shops}>
      {children}
    </DashboardShell>
  );
}
