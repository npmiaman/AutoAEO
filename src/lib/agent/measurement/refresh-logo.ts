import "server-only";
import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { measurement, site as siteTable } from "@/lib/db/schema";
import { resolveOurLogo, type CompetitiveMap } from "./competitors";

// ─────────────────────────────────────────────────────────────────────
// Targeted "get my logo" — re-resolve ONLY our own logo and patch it into the
// latest measurement in place. No re-scan: none of the searches, competitors, or
// diagnosis are touched. This is the fallback for when the scan couldn't grab
// our logo (or grabbed a generic favicon) — cheap to retry on its own.
// ─────────────────────────────────────────────────────────────────────

export async function refreshOurLogo(
  siteId: string,
): Promise<{ ok: boolean; logoUrl: string | null }> {
  const [s] = await db
    .select({ primaryDomain: siteTable.primaryDomain })
    .from(siteTable)
    .where(eq(siteTable.id, siteId))
    .limit(1);
  if (!s) return { ok: false, logoUrl: null };

  const [m] = await db
    .select()
    .from(measurement)
    .where(eq(measurement.siteId, siteId))
    .orderBy(desc(measurement.createdAt))
    .limit(1);
  if (!m?.detailJson) return { ok: false, logoUrl: null };

  const logoUrl = await resolveOurLogo(s.primaryDomain);
  if (!logoUrl) return { ok: false, logoUrl: null };

  let detail: { competitors?: CompetitiveMap };
  try {
    detail = JSON.parse(m.detailJson);
  } catch {
    return { ok: false, logoUrl: null };
  }
  if (!detail.competitors) return { ok: false, logoUrl: null };

  detail.competitors.ourLogoUrl = logoUrl;
  await db
    .update(measurement)
    .set({ detailJson: JSON.stringify(detail) })
    .where(eq(measurement.id, m.id));

  return { ok: true, logoUrl };
}
