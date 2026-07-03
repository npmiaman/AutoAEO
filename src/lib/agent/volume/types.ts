import "server-only";

// ─────────────────────────────────────────────────────────────────────
// Search-volume providers. The conversational queries AI assistants run don't
// have their own published volume, so we map each to a core keyword and look
// up that keyword's monthly Google search volume. Providers are pluggable
// (like the AI engines): a real keyword-data API when configured, else an
// LLM estimate — always labeled with its `source` so the number is honest.
// ─────────────────────────────────────────────────────────────────────

export interface KeywordVolume {
  keyword: string;
  monthlyVolume: number | null; // avg monthly searches; null = unknown
  competition: string | null; // low | medium | high (if the provider gives it)
  source: string; // "dataforseo" | "llm-estimate" | ...
}

export interface VolumeProvider {
  name: string;
  available(): boolean;
  /** Look up volumes for a batch of keywords. Never throws — unknowns map to null. */
  volumes(keywords: string[]): Promise<Map<string, KeywordVolume>>;
}
