import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/lib/db";
import { measurement, scanJob, site as siteTable } from "@/lib/db/schema";
import { parseSiteConfig } from "@/lib/agent/site/config";
import { generateSearchIdeas } from "./searches";
import { submitSearchBatch, retrieveSearchBatch } from "./engines/openai-batch";
import { finalizeScan, runVisibilityScan } from "./harness";

// ─────────────────────────────────────────────────────────────────────
// Async batch scan. All grounded searches for a site go up as ONE OpenAI Batch
// job (full attention per query, ~50% cheaper). A scan_job tracks the batch;
// when it completes we parse the output and finalize a measurement. Scans run
// on a cadence (every few days), so async is the natural fit.
// ─────────────────────────────────────────────────────────────────────

type SiteRow = typeof siteTable.$inferSelect;
type JobRow = typeof scanJob.$inferSelect;

function siteBusiness(s: SiteRow): string {
  return parseSiteConfig(s.configJson).business ?? `${s.name} (${s.primaryDomain})`;
}

/** The latest still-running scan job for a site, or null. */
export async function runningScanJob(siteId: string): Promise<JobRow | null> {
  const [j] = await db
    .select()
    .from(scanJob)
    .where(and(eq(scanJob.siteId, siteId), eq(scanJob.status, "running")))
    .orderBy(desc(scanJob.createdAt))
    .limit(1);
  return j ?? null;
}

/** Has this site ever produced a measurement? */
async function hasPriorScan(siteId: string): Promise<boolean> {
  const [m] = await db
    .select({ id: measurement.id })
    .from(measurement)
    .where(eq(measurement.siteId, siteId))
    .limit(1);
  return !!m;
}

/**
 * Kick off a scan, choosing HOW based on whether it's the site's first one:
 *   - first scan  → run synchronously so onboarding shows results immediately.
 *   - every scan after → OpenAI Batch API (async, ~50% cheaper, cadence-friendly).
 * Returns which path ran; batch path also returns the tracking jobId.
 */
export async function startScan(
  siteId: string,
): Promise<{ mode: "sync" | "batch"; jobId?: string }> {
  const existing = await runningScanJob(siteId);
  if (existing) return { mode: "batch", jobId: existing.id };

  if (await hasPriorScan(siteId)) {
    const { jobId } = await startBatchScan(siteId);
    return { mode: "batch", jobId };
  }

  // First scan: run it live.
  const [s] = await db
    .select()
    .from(siteTable)
    .where(eq(siteTable.id, siteId))
    .limit(1);
  if (!s) throw new Error(`Site not found: ${siteId}`);

  await runVisibilityScan({
    siteId,
    brandName: s.name,
    primaryDomain: s.primaryDomain,
    business: siteBusiness(s),
    analyzeCompetitors: 3,
    persist: true,
  });
  return { mode: "sync" };
}

/**
 * Submit a scan for a site as one batch job. No-op (returns the existing job)
 * if one is already running, so we never double-charge.
 */
export async function startBatchScan(
  siteId: string,
): Promise<{ jobId: string }> {
  const existing = await runningScanJob(siteId);
  if (existing) return { jobId: existing.id };

  const [s] = await db
    .select()
    .from(siteTable)
    .where(eq(siteTable.id, siteId))
    .limit(1);
  if (!s) throw new Error(`Site not found: ${siteId}`);

  const searches = await generateSearchIdeas({ business: siteBusiness(s) });
  const batchId = await submitSearchBatch(searches);

  const id = nanoid();
  await db.insert(scanJob).values({
    id,
    siteId,
    status: "running",
    batchId,
    searchesJson: JSON.stringify(searches),
  });
  return { jobId: id };
}

async function markFailed(id: string, error: string): Promise<void> {
  await db
    .update(scanJob)
    .set({ status: "failed", error, completedAt: new Date() })
    .where(eq(scanJob.id, id));
}

/**
 * Check a running job's batch. If the batch is done, parse it and finalize a
 * measurement. Safe to call repeatedly (polling) — returns the current status.
 */
export async function finalizeScanJob(
  job: JobRow,
): Promise<"running" | "completed" | "failed"> {
  if (job.status !== "running")
    return job.status as "completed" | "failed";

  const [s] = await db
    .select()
    .from(siteTable)
    .where(eq(siteTable.id, job.siteId))
    .limit(1);
  if (!s) {
    await markFailed(job.id, "site removed");
    return "failed";
  }

  const searches = JSON.parse(job.searchesJson) as string[];
  let res;
  try {
    res = await retrieveSearchBatch(job.batchId, searches);
  } catch {
    return "running"; // transient — check again next poll
  }
  if (res.status === "running") return "running";
  if (res.status === "failed" || !res.results) {
    await markFailed(job.id, "batch failed");
    return "failed";
  }

  const scan = await finalizeScan({
    input: {
      siteId: job.siteId,
      brandName: s.name,
      primaryDomain: s.primaryDomain,
      business: siteBusiness(s),
      analyzeCompetitors: 3,
      persist: true,
    },
    searches,
    raw: res.results,
    engineNames: ["openai"],
  });

  await db
    .update(scanJob)
    .set({
      status: "completed",
      measurementId: scan.measurementId,
      completedAt: new Date(),
    })
    .where(eq(scanJob.id, job.id));
  return "completed";
}

/** Finalize a site's running job if it has one (dashboard poll entry point). */
export async function pollSiteScan(
  siteId: string,
): Promise<"idle" | "running" | "completed" | "failed"> {
  const job = await runningScanJob(siteId);
  if (!job) return "idle";
  return finalizeScanJob(job);
}
