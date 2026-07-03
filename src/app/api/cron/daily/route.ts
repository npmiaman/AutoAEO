import { NextResponse } from "next/server";
import { activeSites } from "@/lib/agent/loop/provision";
import { runScanCadenceForSite } from "@/lib/agent/loop/daily";

// ─────────────────────────────────────────────────────────────────────
// Scan-cadence cron. For every active site it finalizes any completed batch
// scan and submits a new one if the last scan is older than the cadence
// (SCAN_CADENCE_DAYS). Meant to run daily (Vercel Cron — see vercel.json);
// the cadence gate means each site actually re-scans every few days.
// Guarded by CRON_SECRET.
// ─────────────────────────────────────────────────────────────────────

export const maxDuration = 300;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (secret && auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const sites = await activeSites();
  const results: Array<Record<string, unknown>> = [];
  for (const site of sites) {
    try {
      const r = await runScanCadenceForSite(site.id);
      results.push({ site: site.name, action: r.action });
    } catch (err) {
      results.push({
        site: site.name,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return NextResponse.json({ ran: sites.length, results });
}
