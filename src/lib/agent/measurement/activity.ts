import "server-only";
import { desc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/lib/db";
import { activity } from "@/lib/db/schema";

// ─────────────────────────────────────────────────────────────────────
// Activity feed — what Pigeon is doing, in plain English. The scan pipeline
// calls logActivity() at each step; the dashboard terminal polls recentActivity.
// Best-effort: a logging failure must never break a scan.
// ─────────────────────────────────────────────────────────────────────

export type ActivityKind = "start" | "info" | "done" | "error";

export interface ActivityLine {
  message: string;
  kind: ActivityKind;
  at: number;
}

export async function logActivity(
  siteId: string,
  message: string,
  kind: ActivityKind = "info",
): Promise<void> {
  try {
    await db.insert(activity).values({ id: nanoid(), siteId, message, kind });
  } catch {
    /* never break the scan on a logging hiccup */
  }
}

/** Recent lines, oldest→newest (chronological, ready to render top-to-bottom). */
export async function recentActivity(
  siteId: string,
  limit = 40,
): Promise<ActivityLine[]> {
  try {
    const rows = await db
      .select()
      .from(activity)
      .where(eq(activity.siteId, siteId))
      .orderBy(desc(activity.createdAt))
      .limit(limit);
    return rows
      .map((r) => ({
        message: r.message,
        kind: r.kind as ActivityKind,
        at: r.createdAt.getTime(),
      }))
      .reverse();
  } catch {
    return [];
  }
}
