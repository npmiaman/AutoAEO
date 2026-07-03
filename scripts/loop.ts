/**
 * Run the scan cadence for one site — submits a batch scan if due, and
 * finalizes a running batch if its job has completed.
 *
 * Usage:  npm run loop -- --site <siteId>
 *
 * Needs the DB migrated, a provisioned `site` row, and OPENAI_API_KEY. Because
 * scans run on the async Batch API, a submit won't have results immediately —
 * run it again in a few minutes to finalize.
 */
import { runScanCadenceForSite } from "@/lib/agent/loop/daily";

function arg(name: string): string {
  const i = process.argv.indexOf(`--${name}`);
  if (i !== -1 && process.argv[i + 1]) return process.argv[i + 1];
  throw new Error(`Missing required --${name}`);
}

async function main() {
  const siteId = arg("site");
  console.log(`\n🔁 Scan cadence for site ${siteId}…\n`);
  const r = await runScanCadenceForSite(siteId);
  console.log(`  → ${r.action}`);
  if (r.action === "submitted")
    console.log("  Batch submitted. Run again in a few minutes to finalize.");
  console.log("");
}

main().catch((e) => {
  console.error("\nFailed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
