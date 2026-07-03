/**
 * AutoAEO improvement plan — CLI.
 *
 * Runs a full scan, then produces the ranking map, focus signals, and an
 * experiment plan: overall strategies → focus areas → multiple tests, each
 * with a KPI tied to specific searches (for the periodic auto-compare loop).
 *
 *   npm run plan -- --business "..." --brand "..." --domain example.com --count 15
 */
import { runVisibilityScan } from "@/lib/agent/measurement/harness";
import { buildImprovementPlan } from "@/lib/agent/measurement/planner";

function arg(name: string, fallback?: string): string {
  const i = process.argv.indexOf(`--${name}`);
  if (i !== -1 && process.argv[i + 1]) return process.argv[i + 1];
  if (fallback !== undefined) return fallback;
  throw new Error(`Missing required --${name}`);
}

async function main() {
  const business = arg("business");
  const brandName = arg("brand");
  const primaryDomain = arg("domain");
  const count = Number(arg("count", "15"));

  console.log(`\n🔎 Scanning ${brandName} (${primaryDomain})…\n`);
  const scan = await runVisibilityScan({
    siteId: "cli-plan",
    brandName,
    primaryDomain,
    business,
    searchCount: count,
    persist: false,
    analyzeCompetitors: 3,
  });

  const c = scan.competitors;
  console.log("═".repeat(64));
  console.log(`  RANKING MAP — we appear on ${c.ourAppearances}/${c.totalSearches} searches`);
  console.log("═".repeat(64));
  for (const q of c.rankings) {
    const us = q.ourPosition ? `WE #${q.ourPosition}` : "WE —";
    const others = q.ranked
      .filter((p) => !p.isUs)
      .slice(0, 5)
      .map((p) => `${p.position}.${p.name}`)
      .join("  ");
    console.log(`  ${us.padEnd(7)} | ${q.query}`);
    if (others) console.log(`          └ ${others}`);
  }

  console.log("\nFOCUS SIGNALS:");
  console.log(`  quick wins (absent, no strong rival): ${c.focus.quickWins.length}`);
  c.focus.quickWins.forEach((q) => console.log(`     ○ ${q}`));
  console.log(`  we already win: ${c.focus.ourWins.length}  ·  entrenched (hard): ${c.focus.entrenched.length}`);

  const plan = await buildImprovementPlan({
    brandName,
    domain: primaryDomain,
    business,
    competitors: c,
    diagnosis: scan.diagnosis,
  });

  console.log("\n" + "═".repeat(64));
  console.log("  IMPROVEMENT PLAN");
  console.log("═".repeat(64));
  console.log("\nOVERALL STRATEGIES:");
  plan.overallStrategies.forEach((s) => console.log(`  • ${s}`));

  for (const area of plan.focusAreas) {
    console.log(`\n▸ [${area.signal}] ${area.title}`);
    console.log(`  ${area.rationale}`);
    area.tests.forEach((t, i) => {
      console.log(`  Test ${i + 1}: ${t.action}`);
      console.log(`     hypothesis: ${t.hypothesis}`);
      console.log(
        `     KPI: ${t.kpi.metric} — appear on ≥${t.kpi.target} of [${t.kpi.targetQueries.join(
          " | ",
        )}] within ${t.kpi.windowDays}d`,
      );
    });
  }
  console.log("");
}

main().catch((e) => {
  console.error("\nPlan failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
