import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/lib/db";
import { measurement, scanJob, site as siteTable } from "@/lib/db/schema";
import { parseSiteConfig } from "@/lib/agent/site/config";
import { generateSearchIdeas } from "./searches";
import { submitSearchBatch, retrieveSearchBatch } from "./engines/openai-batch";
import { finalizeScan, runVisibilityScan } from "./harness";
import { getCachedResults, putCachedResult } from "./search-cache";
import { logActivity } from "./activity";
import type { EngineQueryResult } from "./engines/types";

// If a scan already ran this recently, reuse it instead of scanning again.
const FRESH_MS = Number(process.env.SCAN_FRESH_HOURS ?? 6) * 60 * 60 * 1000;
// How long a site's generated search set is reused (a "scan session") before it
// regenerates — long enough that a stopped scan resumes on the same queries.
const SEARCH_SET_TTL_MS =
  Number(process.env.SEARCH_SET_TTL_HOURS ?? 24) * 60 * 60 * 1000;
const norm = (q: string) => q.trim().toLowerCase();

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

/** When the site last produced a measurement, or null if never. */
async function latestMeasurementAt(siteId: string): Promise<Date | null> {
  const [m] = await db
    .select({ createdAt: measurement.createdAt })
    .from(measurement)
    .where(eq(measurement.siteId, siteId))
    .orderBy(desc(measurement.createdAt))
    .limit(1);
  return m?.createdAt ?? null;
}

/**
 * Kick off a scan, choosing HOW:
 *   - a fresh scan already exists (ran in the last few hours) → reuse it, don't
 *     scan again ("cached").
 *   - first scan → run synchronously so onboarding shows results immediately.
 *   - every scan after → OpenAI Batch API (async, ~50% cheaper). The batch only
 *     submits queries missing from the cache, so a stopped/partial run resumes.
 * Returns which path ran; batch path also returns the tracking jobId.
 */
export async function startScan(
  siteId: string,
): Promise<{ mode: "sync" | "batch" | "cached"; jobId?: string }> {
  const existing = await runningScanJob(siteId);
  if (existing) return { mode: "batch", jobId: existing.id };

  const last = await latestMeasurementAt(siteId);
  if (last && Date.now() - last.getTime() < FRESH_MS) {
    return { mode: "cached" }; // scanned recently — serve the existing result
  }

  const [s] = await db
    .select()
    .from(siteTable)
    .where(eq(siteTable.id, siteId))
    .limit(1);
  if (!s) throw new Error(`Site not found: ${siteId}`);

  await logActivity(
    siteId,
    last
      ? "Starting a fresh scan of your site…"
      : "Starting my deep dive — crawling all your pages…",
    "start",
  );

  // Resolve the search set ONCE and reuse it, so a resumed scan hits the cache.
  const searches = await resolveSearchSet(s);

  if (last) {
    const { jobId } = await startBatchScan(siteId, searches, s);
    return { mode: "batch", jobId };
  }

  // First scan: run it live.
  await runVisibilityScan({
    siteId,
    brandName: s.name,
    primaryDomain: s.primaryDomain,
    business: siteBusiness(s),
    searches,
    analyzeCompetitors: 3,
    persist: true,
  });
  return { mode: "sync" };
}

/**
 * The site's search set — reused within its TTL so a scan that stopped part-way
 * resumes on the SAME queries (which the per-query cache then satisfies) rather
 * than regenerating a different set. Persisted on the site config.
 */
async function resolveSearchSet(s: SiteRow): Promise<string[]> {
  const config = parseSiteConfig(s.configJson);
  if (
    config.searchSet?.length &&
    config.searchSetAt &&
    Date.now() - config.searchSetAt < SEARCH_SET_TTL_MS
  ) {
    return config.searchSet;
  }
  const searches = await generateSearchIdeas({ business: siteBusiness(s) });
  await db
    .update(siteTable)
    .set({
      configJson: JSON.stringify({
        ...config,
        searchSet: searches,
        searchSetAt: Date.now(),
      }),
    })
    .where(eq(siteTable.id, s.id));
  return searches;
}

/**
 * Submit a scan for a site as one batch job. No-op (returns the existing job)
 * if one is already running, so we never double-charge.
 */
export async function startBatchScan(
  siteId: string,
  searchSet?: string[],
  siteRow?: SiteRow,
): Promise<{ jobId: string }> {
  const existing = await runningScanJob(siteId);
  if (existing) return { jobId: existing.id };

  const s =
    siteRow ??
    (
      await db
        .select()
        .from(siteTable)
        .where(eq(siteTable.id, siteId))
        .limit(1)
    )[0];
  if (!s) throw new Error(`Site not found: ${siteId}`);

  const searches = searchSet ?? (await resolveSearchSet(s));

  // Only submit queries we don't already have a fresh grounded result for — so a
  // scan that stopped part-way resumes on the ones still missing.
  const cached = await getCachedResults("openai", searches);
  const misses = searches.filter((q) => !cached.has(norm(q)));

  const scanInput = {
    siteId,
    brandName: s.name,
    primaryDomain: s.primaryDomain,
    business: siteBusiness(s),
    analyzeCompetitors: 3,
    persist: true,
  };

  // Everything already cached → no batch needed, finalize straight away.
  if (misses.length === 0) {
    const raw = searches.map((q) => cached.get(norm(q))!);
    const scan = await finalizeScan({
      input: scanInput,
      searches,
      raw,
      engineNames: ["openai"],
    });
    const id = nanoid();
    await db.insert(scanJob).values({
      id,
      siteId,
      status: "completed",
      batchId: "cache",
      searchesJson: JSON.stringify(searches),
      submittedJson: JSON.stringify([]),
      measurementId: scan.measurementId,
      completedAt: new Date(),
    });
    return { jobId: id };
  }

  const batchId = await submitSearchBatch(misses);
  const id = nanoid();
  await db.insert(scanJob).values({
    id,
    siteId,
    status: "running",
    batchId,
    searchesJson: JSON.stringify(searches), // full set the scan covers
    submittedJson: JSON.stringify(misses), // just the cache-misses in this batch
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

  const searches = JSON.parse(job.searchesJson) as string[]; // full set
  const submitted = job.submittedJson
    ? (JSON.parse(job.submittedJson) as string[])
    : searches; // legacy jobs submitted the whole set
  let res;
  try {
    res = await retrieveSearchBatch(job.batchId, submitted);
  } catch {
    return "running"; // transient — check again next poll
  }
  if (res.status === "running") return "running";
  if (res.status === "failed" || !res.results) {
    await markFailed(job.id, "batch failed");
    return "failed";
  }

  // Cache the freshly-batched results so a future scan reuses them.
  await Promise.all(
    res.results.map((r) => putCachedResult("openai", r.query, r)),
  );

  // Merge: batched results for the submitted misses + cached results for the
  // rest, reassembled in the full search order.
  const bySubmitted = new Map(res.results.map((r) => [norm(r.query), r]));
  const cached = await getCachedResults("openai", searches);
  const raw: EngineQueryResult[] = searches.map((q) => {
    const k = norm(q);
    return (
      bySubmitted.get(k) ??
      cached.get(k) ?? {
        engine: "openai",
        query: q,
        answerText: "",
        citations: [],
        error: "missing result",
      }
    );
  });

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
    raw,
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
