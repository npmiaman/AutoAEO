"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { site as siteTable } from "@/lib/db/schema";
import { refreshOurLogo } from "@/lib/agent/measurement/refresh-logo";

// Re-fetch ONLY our own logo and patch it into the latest scan — no full rescan.
export async function refreshLogo(siteId: string): Promise<void> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/signin");

  const [owned] = await db
    .select({ id: siteTable.id })
    .from(siteTable)
    .where(and(eq(siteTable.id, siteId), eq(siteTable.userId, session.user.id)))
    .limit(1);
  if (!owned) redirect("/dashboard");

  await refreshOurLogo(siteId);
  revalidatePath(`/sites/${siteId}`);
}
