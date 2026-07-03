import "server-only";
import type { OptimizationAction } from "./types";
import { crawlerAccessAction } from "./crawler-access";

// ─────────────────────────────────────────────────────────────────────
// Action registry — the moves the autonomous loop can choose from, ordered
// by strategy impact (high → low). The loop walks this list and picks the
// first applicable action the memory hasn't already exhausted.
//
// Phase 4 adds the content/schema actions (FAQPage, answer-first rewrite,
// Organization schema, HowTo, freshness) here; each maps to a PLAYBOOK_ACTION.
// ─────────────────────────────────────────────────────────────────────

const IMPACT_ORDER = { high: 0, medium: 1, low: 2 } as const;

export const ACTIONS: OptimizationAction[] = [crawlerAccessAction].sort(
  (a, b) => IMPACT_ORDER[a.impact] - IMPACT_ORDER[b.impact],
);
