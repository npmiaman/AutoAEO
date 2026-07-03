import "server-only";
import { generateText } from "@/lib/agent/measurement/llm";

// ─────────────────────────────────────────────────────────────────────
// Keyword extraction. A conversational AI query ("urgent need for a graphic
// designer for a last minute project") rarely has search volume itself — but
// the head keyword behind it ("hire graphic designer") does. This maps each
// query to the short keyword a person would actually type into Google, so we
// can look up real demand.
// ─────────────────────────────────────────────────────────────────────

export async function extractKeywords(
  queries: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (queries.length === 0) return map;

  const prompt = `For each conversational search below, give the short "head keyword" a person would actually type into Google to research the same need (2-4 words, lowercase, no punctuation). This is what we'll look up search volume for.

Searches:
${queries.map((q, i) => `${i + 1}. ${q}`).join("\n")}

Return ONLY a JSON array of {"query","keyword"} in the same order:
[{"query":"...","keyword":"hire graphic designer"}]`;

  try {
    const raw = await generateText(prompt, { temperature: 0 });
    const parsed = JSON.parse(
      raw.slice(raw.indexOf("["), raw.lastIndexOf("]") + 1),
    ) as Array<{ query?: string; keyword?: string }>;
    for (const p of parsed) {
      if (p.query && p.keyword) map.set(p.query, p.keyword.trim().toLowerCase());
    }
  } catch {
    /* fall through */
  }
  // Fallback for anything unmatched: a naive keyword from the query itself.
  for (const q of queries) {
    if (!map.has(q)) {
      map.set(
        q,
        q.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).slice(0, 4).join(" ").trim(),
      );
    }
  }
  return map;
}
