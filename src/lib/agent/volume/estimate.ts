import "server-only";
import { generateText } from "@/lib/agent/measurement/llm";
import type { KeywordVolume, VolumeProvider } from "./types";

// ─────────────────────────────────────────────────────────────────────
// LLM estimate — a rough, clearly-labeled fallback so demand ranking works
// before a real keyword-data API is configured. Returns coarse buckets (a
// representative monthly number), NOT precise volume. `source` says so, so it
// never masquerades as ground truth. Swap in DataForSEO for real numbers.
// ─────────────────────────────────────────────────────────────────────

// Coarse buckets → representative monthly searches (order-of-magnitude only).
const BUCKETS: Record<string, number> = {
  very_high: 50_000,
  high: 10_000,
  medium: 2_000,
  low: 300,
  niche: 40,
};

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

    const prompt = `Estimate US Google monthly search demand for each keyword as a bucket: very_high, high, medium, low, or niche. Base it on how commonly people search this. Be realistic — most specific/long-tail keywords are low or niche.

Keywords:
${unique.map((k, i) => `${i + 1}. ${k}`).join("\n")}

Return ONLY JSON array of {"keyword","bucket"} in order:
[{"keyword":"...","bucket":"medium"}]`;

    try {
      const raw = await generateText(prompt, { temperature: 0 });
      const parsed = JSON.parse(
        raw.slice(raw.indexOf("["), raw.lastIndexOf("]") + 1),
      ) as Array<{ keyword?: string; bucket?: string }>;
      for (const p of parsed) {
        if (!p.keyword) continue;
        const bucket = (p.bucket ?? "low").toLowerCase();
        out.set(p.keyword.toLowerCase(), {
          keyword: p.keyword,
          monthlyVolume: BUCKETS[bucket] ?? BUCKETS.low,
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
