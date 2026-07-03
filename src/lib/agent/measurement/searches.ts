import "server-only";
import { generateText } from "./llm";

// ─────────────────────────────────────────────────────────────────────
// Search-idea generation. No preset topics, fields, or fixed count — we let
// the LLM brainstorm as many realistic searches as it naturally would for this
// business (direct + adjacent), then hard-cap the set at MAX_SEARCHES so no
// single model ever runs more than that many query searches. This is the daily
// test set run against AI engines to see where the business shows up.
// ─────────────────────────────────────────────────────────────────────

// Hard cap on query searches per model (see user directive). Not a target —
// the model decides how many to make; we only cap the maximum.
export const MAX_SEARCHES = 50;

export async function generateSearchIdeas(args: {
  business: string; // e.g. "a plumber in Columbus, Ohio" / a store's niche
  max?: number; // hard cap; never exceeds MAX_SEARCHES
}): Promise<string[]> {
  const max = Math.min(args.max ?? MAX_SEARCHES, MAX_SEARCHES);

  const prompt = `Brainstorm the real searches a person would type into an AI assistant (ChatGPT, Gemini, Perplexity) when they need: ${args.business}.

Include:
- Direct searches for this exact need.
- ADJACENT searches — nearby problems/questions that lead to the same business (e.g. for a plumber: "why is my water heater leaking", "cost to replace a sump pump", "who fixes burst pipes at night").
- A realistic spread of intent: urgent/emergency, price/quote, comparison, how-to that leads to hiring, location-specific, and trust/reviews.

Rules:
- Write like a real person searches — natural, varied length, casual.
- Do NOT name any specific business or brand.
- Be thorough: cover the many distinct ways buyers phrase these needs. Generate as many genuinely different, useful searches as apply — up to ${max}. Don't pad with near-duplicates.

Return ONLY a JSON array of strings, no prose, no code fences:
["...","...","..."]`;

  const raw = await generateText(prompt, { temperature: 0.8 });
  return parseSearchList(raw).slice(0, max);
}

function parseSearchList(raw: string): string[] {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : raw;
  const start = body.indexOf("[");
  const end = body.lastIndexOf("]");
  const jsonText = start !== -1 && end !== -1 ? body.slice(start, end + 1) : body;

  try {
    const parsed = JSON.parse(jsonText) as unknown[];
    const list = parsed
      .map((x) => (typeof x === "string" ? x : String(x)))
      .map((s) => s.trim())
      .filter((s) => s.length > 6);
    if (list.length) return dedupe(list);
  } catch {
    /* fall through to line parsing */
  }
  return dedupe(
    raw
      .split("\n")
      .map((l) => l.replace(/^[\s\-*\d.)"]+/, "").replace(/[",]+$/, "").trim())
      .filter((l) => l.length > 6),
  );
}

function dedupe(list: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of list) {
    const k = s.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  return out;
}
