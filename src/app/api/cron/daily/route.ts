import { NextResponse } from "next/server";
import { activeSites } from "@/lib/agent/loop/provision";
import { runDailyForSite } from "@/lib/agent/loop/daily";

// ─────────────────────────────────────────────────────────────────────
// Daily batch endpoint. Runs the visibility scan + autonomous loop for every
// active site. Intended to be hit once a day by a scheduler (Vercel Cron —
// see vercel.json). Guarded by CRON_SECRET so it can't be triggered publicly.
//
// Runs sites sequentially to stay within provider rate limits; each site's
// scan already batches its ~50 searches internally.
// ─────────────────────────────────────────────────────────────────────

export const maxDuration = 300; // seconds (Vercel function cap for the batch)

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
      const r = await runDailyForSite(site.id);
      results.push({
        site: site.name,
        appeared: `${r.scan.appeared}/${r.scan.total}`,
        actions: r.iterations.map((i) => `${i.status}(${i.changes ?? 0})`),
      });
    } catch (err) {
      results.push({
        site: site.name,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return NextResponse.json({ ran: sites.length, results });
}
