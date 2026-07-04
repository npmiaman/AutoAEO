// ─────────────────────────────────────────────────────────────────────
// Per-site autonomy + loop configuration. Serialized into site.configJson.
//
// The user chose "fully autonomous": the loop applies changes itself with no
// approval gate. The safety mechanism is reversibility — every change is a
// tracked experiment with a before-snapshot, and `autoRollback` reverts any
// change whose post-measurement doesn't beat baseline by `minImprovement`.
// ─────────────────────────────────────────────────────────────────────

export type Autonomy =
  | "full" // apply everything, self-driving loop (chosen default)
  | "safe" // auto-apply additive/reversible artifacts; gate live-copy edits
  | "manual"; // propose only; require human approval (legacy behavior)

export interface SiteConfig {
  // Free-text description of what the site/business does — drives buyer-search
  // generation. Set when the user adds their website.
  business?: string;
  autonomy: Autonomy;
  // Revert a change automatically when its measured score doesn't clear
  // baseline + minImprovement.
  autoRollback: boolean;
  // Minimum score delta (0..1000 scale) to consider a change a win worth keeping.
  minImprovement: number;
  // How often the loop wakes to run the next experiment.
  cadenceMinutes: number;
  // Kill switch — pause the loop without deleting the site.
  paused: boolean;
  // The site's current search set, reused across a scan "session" so a stopped
  // scan resumes on the SAME queries (matching the per-query grounding cache)
  // instead of regenerating a different set. Refreshed after the set's TTL.
  searchSet?: string[];
  searchSetAt?: number; // epoch ms when searchSet was generated
}

export const DEFAULT_SITE_CONFIG: SiteConfig = {
  autonomy: "full",
  autoRollback: true,
  minImprovement: 10, // ~1% on the 0..1000 scale
  cadenceMinutes: 360, // every 6 hours
  paused: false,
};

export function parseSiteConfig(json: string | null | undefined): SiteConfig {
  if (!json) return { ...DEFAULT_SITE_CONFIG };
  try {
    const parsed = JSON.parse(json) as Partial<SiteConfig>;
    return { ...DEFAULT_SITE_CONFIG, ...parsed };
  } catch {
    return { ...DEFAULT_SITE_CONFIG };
  }
}
