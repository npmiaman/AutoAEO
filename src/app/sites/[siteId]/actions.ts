"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { site as siteTable } from "@/lib/db/schema";
import { resolveSite } from "@/lib/agent/loop/site";
import { runVisibilityScan } from "@/lib/agent/measurement/harness";

const SEARCH_COUNT = Number(process.env.DASHBOARD_SCAN_COUNT ?? 15);

export async function runScan(siteId: string): Promise<void> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/signin");

  const [owned] = await db
    .select({ id: siteTable.id })
    .from(siteTable)
    .where(and(eq(siteTable.id, siteId), eq(siteTable.userId, session.user.id)))
    .limit(1);
  if (!owned) redirect("/dashboard");

  const site = await resolveSite(siteId);
  await runVisibilityScan({
    siteId,
    brandName: site.name,
    primaryDomain: site.primaryDomain,
    business: site.business,
    searchCount: SEARCH_COUNT,
    analyzeCompetitors: 2,
    persist: true,
  });

  revalidatePath(`/sites/${siteId}`);
}
