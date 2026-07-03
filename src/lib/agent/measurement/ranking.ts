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

export async function extractSearchOutcome(
  result: EngineQueryResult,
  brandName: string,
  domain: string,
): Promise<SearchOutcome> {
  const base = { engine: result.engine, query: result.query };
  if (result.error) {
    return {
      ...base,
      appeared: false,
      cited: false,
      position: null,
      rankedEntities: [],
      error: result.error,
    };
  }
  const cited = citedInSources(result.citations, domain);
  const { entities, ourPosition } = await extractRanking(
    result.answerText,
    brandName,
    domain,
  );
  const appeared = cited || ourPosition !== null;
  return {
    ...base,
    appeared,
    cited,
    position: ourPosition,
    rankedEntities: entities,
  };
}
