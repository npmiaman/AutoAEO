import "server-only";
import { generateText } from "./llm";
import type { EngineQueryResult } from "./engines/types";

// ─────────────────────────────────────────────────────────────────────
// Ranking extraction — for one AI answer, work out WHO the assistant put
// forward (in order) and WHERE our business landed. No score: just the facts.
//   • appeared      — did the assistant mention/recommend us at all?
//   • position      — our 1-based rank among the businesses it named (or null)
//   • rankedEntities— every business/brand it named, in the order presented
//   • cited         — were we a *linked source* (strongest signal of grounding)
// ─────────────────────────────────────────────────────────────────────

export interface SearchOutcome {
  engine: string;
  query: string;
  appeared: boolean;
  cited: boolean;
  position: number | null; // rank among named businesses; null if absent
  rankedEntities: string[]; // businesses named, in order
  citations: string[]; // source URLs the engine grounded on (for competitor tracing)
  error?: string;
}

function normalizeHost(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .split("/")[0]
    .split("?")[0]
    .replace(/^www\./, "");
}

function citedInSources(citations: string[], domain: string): boolean {
  const host = normalizeHost(domain);
  const brand = host.split(".")[0];
  return citations.some((c) => {
    const h = c.toLowerCase();
    return h.includes(host) || (brand.length >= 4 && h.includes(brand));
  });
}

interface Extracted {
  entities: string[];
  ourPosition: number | null;
}

async function extractRanking(
  answerText: string,
  brandName: string,
  domain: string,
): Promise<Extracted> {
  if (!answerText.trim()) return { entities: [], ourPosition: null };
  const prompt = `An AI assistant answered a shopper/consumer search. List the businesses/brands/stores it named, IN THE ORDER they appear, and say where the business under test ranks.

BUSINESS UNDER TEST: "${brandName}" (website ${domain})

ANSWER:
"""
${answerText.slice(0, 7000)}
"""

Return ONLY JSON, no prose:
{"entities": ["First named", "Second named", ...],
 "ourPosition": <1-based index of the business under test within entities, or null if it is not named>}`;

  try {
    const raw = await generateText(prompt, { temperature: 0 });
    const jsonText = raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1);
    const parsed = JSON.parse(jsonText) as {
      entities?: unknown[];
      ourPosition?: number | null;
    };
    const entities = (parsed.entities ?? [])
      .map((e) => String(e).trim())
      .filter(Boolean)
      .slice(0, 20);
    const ourPosition =
      typeof parsed.ourPosition === "number" && parsed.ourPosition > 0
        ? parsed.ourPosition
        : null;
    return { entities, ourPosition };
  } catch {
    const brand = normalizeHost(domain).split(".")[0];
    const named =
      answerText.toLowerCase().includes(brandName.toLowerCase()) ||
      (brand.length >= 4 && answerText.toLowerCase().includes(brand));
    return { entities: [], ourPosition: named ? 1 : null };
  }
}

function outcomeFrom(
  result: EngineQueryResult,
  domain: string,
  extracted: Extracted,
): SearchOutcome {
  const base = { engine: result.engine, query: result.query };
  if (result.error) {
    return {
      ...base,
      appeared: false,
      cited: false,
      position: null,
      rankedEntities: [],
      citations: [],
      error: result.error,
    };
  }
  const cited = citedInSources(result.citations, domain);
  return {
    ...base,
    appeared: cited || extracted.ourPosition !== null,
    cited,
    position: extracted.ourPosition,
    rankedEntities: extracted.entities,
    citations: result.citations.filter((c) => /^https?:\/\//i.test(c)),
  };
}

export async function extractSearchOutcome(
  result: EngineQueryResult,
  brandName: string,
  domain: string,
): Promise<SearchOutcome> {
  if (result.error) return outcomeFrom(result, domain, { entities: [], ourPosition: null });
  const extracted = await extractRanking(result.answerText, brandName, domain);
  return outcomeFrom(result, domain, extracted);
}

/**
 * Batched extraction — one LLM call analyzes ALL answers at once instead of one
 * call per answer. Answers are truncated and indexed; the model returns a JSON
 * array keyed by index. Falls back to per-answer extraction if the batch parse
 * fails, so results are never lost.
 */
export async function extractSearchOutcomes(
  results: EngineQueryResult[],
  brandName: string,
  domain: string,
): Promise<SearchOutcome[]> {
  const answered = results
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => !r.error && r.answerText.trim());

  const byIndex = new Map<number, Extracted>();

  // Chunk so each call stays well within context (one call per ~25 answers,
  // instead of one per answer). Chunks run concurrently.
  const CHUNK = 25;
  const chunks: Array<Array<{ r: EngineQueryResult; i: number }>> = [];
  for (let k = 0; k < answered.length; k += CHUNK) {
    chunks.push(answered.slice(k, k + CHUNK));
  }

  await Promise.all(
    chunks.map(async (chunk) => {
      const blocks = chunk
        .map(({ r, i }) => `[${i}] Query: ${r.query}\n"""\n${r.answerText.slice(0, 2500)}\n"""`)
        .join("\n\n");

      const prompt = `You analyze AI assistant answers to shopper/consumer searches. For EACH answer below, list the businesses/brands/stores it names IN ORDER, and where the business under test ranks.

BUSINESS UNDER TEST: "${brandName}" (website ${domain})

ANSWERS:
${blocks}

Return ONLY a JSON array — one object per answer, keyed by its [index]:
[{"i": <index>, "entities": ["First named","Second named"], "ourPosition": <1-based index of the business under test in entities, or null if absent>}]`;

      try {
        const rawText = await generateText(prompt, { temperature: 0 });
        const jsonText = rawText.slice(rawText.indexOf("["), rawText.lastIndexOf("]") + 1);
        const parsed = JSON.parse(jsonText) as Array<{
          i?: number;
          entities?: unknown[];
          ourPosition?: number | null;
        }>;
        for (const p of parsed) {
          if (typeof p.i !== "number") continue;
          byIndex.set(p.i, {
            entities: (p.entities ?? []).map((e) => String(e).trim()).filter(Boolean).slice(0, 20),
            ourPosition:
              typeof p.ourPosition === "number" && p.ourPosition > 0 ? p.ourPosition : null,
          });
        }
      } catch {
        // Chunk parse failed — fall back to per-answer extraction for it only.
        await Promise.all(
          chunk.map(async ({ r, i }) => {
            byIndex.set(i, await extractRanking(r.answerText, brandName, domain));
          }),
        );
      }
    }),
  );

  return results.map((r, i) =>
    outcomeFrom(r, domain, byIndex.get(i) ?? { entities: [], ourPosition: null }),
  );
}
