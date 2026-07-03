import "server-only";
import { generateText } from "./llm";

// ─────────────────────────────────────────────────────────────────────
// Search-idea generation. No preset topics or fields — we ask an LLM to
// brainstorm the ~50 searches a real person would actually type when they
// need this kind of business, INCLUDING adjacent searches (the nearby needs
// that lead to the same purchase). This is the fixed daily test set we run
// against AI engines to see where the business shows up and where it doesn't.
// ─────────────────────────────────────────────────────────────────────

export async function generateSearchIdeas(args: {
  business: string; // e.g. "a plumber in Columbus, Ohio" / a store's niche
  count?: number; // default 50
}): Promise<string[]> {
  const count = args.count ?? 50;

  const prompt = `Brainstorm the real searches a person would type into an AI assistant (ChatGPT, Gemini, Perplexity) when they need: ${args.business}.

Include:
- Direct searches for this exact need.
- ADJACENT searches — nearby problems/questions that lead to the same business (e.g. for a plumber: "why is my water heater leaking", "cost to replace a sump pump", "who fixes burst pipes at night").
- A realistic spread of intent: urgent/emergency, price/quote, comparison, how-to that leads to hiring, location-specific, and trust/reviews.

Rules:
- Write like a real person searches — natural, varied length, some typos-free but casual.
- Do NOT name any specific business or brand.
- Exactly ${count} searches.

Return ONLY a JSON array of strings, no prose, no code fences:
["...","...","..."]`;

  const raw = await generateText(prompt, { temperature: 0.8 });
  return parseSearchList(raw).slice(0, count);
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
