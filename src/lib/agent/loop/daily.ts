import "server-only";
import { runVisibilityScan } from "@/lib/agent/measurement/harness";
import { resolveSite } from "./site";
import { runLoopIteration, markLoopRun, type LoopResult } from "./engine";

// ─────────────────────────────────────────────────────────────────────
// Daily orchestration for one site (called by the cron):
//   1. Full visibility scan (~50 searches) — the source-of-truth reading,
//      persisted with its diagnosis for the loop to plan from.
//   2. Up to `maxIterations` loop iterations — each picks one untried action,
//      applies it, targeted-re-measures, and keeps or rolls back.
//
// Bounded so one site can't run the loop unboundedly in a single day.
// ─────────────────────────────────────────────────────────────────────

const MAX_ITERATIONS = Number(process.env.LOOP_MAX_ITERATIONS_PER_DAY ?? 3);

export interface DailyResult {
  siteId: string;
  scan: { appeared: number; total: number };
  iterations: LoopResult[];
}

export async function runDailyForSite(siteId: string): Promise<DailyResult> {
  const site = await resolveSite(siteId);

  const scan = await runVisibilityScan({
    siteId,
    brandName: site.name,
    primaryDomain: site.primaryDomain,
    business: site.business,
    persist: true,
  });

  const iterations: LoopResult[] = [];
  if (site.config.autonomy !== "manual") {
    for (let i = 0; i < MAX_ITERATIONS; i++) {
      const r = await runLoopIteration(siteId);
      iterations.push(r);
      if (r.status === "nothing_to_do" || r.status === "paused") break;
    }
  }

  await markLoopRun(siteId);
  return {
    siteId,
    scan: { appeared: scan.appeared, total: scan.total },
    iterations,
  };
}
