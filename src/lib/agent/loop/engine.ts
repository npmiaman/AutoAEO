import "server-only";
import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { measurement, site as siteTable } from "@/lib/db/schema";
import {
  completeExperiment,
  fingerprintAttempt,
  recordExperiment,
} from "@/lib/agent/memory";
import { quickMeasure } from "@/lib/agent/measurement/harness";
import { generateSearchIdeas } from "@/lib/agent/measurement/searches";
import type { Diagnosis } from "@/lib/agent/measurement/diagnosis";
import { resolveSite, type ResolvedSite } from "./site";
import { runOptimizationAgent } from "./agent";

// ─────────────────────────────────────────────────────────────────────
// The autonomous loop — one iteration, agent-driven.
//
//   1. Resolve site + latest diagnosis.
//   2. Measure the targeted searches BEFORE (baseline appearance set).
//   3. Run the optimization agent — it freely composes tools to make a focused
//      change (mutations are applied live and snapshotted).
//   4. Measure the SAME searches AFTER.
//   5. Verdict: gained searches with no losses → keep; else (if autoRollback)
//      revert every mutation. Record the outcome to memory either way, so the
//      agent's recall_memory keeps it from repeating dead ends.
//
// Attribution is via this targeted before/after only — never the daily drift —
// so background AI reranking isn't mistaken for the change's effect.
// ─────────────────────────────────────────────────────────────────────

export type LoopStatus =
  | "kept"
  | "reverted"
  | "no_change"
  | "nothing_to_do"
  | "paused";

export interface LoopResult {
  status: LoopStatus;
  hypothesis?: string;
  changes?: number;
  gained?: string[];
  lost?: string[];
  summary: string;
}

export async function runLoopIteration(siteId: string): Promise<LoopResult> {
  const site = await resolveSite(siteId);
  if (site.config.paused) {
    return { status: "paused", summary: "Loop is paused for this site." };
  }

  const diagnosis = await loadLatestDiagnosis(siteId);
  const targets = await resolveTargets(site, diagnosis);

  // BEFORE.
  const before = await quickMeasure({
    brandName: site.name,
    primaryDomain: site.primaryDomain,
    searches: targets,
  });
  const beforeSet = new Set(before.appearedQueries);

  // The agent acts (applies + snapshots mutations live).
  const run = await runOptimizationAgent({
    site,
    adapter: site.adapter,
    diagnosis,
  });

  if (run.mutations.length === 0) {
    return {
      status: "nothing_to_do",
      summary: `Agent made no changes: ${run.summary}`,
    };
  }

  // Record the attempt now that we know what was changed.
  const fingerprint = fingerprintAttempt({
    playbook: "agent",
    target: run.mutations.map((m) => m.artifact.target).sort().join("|"),
    intent: run.mutations.map((m) => m.intent).sort().join("|"),
  });
  const experimentId = await recordExperiment({
    siteId,
    playbook: "agent",
    hypothesis: run.summary,
    fingerprint,
    status: "applied",
    change: run.mutations.map((m) => m.artifact),
    snapshot: run.mutations.map((m) => m.snapshot),
  });

  // AFTER (same searches).
  const after = await quickMeasure({
    brandName: site.name,
    primaryDomain: site.primaryDomain,
    searches: targets,
  });
  const afterSet = new Set(after.appearedQueries);

  const gained = [...afterSet].filter((q) => !beforeSet.has(q));
  const lost = [...beforeSet].filter((q) => !afterSet.has(q));
  const verdict =
    gained.length > 0 && lost.length === 0
      ? "improved"
      : lost.length > 0
        ? "regressed"
        : "no_change";

  if (verdict === "improved" || !site.config.autoRollback) {
    await completeExperiment(experimentId, {
      status: "kept",
      verdict,
      baselineAppeared: beforeSet.size,
      resultAppeared: afterSet.size,
      gained,
      lost,
      notes: `Kept: ${run.summary}. Gained: ${gained.join(", ") || "none"}.`,
    });
    return {
      status: verdict === "improved" ? "kept" : "no_change",
      hypothesis: run.summary,
      changes: run.mutations.length,
      gained,
      lost,
      summary:
        verdict === "improved"
          ? `Kept change — newly appearing on ${gained.length} search(es): ${gained.join(", ")}.`
          : `Kept change (no measured delta; autoRollback off).`,
    };
  }

  // Revert every mutation, newest first.
  for (const m of [...run.mutations].reverse()) {
    try {
      await site.adapter.revert(m.snapshot);
    } catch (err) {
      console.error("Revert failed for", m.artifact.target, err);
    }
  }
  await completeExperiment(experimentId, {
    status: "reverted",
    verdict,
    baselineAppeared: beforeSet.size,
    resultAppeared: afterSet.size,
    gained,
    lost,
    notes:
      verdict === "regressed"
        ? `Reverted — LOST searches: ${lost.join(", ")}. Approach: ${run.summary}. Do not retry as-is.`
        : `Reverted — no measurable gain. Approach: ${run.summary}.`,
  });
  return {
    status: "reverted",
    hypothesis: run.summary,
    changes: run.mutations.length,
    gained,
    lost,
    summary: `Reverted change (${verdict}). Recorded as a dead end so the agent won't retry it.`,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────

async function resolveTargets(
  site: ResolvedSite,
  diagnosis?: Diagnosis,
): Promise<string[]> {
  if (diagnosis) {
    // Gaps we want to win + current winners (to catch regressions), capped.
    const set = [...diagnosis.missingOn, ...diagnosis.rankedOn];
    if (set.length > 0) return dedupe(set).slice(0, 20);
  }
  return generateSearchIdeas({ business: site.business, count: 10 });
}

function dedupe(list: string[]): string[] {
  return [...new Set(list.map((s) => s.trim()).filter(Boolean))];
}

async function loadLatestDiagnosis(
  siteId: string,
): Promise<Diagnosis | undefined> {
  const [row] = await db
    .select({ detailJson: measurement.detailJson })
    .from(measurement)
    .where(eq(measurement.siteId, siteId))
    .orderBy(desc(measurement.createdAt))
    .limit(1);
  if (!row?.detailJson) return undefined;
  try {
    const parsed = JSON.parse(row.detailJson) as { diagnosis?: Diagnosis };
    return parsed.diagnosis;
  } catch {
    return undefined;
  }
}

// Touch lastLoopAt so the scheduler knows the site was serviced.
export async function markLoopRun(siteId: string): Promise<void> {
  await db
    .update(siteTable)
    .set({ lastLoopAt: new Date() })
    .where(eq(siteTable.id, siteId));
}
