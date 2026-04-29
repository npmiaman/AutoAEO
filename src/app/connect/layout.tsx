import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { shop as shopTable } from "@/lib/db/schema";
import { DashboardShell } from "@/components/dashboard-shell";

export default async function ConnectLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/signin?next=/connect");

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
