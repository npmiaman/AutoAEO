import "server-only";
import type { AiEngine } from "./types";
import { openaiEngine } from "./openai";
import { geminiEngine } from "./gemini";

export type { AiEngine, EngineQueryResult } from "./types";

// All known engines, in a stable order. Add Perplexity / Claude / etc. here.
export const ALL_ENGINES: AiEngine[] = [openaiEngine, geminiEngine];

/**
 * Engines that should run: those with credentials AND allowed by the optional
 * `MEASUREMENT_ENGINES` allowlist (comma-separated names, e.g. "openai"). The
 * allowlist lets us keep an engine off even when its key is present.
 */
export function availableEngines(): AiEngine[] {
  const allow = (process.env.MEASUREMENT_ENGINES ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return ALL_ENGINES.filter(
    (e) => e.available() && (allow.length === 0 || allow.includes(e.name)),
  );
}
