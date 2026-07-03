import "server-only";
import { EMBEDDING_DIMENSIONS } from "./embeddings";

// ─────────────────────────────────────────────────────────────────────
// Provider-agnostic embeddings. The experiment-memory vector index must work
// on whichever LLM stack is configured. OpenAI is preferred (matches the
// OpenAI-only setup); text-embedding-3-small is requested at the existing
// index dimensionality (768) via the `dimensions` param so it drops into the
// same F32_BLOB(768) columns as the Gemini embeddings. Falls back to Gemini.
//
// Returns null when no embedding provider is configured, so callers can
// degrade gracefully (memory keeps its SQL rows; only semantic recall is off).
// ─────────────────────────────────────────────────────────────────────

export async function embedTexts(
  texts: string[],
): Promise<number[][] | null> {
  if (texts.length === 0) return [];
  if (process.env.OPENAI_API_KEY) return openaiEmbed(texts);
  if (process.env.GOOGLE_API_KEY ?? process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    const { buildEmbeddings } = await import("./embeddings");
    return buildEmbeddings().embedDocuments(texts);
  }
  return null;
}

async function openaiEmbed(texts: string[]): Promise<number[][]> {
  const model = process.env.OPENAI_EMBED_MODEL ?? "text-embedding-3-small";
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model,
      input: texts,
      dimensions: EMBEDDING_DIMENSIONS, // 768 — matches the F32_BLOB index
    }),
  });
  if (!res.ok)
    throw new Error(`OpenAI embeddings ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as {
    data?: Array<{ embedding: number[] }>;
  };
  return (json.data ?? []).map((d) => d.embedding);
}
