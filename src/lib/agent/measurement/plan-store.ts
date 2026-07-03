import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/lib/db";
import { improvementTest, site as siteTable } from "@/lib/db/schema";
import { quickMeasure } from "./harness";
import type { ImprovementPlan } from "./planner";

// ─────────────────────────────────────────────────────────────────────
// Plan persistence + the periodic auto-compare that decides where to double
// down. Each test's KPI is a set of searches; we capture a baseline (which we
// appear on now), then weeks later re-measure and compare. Tests that gained
// appearances are the signal — those focus areas get doubled down; tests past
// their window with no gain are dropped. No scores — just which searches
// flipped from absent to present.
// ─────────────────────────────────────────────────────────────────────

/** Persist a plan's tests, capturing a baseline appearance count per KPI. */
export async function savePlan(
  siteId: string,
  brandName: string,
  primaryDomain: string,
  plan: ImprovementPlan,
): Promise<number> {
  let saved = 0;
  for (const area of plan.focusAreas) {
    for (const test of area.tests) {
      const queries = test.kpi.targetQueries.filter(Boolean);
      if (queries.length === 0) continue;
      const baseline = await quickMeasure({ brandName, primaryDomain, searches: queries });
      await db.insert(improvementTest).values({
        id: nanoid(),
        siteId,
        focusArea: area.title,
        hypothesis: test.hypothesis,
        action: test.action,
        kpiMetric: test.kpi.metric,
        kpiQueriesJson: JSON.stringify(queries),
        kpiTarget: test.kpi.target,
        windowDays: test.kpi.windowDays,
        status: "running",
        baselineHits: baseline.appearedQueries.length,
        baselineAppearedJson: JSON.stringify(baseline.appearedQueries),
      });
      saved++;
    }
  }
  return saved;
}

export interface TestEvaluation {
  id: string;
  focusArea: string;
  action: string;
  target: number;
  baselineHits: number;
  latestHits: number;
  gained: string[]; // searches we newly appear on
  lost: string[]; // searches we dropped
  met: boolean; // KPI target reached
  status: "won" | "running" | "dropped";
}

export interface DoubleDownResult {
  evaluations: TestEvaluation[];
  doubleDownOn: string[]; // focus areas with the most signal — invest more here
  dropped: string[]; // tests to stop
}

/**
 * Re-measure every running test's KPI searches, compare to baseline, and decide
 * where to double down. Batches all KPI searches into one measurement pass.
 */
export async function evaluateAndDoubleDown(
  siteId: string,
): Promise<DoubleDownResult> {
  const [s] = await db
    .select({ name: siteTable.name, primaryDomain: siteTable.primaryDomain })
    .from(siteTable)
    .where(eq(siteTable.id, siteId))
    .limit(1);
  if (!s) throw new Error(`Site not found: ${siteId}`);

  const tests = await db
    .select()
    .from(improvementTest)
    .where(
      and(
        eq(improvementTest.siteId, siteId),
        inArray(improvementTest.status, ["running", "proposed"]),
      ),
    );
  if (tests.length === 0) return { evaluations: [], doubleDownOn: [], dropped: [] };

  // One measurement pass over the union of all KPI searches.
  const allQueries = [
    ...new Set(tests.flatMap((t) => JSON.parse(t.kpiQueriesJson) as string[])),
  ];
  const measured = await quickMeasure({
    brandName: s.name,
    primaryDomain: s.primaryDomain,
    searches: allQueries,
  });
  const appearedNow = new Set(measured.appearedQueries);

  const now = Date.now();
  const evaluations: TestEvaluation[] = [];
  const signalByArea = new Map<string, number>();

  for (const t of tests) {
    const queries = JSON.parse(t.kpiQueriesJson) as string[];
    const baselineAppeared = new Set(
      (t.baselineAppearedJson ? JSON.parse(t.baselineAppearedJson) : []) as string[],
    );
    const latestAppeared = queries.filter((q) => appearedNow.has(q));
    const gained = latestAppeared.filter((q) => !baselineAppeared.has(q));
    const lost = [...baselineAppeared].filter((q) => !appearedNow.has(q));
    const met = latestAppeared.length >= t.kpiTarget;

    const ageDays = (now - t.createdAt.getTime()) / 86_400_000;
    const status: TestEvaluation["status"] = met
      ? "won"
      : ageDays >= t.windowDays && gained.length === 0
        ? "dropped"
        : "running";

    await db
      .update(improvementTest)
      .set({
        latestHits: latestAppeared.length,
        latestAppearedJson: JSON.stringify(latestAppeared),
        status,
        evaluatedAt: new Date(),
      })
      .where(eq(improvementTest.id, t.id));

    signalByArea.set(
      t.focusArea,
      (signalByArea.get(t.focusArea) ?? 0) + gained.length,
    );
    evaluations.push({
      id: t.id,
      focusArea: t.focusArea,
      action: t.action,
      target: t.kpiTarget,
      baselineHits: t.baselineHits ?? 0,
      latestHits: latestAppeared.length,
      gained,
      lost,
      met,
      status,
    });
  }

  // Double down on the focus areas that produced the most newly-won searches.
  const doubleDownOn = [...signalByArea.entries()]
    .filter(([, gain]) => gain > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([area]) => area);

  return {
    evaluations,
    doubleDownOn,
    dropped: evaluations.filter((e) => e.status === "dropped").map((e) => e.id),
  };
}
