import "server-only";
import { generateText } from "@/lib/agent/measurement/llm";
import type { KeywordVolume, VolumeProvider } from "./types";

// ─────────────────────────────────────────────────────────────────────
// LLM estimate — a rough, clearly-labeled fallback so demand ranking works
// before a real keyword-data API is configured. Asks for a realistic monthly
// NUMBER per keyword (varied, not coarse buckets), so long-tail phrases read as
// tens/hundreds while broad head terms read as thousands. `source` says it's an
// estimate. Swap in a real provider (DataForSEO) for ground-truth volume.
// ─────────────────────────────────────────────────────────────────────

// Snap a raw estimate to a "nice" number so it reads like a real volume figure
// rather than a suspiciously precise one, while preserving its magnitude.
function tidy(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 10;
  if (n < 100) return Math.round(n / 10) * 10;
  if (n < 1000) return Math.round(n / 50) * 50;
  if (n < 10000) return Math.round(n / 100) * 100;
  return Math.round(n / 1000) * 1000;
}

export const estimateProvider: VolumeProvider = {
  name: "llm-estimate",

  available() {
    return (
      !!process.env.OPENAI_API_KEY ||
      !!(process.env.GOOGLE_API_KEY ?? process.env.GOOGLE_GENERATIVE_AI_API_KEY)
    );
  },

  async volumes(keywords: string[]): Promise<Map<string, KeywordVolume>> {
    const out = new Map<string, KeywordVolume>();
    const unique = [...new Set(keywords.map((k) => k.toLowerCase().trim()))].filter(Boolean);
    if (unique.length === 0) return out;

    const prompt = `Estimate US Google average monthly search volume for each keyword. Give a realistic integer for each — NOT round buckets, and don't give many keywords the same number.

Guidance (realistic ranges):
- Broad, common head terms ("hire a plumber", "crm software"): 5,000–60,000
- Mid specificity ("best crm for startups"): 500–5,000
- Long-tail / very specific / conversational phrasing: 20–500
Most conversational, multi-word phrases are long-tail (low). Vary the numbers so they reflect genuine differences in demand.

Keywords:
${unique.map((k, i) => `${i + 1}. ${k}`).join("\n")}

Return ONLY a JSON array of {"keyword","monthly"} (monthly = integer), in order:
[{"keyword":"...","monthly":720}]`;

    try {
      const raw = await generateText(prompt, { temperature: 0.4 });
      const parsed = JSON.parse(
        raw.slice(raw.indexOf("["), raw.lastIndexOf("]") + 1),
      ) as Array<{ keyword?: string; monthly?: number }>;
      for (const p of parsed) {
        if (!p.keyword) continue;
        const n = typeof p.monthly === "number" ? p.monthly : Number(p.monthly);
        out.set(p.keyword.toLowerCase(), {
          keyword: p.keyword,
          monthlyVolume: tidy(n),
          competition: null,
          source: "llm-estimate",
        });
      }
    } catch {
      /* return partial */
    }
    return out;
  },
};
