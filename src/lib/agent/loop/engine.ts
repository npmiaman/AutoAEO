import "server-only";
import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { measurement, site as siteTable } from "@/lib/db/schema";
import {
  completeExperiment,
  fingerprintAttempt,
  findSimilarAttempts,
  hasTriedExact,
  recordExperiment,
} from "@/lib/agent/memory";
import { quickMeasure } from "@/lib/agent/measurement/harness";
import { generateSearchIdeas } from "@/lib/agent/measurement/searches";
import type { Diagnosis } from "@/lib/agent/measurement/diagnosis";
import { resolveSite, type ResolvedSite } from "./site";
import { ACTIONS } from "./actions/registry";
import type { ActionContext, ProposedArtifact } from "./actions/types";

// ─────────────────────────────────────────────────────────────────────
// The autonomous loop — one iteration.
//
//   1. Resolve site + latest diagnosis.
//   2. Pick the highest-impact applicable action the memory hasn't exhausted
//      (exact fingerprint + semantic recall of prior regressions).
//   3. Measure the targeted searches BEFORE (baseline winners).
//   4. Snapshot + apply the change.
//   5. Measure the SAME searches AFTER.
//   6. Verdict: gained searches with no losses → keep; else (if autoRollback)
//      revert. Either way, record the outcome to memory so we never repeat it.
//
// Attribution is deliberate: we credit/blame a change only via this targeted
// before/after re-measure, never the daily drift — background reranking by the
// AI engines must not be mistaken for the effect of our change.
// ─────────────────────────────────────────────────────────────────────

const SIMILAR_REGRESSION_THRESHOLD = 0.15; // cosine distance; closer = more similar

export type LoopStatus =
  | "kept"
  | "reverted"
  | "no_change"
  | "nothing_to_do"
  | "paused";

export interface LoopResult {
  status: LoopStatus;
  actionId?: string;
  hypothesis?: string;
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
  const ctx: ActionContext = { site, adapter: site.adapter, diagnosis };

  const pick = await selectAction(ctx, siteId);
  if (!pick) {
    return {
      status: "nothing_to_do",
      summary:
        "No untried, applicable action available. Memory has exhausted current options.",
    };
  }
  const { action, proposal, fingerprint } = pick;

  // Decide the searches we'll judge this change on.
  const targets = await resolveTargets(site, proposal);

  // BEFORE.
  const before = await quickMeasure({
    brandName: site.name,
    primaryDomain: site.primaryDomain,
    searches: targets,
  });
  const beforeSet = new Set(before.appearedQueries);

  // Record the attempt, snapshot, apply.
  const experimentId = await recordExperiment({
    siteId,
    playbook: action.id,
    hypothesis: proposal.hypothesis,
    fingerprint,
    status: "applied",
    change: proposal.artifact,
  });

  const snapshot = await site.adapter.snapshot(proposal.artifact);
  await site.adapter.apply(proposal.artifact);

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

  // Keep only a clean win; otherwise roll back (autonomous safety mechanism).
  if (verdict === "improved" || !site.config.autoRollback) {
    await completeExperiment(experimentId, {
      status: "kept",
      verdict,
      baselineAppeared: beforeSet.size,
      resultAppeared: afterSet.size,
      gained,
      lost,
      notes: `Kept ${action.title}. Gained: ${gained.join(", ") || "none"}.`,
    });
    return {
      status: verdict === "improved" ? "kept" : "no_change",
      actionId: action.id,
      hypothesis: proposal.hypothesis,
      gained,
      lost,
      summary:
        verdict === "improved"
          ? `Kept "${action.title}" — newly appearing on ${gained.length} search(es): ${gained.join(", ")}.`
          : `Kept "${action.title}" (no measured change; autoRollback off).`,
    };
  }

  // Revert.
  await site.adapter.revert(snapshot);
  await completeExperiment(experimentId, {
    status: "reverted",
    verdict,
    baselineAppeared: beforeSet.size,
    resultAppeared: afterSet.size,
    gained,
    lost,
    notes:
      verdict === "regressed"
        ? `Reverted ${action.title} — it LOST searches: ${lost.join(", ")}. Do not retry as-is.`
        : `Reverted ${action.title} — no measurable gain on targeted searches.`,
  });
  return {
    status: "reverted",
    actionId: action.id,
    hypothesis: proposal.hypothesis,
    gained,
    lost,
    summary: `Reverted "${action.title}" (${verdict}). Recorded as a dead end so it won't be retried.`,
  };
}

// ─── Action selection with memory dedup ──────────────────────────────

interface Pick {
  action: (typeof ACTIONS)[number];
  proposal: ProposedArtifact;
  fingerprint: string;
}

async function selectAction(
  ctx: ActionContext,
  siteId: string,
): Promise<Pick | null> {
  for (const action of ACTIONS) {
    if (!(await action.isApplicable(ctx))) continue;
    const proposals = await action.propose(ctx);
    for (const proposal of proposals) {
      const fingerprint = fingerprintAttempt({
        playbook: action.id,
        target: proposal.artifact.target,
        intent: proposal.intent,
      });

      // Exact dedup: skip anything already tried that didn't improve.
      const exact = await hasTriedExact(siteId, fingerprint);
      if (exact.tried && exact.verdict !== "improved") continue;

      // Semantic dedup: skip if we've tried something very similar that regressed.
      const similar = await findSimilarAttempts(siteId, proposal.hypothesis, 3);
      const nearRegression = similar.some(
        (s) =>
          s.verdict === "regressed" &&
          s.distance < SIMILAR_REGRESSION_THRESHOLD,
      );
      if (nearRegression) continue;

      return { action, proposal, fingerprint };
    }
  }
  return null;
}

// ─── Helpers ─────────────────────────────────────────────────────────

async function resolveTargets(
  site: ResolvedSite,
  proposal: ProposedArtifact,
): Promise<string[]> {
  if (proposal.targetQueries.length > 0) return proposal.targetQueries.slice(0, 20);
  // No targeted searches (e.g. no diagnosis yet) — generate a small set so the
  // before/after comparison still has something to measure.
  return generateSearchIdeas({ business: site.business, count: 10 });
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
