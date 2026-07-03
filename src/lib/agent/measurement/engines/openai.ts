import "server-only";
import type { AiEngine, EngineQueryResult } from "./types";

// ─────────────────────────────────────────────────────────────────────
// OpenAI engine — uses a `*-search-preview` model on Chat Completions, which
// ALWAYS performs a live web search (no tool_choice guessing) and returns
// `url_citation` annotations. This is both cheaper than gpt-4o and, crucially,
// grounded — so "who actually ranks" reflects the live web, not the model's
// stale memory. Default is the mini search model; override with OPENAI_SEARCH_MODEL.
// ─────────────────────────────────────────────────────────────────────

const MODEL = process.env.OPENAI_SEARCH_MODEL ?? "gpt-4o-mini-search-preview";

interface Annotation {
  type: string;
  url_citation?: { url?: string; title?: string };
}
interface ChatResponse {
  choices?: Array<{
    message?: { content?: string; annotations?: Annotation[] };
  }>;
}

export const openaiEngine: AiEngine = {
  name: "openai",

  available() {
    return !!process.env.OPENAI_API_KEY;
  },

  async query(prompt: string): Promise<EngineQueryResult> {
    const key = process.env.OPENAI_API_KEY;
    const base: EngineQueryResult = {
      engine: "openai",
      query: prompt,
      answerText: "",
      citations: [],
    };
    if (!key) return { ...base, error: "OPENAI_API_KEY not set" };

    try {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
          model: MODEL,
          web_search_options: {},
          messages: [{ role: "user", content: prompt }],
        }),
      });
      if (!res.ok) {
        return { ...base, error: `OpenAI ${res.status}: ${await res.text()}` };
      }
      const json = (await res.json()) as ChatResponse;
      const msg = json.choices?.[0]?.message;
      const answerText = msg?.content ?? "";
      const citations = (msg?.annotations ?? [])
        .filter((a) => a.type === "url_citation")
        .flatMap((a) => [a.url_citation?.url, a.url_citation?.title])
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
