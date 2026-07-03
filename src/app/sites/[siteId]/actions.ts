"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { site as siteTable } from "@/lib/db/schema";
import { startBatchScan } from "@/lib/agent/measurement/batch-scan";

export async function runScan(siteId: string): Promise<void> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/signin");

  const [owned] = await db
    .select({ id: siteTable.id })
    .from(siteTable)
    .where(and(eq(siteTable.id, siteId), eq(siteTable.userId, session.user.id)))
    .limit(1);
  if (!owned) redirect("/dashboard");

  // Submit all searches as one OpenAI Batch job (async). The dashboard polls
  // and finalizes when the batch completes.
  await startBatchScan(siteId);
  revalidatePath(`/sites/${siteId}`);
}
