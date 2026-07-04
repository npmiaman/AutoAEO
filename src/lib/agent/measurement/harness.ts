import "server-only";
import { nanoid } from "nanoid";
import { db } from "@/lib/db";
import { measurement } from "@/lib/db/schema";
import { availableEngines, type AiEngine } from "./engines";
import type { EngineQueryResult } from "./engines/types";
import { generateSearchIdeas, MAX_SEARCHES } from "./searches";
import { extractSearchOutcomes, type SearchOutcome } from "./ranking";
import { diagnose, type Diagnosis } from "./diagnosis";
import {
  buildCompetitiveMap,
  applyDemand,
  classifyStrongCompetitors,
  applyStrength,
  analyzeCompetitorsBasis,
  resolveCompetitorLogos,
  resolveOurLogo,
  type CompetitiveMap,
} from "./competitors";
import { fetchQueryVolumes } from "@/lib/agent/volume";
import { getCachedResults, putCachedResult } from "./search-cache";

// ─────────────────────────────────────────────────────────────────────
// Visibility scan ("autoresearch"). Once per day per site, batched:
//
//   1. Use (or generate) a fixed set of ~50 realistic searches.
//   2. Ask every configured AI engine each search, with live web grounding.
//   3. Extract who ranks + where we land on each.
//   4. LLM diagnosis: why we win the ones we win, what's missing on the rest.
//   5. Persist ONE measurement row — appearance counts + full detail. No score.
//
// The autonomous loop reads the diagnosis for candidate actions and compares
// the appearance SET across days to decide what actually helped.
// ─────────────────────────────────────────────────────────────────────

const CONCURRENCY = Number(process.env.MEASUREMENT_CONCURRENCY ?? 5);

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, () =>
    (async () => {
      while (cursor < items.length) {
        const i = cursor++;
        out[i] = await fn(items[i]);
      }
    })(),
  );
  await Promise.all(workers);
  return out;
}

// ─── Targeted re-measure (for the loop's keep/rollback decision) ─────
//
// Cheaper than a full scan: run a specific set of searches, return only which
// ones we appear on. No diagnosis, no persistence. The loop calls this before
// and after a change on exactly the searches the change targeted.
export interface QuickMeasureResult {
  appearedQueries: string[]; // searches we ranked on
  total: number; // searches actually scored (excludes engine errors)
  outcomes: SearchOutcome[];
}

export async function quickMeasure(args: {
  brandName: string;
  primaryDomain: string;
  searches: string[];
  engines?: AiEngine[];
}): Promise<QuickMeasureResult> {
  const engines = (args.engines ?? availableEngines()).filter((e) =>
    e.available(),
  );
  if (engines.length === 0) throw new Error("No AI engines configured.");
  if (args.searches.length === 0)
    return { appearedQueries: [], total: 0, outcomes: [] };

  const jobs = engines.flatMap((engine) =>
    args.searches.map((query) => ({ engine, query })),
  );
  const raw = await mapLimit(jobs, CONCURRENCY, ({ engine, query }) =>
    engine.query(query),
  );
  const outcomes = await extractSearchOutcomes(
    raw,
    args.brandName,
    args.primaryDomain,
  );
  const scored = outcomes.filter((o) => !o.error);
  return {
    appearedQueries: scored.filter((o) => o.appeared).map((o) => o.query),
    total: scored.length,
    outcomes,
  };
}

export interface ScanInput {
  siteId: string;
  brandName: string;
  primaryDomain: string;
  business: string; // description used to generate searches, e.g. "a plumber in Ohio"
  searches?: string[]; // fixed daily set; generated (natural, ≤50) if omitted
  // Dev-only lower cap for quick tests (never exceeds MAX_SEARCHES). The product
  // leaves this unset so the model generates its natural set up to 50.
  maxSearches?: number;
  engines?: AiEngine[]; // defaults to all available (respecting the allowlist)
  goalId?: string | null;
  experimentId?: string | null;
  persist?: boolean; // default true; false for dry runs before the table exists
  // Deep-analyze the top N competitors' ranking basis (fetch a cited page +
  // LLM). 0 disables. Bounded because each costs a fetch + LLM call.
  analyzeCompetitors?: number;
  // Look up search demand (keyword volume) per query. Default true.
  withVolume?: boolean;
}

export interface ScanResult {
  measurementId: string | null;
  searches: string[];
  appeared: number; // # searches we ranked on
  total: number; // # searches scored (excludes engine errors)
  appearedQueries: string[];
  outcomes: SearchOutcome[];
  diagnosis: Diagnosis;
  competitors: CompetitiveMap;
  engines: string[];
  ranAt: number;
}

