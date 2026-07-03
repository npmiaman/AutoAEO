import "server-only";

// ─────────────────────────────────────────────────────────────────────
// AiEngine — the pluggable interface behind synthetic AEO testing.
//
// Each engine answers a buyer question the way a real AI search product
// would, and reports which sources it grounded on. The harness then checks
// whether the site under test was surfaced and quoted. OpenAI + Gemini ship
// first; Perplexity / Claude / Google AI Mode slot in behind the same shape.
// ─────────────────────────────────────────────────────────────────────

export interface EngineQueryResult {
  engine: string;
  query: string;
  answerText: string;
  citations: string[]; // URLs the engine grounded on / cited
  raw?: unknown; // full provider payload, persisted for audit
  error?: string; // set when the call failed (engine skipped, not fatal)
}

export interface AiEngine {
  readonly name: string; // stable id, e.g. "openai" | "gemini"
  /** True when the engine has the credentials/config it needs to run. */
  available(): boolean;
  /** Answer a query with web grounding; never throws — errors land in the result. */
  query(prompt: string): Promise<EngineQueryResult>;
}
