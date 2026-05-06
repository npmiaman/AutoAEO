import "server-only";
import { GoogleGenerativeAIEmbeddings } from "@langchain/google-genai";

// ─────────────────────────────────────────────────────────────────────
// Gemini embedding model factory. Used by the vector store + retrieval
// for cross-product semantic context during AEO content generation.
// ─────────────────────────────────────────────────────────────────────

export const EMBEDDING_MODEL = "text-embedding-004";
export const EMBEDDING_DIMENSIONS = 768;

export function buildEmbeddings(): GoogleGenerativeAIEmbeddings {
  const apiKey =
    process.env.GOOGLE_API_KEY ?? process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "GOOGLE_API_KEY is not configured. Set it in .env.local.",
    );
  }
  return new GoogleGenerativeAIEmbeddings({
    model: EMBEDDING_MODEL,
    apiKey,
  });
}
