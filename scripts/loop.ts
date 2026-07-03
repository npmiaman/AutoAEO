/**
 * Run the daily scan + autonomous loop for one connected site (for testing
 * the full apply/measure/rollback cycle once a store is connected).
 *
 * Usage:  npm run loop -- --site <siteId>
 *
 * Needs the DB migrated, a provisioned `site` row (created on Shopify install),
 * and OPENAI_API_KEY. This actually writes to and reverts changes on the live
 * store, so point it at a dev store first.
 */
import { runDailyForSite } from "@/lib/agent/loop/daily";

function arg(name: string): string {
  const i = process.argv.indexOf(`--${name}`);
  if (i !== -1 && process.argv[i + 1]) return process.argv[i + 1];
  throw new Error(`Missing required --${name}`);
}

async function main() {
  const siteId = arg("site");
  console.log(`\n🔁 Running daily scan + loop for site ${siteId}…\n`);
  const r = await runDailyForSite(siteId);
  console.log(`Scan: appeared in ${r.scan.appeared}/${r.scan.total} searches.`);
  console.log(`\nLoop iterations:`);
  if (r.iterations.length === 0) console.log("  (autonomy is manual — no actions taken)");
  for (const it of r.iterations) {
    console.log(`  • [${it.status}] ${it.actionId ?? "-"} — ${it.summary}`);
    if (it.gained?.length) console.log(`      gained: ${it.gained.join(", ")}`);
    if (it.lost?.length) console.log(`      lost:   ${it.lost.join(", ")}`);
  }
  console.log("");
}

main().catch((e) => {
  console.error("\nLoop failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
