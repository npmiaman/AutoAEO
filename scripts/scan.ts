/**
 * AutoAEO visibility scan — CLI demo.
 *
 * Runs the full autoresearch pipeline on ANY business (no Shopify needed):
 *   generate ~N real searches → grounded AI-engine queries → who-ranks
 *   extraction → strategy-grounded LLM diagnosis → printed report.
 *
 * Usage:
 *   npm run scan -- --business "a plumber in Columbus, Ohio" \
 *                   --brand "The Eco Plumbers" --domain ecoplumbers.com \
 *                   --count 15
 *
 * Requires OPENAI_API_KEY in .env.local. Does not write to the database.
 */
import { runVisibilityScan } from "@/lib/agent/measurement/harness";

function arg(name: string, fallback?: string): string {
  const i = process.argv.indexOf(`--${name}`);
  if (i !== -1 && process.argv[i + 1]) return process.argv[i + 1];
  if (fallback !== undefined) return fallback;
  throw new Error(`Missing required --${name}`);
}

function pct(n: number, d: number): string {
  return d === 0 ? "0%" : `${Math.round((n / d) * 100)}%`;
}

async function main() {
  const business = arg("business");
  const brandName = arg("brand");
  const primaryDomain = arg("domain");
  const count = Number(arg("count", "15"));

  console.log(`\n🔎 AutoAEO visibility scan`);
  console.log(`   Business: ${business}`);
  console.log(`   Testing:  ${brandName} (${primaryDomain})`);
  console.log(`   Searches: ${count}\n`);
  console.log(`Running… (grounded live searches, this takes a minute)\n`);

  const r = await runVisibilityScan({
    siteId: "cli-demo",
    brandName,
    primaryDomain,
    business,
    searchCount: count,
    persist: false,
    analyzeCompetitors: Number(arg("competitors", "3")),
  });

  console.log("═".repeat(64));
  console.log(
    `  APPEAR IN ${r.appeared}/${r.total} AI SEARCHES (${pct(
      r.appeared,
      r.total,
    )})   ·   engines: ${r.engines.join(", ")}`,
  );
  console.log("═".repeat(64));

  console.log("\nPER SEARCH:");
  for (const o of r.outcomes) {
    const tag = o.error
      ? "ERR"
      : o.appeared
        ? `#${o.position ?? "cited"}${o.cited ? " 🔗" : ""}`
        : "—";
    console.log(`  ${o.appeared ? "✅" : "❌"}  ${tag.padEnd(9)} ${o.query}`);
    if (!o.appeared && o.rankedEntities.length)
      console.log(`             winners: ${o.rankedEntities.slice(0, 5).join(" · ")}`);
  }

  const c = r.competitors;
  console.log("\n" + "─".repeat(64));
  console.log("RANKING MAP (where we stand + who ranks where):");
  for (const q of c.rankings) {
    const us = q.ourPosition ? `WE #${q.ourPosition}` : "WE —";
    const others = q.ranked
      .filter((p) => !p.isUs)
      .slice(0, 5)
      .map((p) => p.name)
      .join(" · ");
    console.log(`  ${us.padEnd(7)} | ${q.query}`);
    if (others) console.log(`          └ ${others}`);
  }

  console.log(
    `\nQUICK-WIN WHITESPACE — ${c.focus.quickWins.length} search(es), no strong rival (win first):`,
  );
  for (const q of c.focus.quickWins) console.log(`  ○ ${q}`);

  if (c.basis.length) {
    console.log("\nWHY THE LEADERS RANK (and how to beat them):");
    for (const b of c.basis) {
      console.log(`  ▸ ${b.name}${b.url ? `  (${b.url})` : ""}`);
      b.factors.slice(0, 2).forEach((f) => console.log(`      why: ${f}`));
      b.howToBeat.slice(0, 2).forEach((h) => console.log(`      beat: ${h}`));
    }
  }

  const dx = r.diagnosis;
  console.log("\n" + "─".repeat(64));
  console.log("WHY WE WIN THE ONES WE WIN:");
  dx.whatWorks.forEach((w) => console.log(`  • ${w}`));
  console.log("\nWHAT'S MISSING (where we don't show up):");
  dx.whatsMissing.forEach((w) => console.log(`  • ${w}`));
  console.log("\nDOUBLE DOWN (recommended actions):");
  dx.recommendations.forEach((rec, i) => {
    console.log(`  ${i + 1}. [${rec.kind}] ${rec.action}`);
    console.log(`     why: ${rec.rationale}`);
    if (rec.exampleQueries.length)
      console.log(`     targets: ${rec.exampleQueries.join(" | ")}`);
  });
  console.log("");
}

main().catch((e) => {
  console.error("\nScan failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