export async function runVisibilityScan(input: ScanInput): Promise<ScanResult> {
  const engines = (input.engines ?? availableEngines()).filter((e) =>
    e.available(),
  );
  if (engines.length === 0) {
    throw new Error(
      "No AI engines configured. Set OPENAI_API_KEY and/or GOOGLE_API_KEY.",
    );
  }

  // Let the model decide how many searches to make; only cap at MAX_SEARCHES.
  const searches = (
    input.searches ??
    (await generateSearchIdeas({
      business: input.business,
      max: input.maxSearches,
    }))
  ).slice(0, MAX_SEARCHES);
  if (searches.length === 0) throw new Error("No searches to run.");

  // Every (engine × search) is one grounded call (sync path). Cache-backed: a
  // fresh cached result is reused (so a stopped scan resumes instead of redoing
  // completed calls), and every fresh call is written back as it lands.
  const cacheByEngine = new Map<string, Map<string, EngineQueryResult>>();
  await Promise.all(
    engines.map(async (engine) => {
      cacheByEngine.set(
        engine.name,
        await getCachedResults(engine.name, searches),
      );
    }),
  );
  const jobs = engines.flatMap((engine) =>
    searches.map((query) => ({ engine, query })),
  );
  const raw: EngineQueryResult[] = await mapLimit(
    jobs,
    CONCURRENCY,
    async ({ engine, query }) => {
      const hit = cacheByEngine.get(engine.name)?.get(query.trim().toLowerCase());
      if (hit) return hit;
      const res = await engine.query(query);
      await putCachedResult(engine.name, query, res);
      return res;
    },
  );

  return finalizeScan({
    input,
    searches,
    raw,
    engineNames: engines.map((e) => e.name),
  });
}

/**
 * Everything after grounding: extract who-ranks (batched), competitive map +
 * demand + basis + logos, diagnosis, and persist. Shared by the sync scan and
 * the async Batch-API scan, which only differ in how `raw` was obtained.
 */
export async function finalizeScan(args: {
  input: ScanInput;
  searches: string[];
  raw: EngineQueryResult[];
  engineNames: string[];
}): Promise<ScanResult> {
  const { input, searches, raw, engineNames } = args;

  // 1. Extract who ranks + our position on each — one batched LLM call.
  const outcomes: SearchOutcome[] = await extractSearchOutcomes(
    raw,
    input.brandName,
    input.primaryDomain,
  );

  const scored = outcomes.filter((o) => !o.error);
  const appearedQueries = scored.filter((o) => o.appeared).map((o) => o.query);

  // 2. Competitive intelligence.
  const competitors = buildCompetitiveMap(
    outcomes,
    input.brandName,
    input.primaryDomain,
  );

  // "Strong" competitors judged by authority (LLM), not by appearance count —
  // this drives quick-win vs entrenched classification.
  const strong = await classifyStrongCompetitors(
    competitors.competitors,
    input.business,
  );
  applyStrength(competitors, strong);

  if (input.withVolume !== false) {
    const demand = await fetchQueryVolumes(
      competitors.rankings.map((r) => r.query),
    );
    applyDemand(competitors, Object.fromEntries(demand));
  }
  const topN = input.analyzeCompetitors ?? 0;
  if (topN > 0 && competitors.competitors.length) {
    competitors.basis = await analyzeCompetitorsBasis({
      competitors: competitors.competitors.slice(0, topN),
      outcomes,
    });
  }
  await resolveCompetitorLogos(competitors, 8);
  competitors.ourLogoUrl =
    (await resolveOurLogo(input.primaryDomain)) ?? undefined;

  // 3. Diagnose.
  const diagnosis = await diagnose({
    brandName: input.brandName,
    domain: input.primaryDomain,
    business: input.business,
    outcomes,
    whitespace: competitors.focus.quickWins,
  });

  // 4. Persist one measurement row.
  let measurementId: string | null = null;
  if (input.persist !== false) {
    measurementId = nanoid();
    await db.insert(measurement).values({
      id: measurementId,
      siteId: input.siteId,
      experimentId: input.experimentId ?? null,
      goalId: input.goalId ?? null,
      signal: "synthetic_ai",
      appeared: appearedQueries.length,
      total: scored.length,
      detailJson: JSON.stringify({
        engines: engineNames,
        outcomes,
        diagnosis,
        competitors,
      }),
    });
  }

  return {
    measurementId,
    searches,
    appeared: appearedQueries.length,
    total: scored.length,
    appearedQueries,
    outcomes,
    diagnosis,
    competitors,
    engines: engineNames,
    ranAt: Date.now(),
  };
}
