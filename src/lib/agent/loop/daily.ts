import "server-only";
import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { measurement } from "@/lib/db/schema";
import {
  runningScanJob,
  startBatchScan,
  finalizeScanJob,
} from "@/lib/agent/measurement/batch-scan";

// ─────────────────────────────────────────────────────────────────────
// Scan cadence (called by the cron). Per site:
//   1. If a batch scan is running, try to finalize it (the batch may be done).
//   2. Otherwise, if the last scan is older than the cadence, submit a new one.
//
// Scans are asynchronous OpenAI Batch jobs, so the cron both submits new scans
// and finalizes ones whose batches have completed since the last run.
// ─────────────────────────────────────────────────────────────────────

const CADENCE_DAYS = Number(process.env.SCAN_CADENCE_DAYS ?? 3);

export interface CadenceResult {
  siteId: string;
  action: "finalized-running" | "finalized-completed" | "finalized-failed" | "submitted" | "idle";
}

export async function runScanCadenceForSite(
  siteId: string,
): Promise<CadenceResult> {
  // 1. Finalize a running job if its batch is done.
  const running = await runningScanJob(siteId);
  if (running) {
    const status = await finalizeScanJob(running);
    return {
      siteId,
      action:
        status === "completed"
          ? "finalized-completed"
          : status === "failed"
            ? "finalized-failed"
            : "finalized-running",
    };
  }

  // 2. Submit a new scan if the last one is older than the cadence.
  const [latest] = await db
    .select({ createdAt: measurement.createdAt })
    .from(measurement)
    .where(eq(measurement.siteId, siteId))
    .orderBy(desc(measurement.createdAt))
    .limit(1);

  const dueMs = CADENCE_DAYS * 86_400_000;
  const isDue = !latest || Date.now() - latest.createdAt.getTime() > dueMs;
  if (isDue) {
    await startBatchScan(siteId);
    return { siteId, action: "submitted" };
  }

  return { siteId, action: "idle" };
}
