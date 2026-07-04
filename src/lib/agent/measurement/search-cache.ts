import "server-only";
import { inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { searchCache } from "@/lib/db/schema";
import type { EngineQueryResult } from "./engines/types";

// ─────────────────────────────────────────────────────────────────────
// Grounded-search cache. Each (engine, query) grounded call is stored so that:
//   • a scan that stops after N calls can resume — the N are reused, only the
//     remaining ones run (no starting from scratch);
//   • a scan that runs again within the TTL reuses fresh results instead of
//     re-calling the model.
// Keyed by (engine, normalized query) because a query's grounded answer doesn't
// depend on which site is being tested. Errors are never cached (so they retry).
// ─────────────────────────────────────────────────────────────────────

const TTL_MS =
  Number(process.env.SEARCH_CACHE_TTL_HOURS ?? 6) * 60 * 60 * 1000;

function norm(query: string): string {
  return query.trim().toLowerCase();
}
function keyOf(engine: string, query: string): string {
  return `${engine}::${norm(query)}`;
}

/** Fresh cached results for these queries on one engine, keyed by normalized query. */
export async function getCachedResults(
  engine: string,
  queries: string[],
  ttlMs: number = TTL_MS,
): Promise<Map<string, EngineQueryResult>> {
  const out = new Map<string, EngineQueryResult>();
  if (queries.length === 0) return out;

  const keys = queries.map((q) => keyOf(engine, q));
  const rows = await db
    .select()
    .from(searchCache)
    .where(inArray(searchCache.key, keys));

  const cutoff = Date.now() - ttlMs;
  for (const r of rows) {
    if (r.createdAt.getTime() < cutoff) continue; // stale → treat as a miss
    try {
      out.set(norm(r.query), JSON.parse(r.resultJson) as EngineQueryResult);
    } catch {
      /* ignore corrupt entry */
    }
  }
  return out;
}

/** Store one grounded result (upsert). No-ops on errored results. */
export async function putCachedResult(
  engine: string,
  query: string,
  result: EngineQueryResult,
): Promise<void> {
  if (result.error) return;
  await db
    .insert(searchCache)
    .values({
      key: keyOf(engine, query),
      engine,
      query: norm(query),
      resultJson: JSON.stringify(result),
    })
    .onConflictDoUpdate({
      target: searchCache.key,
      set: { resultJson: JSON.stringify(result), createdAt: new Date() },
    });
}
