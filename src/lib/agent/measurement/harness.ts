import "server-only";
import { nanoid } from "nanoid";
import { db } from "@/lib/db";
import { measurement } from "@/lib/db/schema";
import { availableEngines, type AiEngine } from "./engines";
import type { EngineQueryResult } from "./engines/types";
import { generateSearchIdeas } from "./searches";
import { extractSearchOutcome, type SearchOutcome } from "./ranking";
import { diagnose, type Diagnosis } from "./diagnosis";

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

export interface ScanInput {
  siteId: string;
  brandName: string;
  primaryDomain: string;
  business: string; // description used to generate searches, e.g. "a plumber in Ohio"
  searches?: string[]; // fixed daily set; generated if omitted
  searchCount?: number; // when generating, default 50
  engines?: AiEngine[]; // defaults to all available (respecting the allowlist)
  goalId?: string | null;
  experimentId?: string | null;
  persist?: boolean; // default true; false for dry runs before the table exists
}

export interface ScanResult {
  measurementId: string | null;
  searches: string[];
  appeared: number; // # searches we ranked on
  total: number; // # searches scored (excludes engine errors)
  appearedQueries: string[];
  outcomes: SearchOutcome[];
  diagnosis: Diagnosis;
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

  const searches =
    input.searches ??
    (await generateSearchIdeas({
      business: input.business,
      count: input.searchCount ?? 50,
    }));
  if (searches.length === 0) throw new Error("No searches to run.");

  // 1. Every (engine × search) is one grounded call.
  const jobs = engines.flatMap((engine) =>
    searches.map((query) => ({ engine, query })),
  );
  const raw: EngineQueryResult[] = await mapLimit(jobs, CONCURRENCY, ({ engine, query }) =>
    engine.query(query),
  );

  // 2. Extract who ranks + our position on each.
  const outcomes: SearchOutcome[] = await mapLimit(raw, CONCURRENCY, (r) =>
    extractSearchOutcome(r, input.brandName, input.primaryDomain),
  );

  const scored = outcomes.filter((o) => !o.error);
  const appearedQueries = scored.filter((o) => o.appeared).map((o) => o.query);

  // 3. Diagnose the win/loss split.
  const diagnosis = await diagnose({
    brandName: input.brandName,
    domain: input.primaryDomain,
    business: input.business,
    outcomes,
  });

  // 4. Persist a single measurement row (counts + detail, no score).
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
        engines: engines.map((e) => e.name),
        outcomes,
        diagnosis,
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
    engines: engines.map((e) => e.name),
    ranAt: Date.now(),
  };
}
