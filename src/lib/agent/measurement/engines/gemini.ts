import "server-only";
import type { AiEngine, EngineQueryResult } from "./types";

// ─────────────────────────────────────────────────────────────────────
// Gemini engine — calls the Generative Language API directly (not via
// LangChain) with the `google_search` grounding tool, because we need the
// raw groundingMetadata to extract the exact source URLs the model used.
// ─────────────────────────────────────────────────────────────────────

const MODEL = process.env.GEMINI_SEARCH_MODEL ?? "gemini-2.5-flash";

interface GroundingChunk {
  web?: { uri?: string; title?: string };
}
interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    groundingMetadata?: { groundingChunks?: GroundingChunk[] };
  }>;
}

export const geminiEngine: AiEngine = {
  name: "gemini",

  available() {
    return !!(
      process.env.GOOGLE_API_KEY ?? process.env.GOOGLE_GENERATIVE_AI_API_KEY
    );
  },

  async query(prompt: string): Promise<EngineQueryResult> {
    const key =
      process.env.GOOGLE_API_KEY ?? process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    const base: EngineQueryResult = {
      engine: "gemini",
      query: prompt,
      answerText: "",
      citations: [],
    };
    if (!key) return { ...base, error: "GOOGLE_API_KEY not set" };

    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${key}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            tools: [{ google_search: {} }],
          }),
        },
      );
      if (!res.ok) {
        return { ...base, error: `Gemini ${res.status}: ${await res.text()}` };
      }
      const json = (await res.json()) as GeminiResponse;
      const cand = json.candidates?.[0];
      const answerText =
        cand?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
      // Gemini's grounding `uri` is a vertexaisearch redirect, not the real
      // domain — the actual domain lives in `title`. Capture both so domain
      // matching in scoring works regardless of which one carries the host.
      const citations = (cand?.groundingMetadata?.groundingChunks ?? [])
        .flatMap((c) => [c.web?.uri, c.web?.title])
        .filter((u): u is string => !!u);
      return { ...base, answerText, citations, raw: json };
    } catch (err) {
      return {
        ...base,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },
};
