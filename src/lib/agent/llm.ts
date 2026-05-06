import "server-only";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";

// ─────────────────────────────────────────────────────────────────────
// Shared Gemini chat model factory.
//
// One place to set model, temperature, retry, and tracing for every
// agent in the system. LangSmith tracing is enabled automatically when
// LANGCHAIN_TRACING_V2=true and LANGCHAIN_API_KEY are set in env;
// no per-call instrumentation needed.
// ─────────────────────────────────────────────────────────────────────

export const DEFAULT_MODEL = "gemini-2.5-flash";
export const HEAVY_MODEL = "gemini-2.5-pro";

export function buildChatModel(opts?: {
  model?: string;
  temperature?: number;
  maxRetries?: number;
}): ChatGoogleGenerativeAI {
  const apiKey =
    process.env.GOOGLE_API_KEY ?? process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "GOOGLE_API_KEY is not configured. Set it in .env.local (Generative Language API key from Google AI Studio).",
    );
  }
  return new ChatGoogleGenerativeAI({
    model: opts?.model ?? DEFAULT_MODEL,
    temperature: opts?.temperature ?? 0.3,
    maxRetries: opts?.maxRetries ?? 2,
    apiKey,
  });
}
