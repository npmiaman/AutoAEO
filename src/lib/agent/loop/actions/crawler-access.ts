import "server-only";
import { generateRobotsTxt } from "@/lib/agent/playbooks/machine-layer/generator";
import type { RobotsPayload } from "@/lib/agent/site/payloads";
import type { ActionContext, OptimizationAction, ProposedArtifact } from "./types";

// ─────────────────────────────────────────────────────────────────────
// Crawler access — strategy layer 1 / technical, HIGH impact.
//
// "A single blocked crawler makes you invisible for no reason." This action
// checks the live robots.txt and, if AI bots aren't explicitly allowed, writes
// an AI-friendly robots.txt. Fully reversible via snapshot. It's the first
// thing to fix because nothing else matters if crawlers can't reach the site.
// ─────────────────────────────────────────────────────────────────────

const AI_BOTS = [
  "GPTBot",
  "ClaudeBot",
  "PerplexityBot",
  "OAI-SearchBot",
  "Google-Extended",
];

export const crawlerAccessAction: OptimizationAction = {
  id: "crawler-access",
  layer: "technical",
  impact: "high",
  title: "Unblock AI crawlers (robots.txt)",

  async isApplicable(ctx: ActionContext): Promise<boolean> {
    // Only platforms that let us write robots directives.
    if (ctx.adapter.platform !== "shopify" && ctx.adapter.platform !== "generic")
      return false;
    try {
      const res = await ctx.adapter.fetchPublic("/robots.txt");
      const body = res.body.toLowerCase();
      // Applicable only if at least one major AI bot is NOT already named.
      return AI_BOTS.some((b) => !body.includes(b.toLowerCase()));
    } catch {
      // Can't read it — safe to propose the known-good version.
      return true;
    }
  },

  async propose(ctx: ActionContext): Promise<ProposedArtifact[]> {
    const robots = generateRobotsTxt({ primaryDomain: ctx.site.primaryDomain });
    const payload: RobotsPayload = {
      key: "config/robots.txt.liquid",
      value: robots,
    };
    return [
      {
        artifact: {
          kind: "robots",
          target: payload.key,
          title: "AI-friendly robots.txt",
          description: `Explicitly allow ${AI_BOTS.join(", ")} and list /llms.txt.`,
          payload,
        },
        hypothesis:
          "AI crawlers may be blocked or not explicitly allowed; allowing them lets engines index and cite the site at all.",
        intent: "allow-ai-crawlers-robots",
        // Crawler access affects every search; re-measure the ones we're missing.
        targetQueries: ctx.diagnosis?.missingOn ?? [],
      },
    ];
  },
};
