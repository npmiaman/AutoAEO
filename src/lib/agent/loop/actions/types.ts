import "server-only";
import type { Artifact, SiteAdapter } from "@/lib/agent/site/adapter";
import type { StrategyLayer } from "@/lib/agent/strategy";
import type { ResolvedSite } from "../site";
import type { Diagnosis } from "@/lib/agent/measurement/diagnosis";

// ─────────────────────────────────────────────────────────────────────
// OptimizationAction — one concrete move the autonomous loop can make.
//
// The loop picks an applicable, high-impact action the memory hasn't already
// tried, applies the artifacts it proposes, then re-measures the searches
// those artifacts target. Actions are the executable counterpart of the
// strategy's PLAYBOOK_ACTIONS.
// ─────────────────────────────────────────────────────────────────────

export interface ActionContext {
  site: ResolvedSite;
  adapter: SiteAdapter;
  // The latest diagnosis (why we win/lose + recommendations), if available —
  // lets an action tailor itself to real gaps and know which searches to
  // re-measure afterward.
  diagnosis?: Diagnosis;
}

export interface ProposedArtifact {
  artifact: Artifact;
  hypothesis: string; // why we expect this to help (stored in memory)
  intent: string; // stable descriptor for fingerprint dedup
  // Searches this change is meant to move — the loop re-measures exactly these
  // (plus current winners) to decide keep vs rollback.
  targetQueries: string[];
}

export interface OptimizationAction {
  id: string;
  layer: StrategyLayer;
  impact: "high" | "medium" | "low";
  title: string;

  /** Can this action run on this site right now? (platform + preconditions) */
  isApplicable(ctx: ActionContext): Promise<boolean>;

  /** Concrete artifact(s) to try. Empty array = nothing to do. */
  propose(ctx: ActionContext): Promise<ProposedArtifact[]>;
}
