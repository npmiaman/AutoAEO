import "server-only";
import { z } from "zod";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { buildChatModel } from "@/lib/agent/llm";

// ─────────────────────────────────────────────────────────────────────
// LLM triage step for the Site Crawl Audit.
//
// Takes raw mechanical findings and a list of live URLs, asks Gemini
// to:
//   1. Refine severity per finding using context
//   2. For 4xx findings, suggest a redirect target if a similar live URL exists
//   3. For other findings, write a concrete fix instruction
//
// Output is type-safe via Zod + withStructuredOutput.
// ─────────────────────────────────────────────────────────────────────

export interface RawFinding {
  id: string;
  category:
    | "broken_4xx"
    | "broken_5xx"
    | "redirect_chain"
    | "missing_meta"
    | "js_only"
    | "robots_blocked"
    | "robots_no_sitemap"
    | "theme_robots_disallow"
    | "fetch_error";
  url: string;
  initialSeverity: "low" | "medium" | "high" | "critical";
  details: string;
}

const FixSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("redirect"),
    toPath: z
      .string()
      .describe(
        "Target path for a 301 redirect, beginning with '/'. Pick a live URL from the candidates list that is the most plausible replacement for the broken URL.",
      ),
    rationale: z.string(),
  }),
  z.object({
    type: z.literal("manual"),
    instructions: z
      .string()
      .describe(
        "Concrete merchant-facing instructions to fix the issue, in 1–3 sentences.",
      ),
  }),
  z.object({
    type: z.literal("none"),
    rationale: z
      .string()
      .describe("Why no fix is suggested (e.g., not enough info, false positive)."),
  }),
]);

const TriageSchema = z.object({
  triaged: z.array(
    z.object({
      id: z.string(),
      severity: z.enum(["low", "medium", "high", "critical"]),
      explanation: z
        .string()
        .describe(
          "1–2 sentence merchant-facing explanation of why this issue matters for AI search visibility.",
        ),
      fix: FixSchema,
    }),
  ),
});

export type TriagedFinding = z.infer<typeof TriageSchema>["triaged"][number];

const SYSTEM = `You triage technical-SEO findings from a Shopify storefront audit.

For each finding, decide:
  1. Refined severity (low / medium / high / critical) based on real impact on AI search visibility
  2. A specific, actionable fix:
     - "redirect" if the finding is a 4xx / fetch error and a clearly similar live URL exists
       in the candidates list (best-guess match — handle similarity, slugs, etc.)
     - "manual" if a redirect doesn't make sense — provide concrete instructions
     - "none" if there isn't enough information or the finding is likely a false positive

Severity guide:
  - critical: blocks AI crawlers entirely (theme robots Disallow, every URL 4xx)
  - high: meaningfully reduces visibility (404 on indexed product, robots blocking GPTBot/ClaudeBot)
  - medium: partial loss (single missing meta, one redirect chain)
  - low: cosmetic / marginal (missing canonical when other signals exist)

Be specific in fixes. "Add a meta description" is too vague. "Add a 50–155 char meta
description that leads with the product noun and primary attribute" is right.`;

export async function triageFindings(args: {
  shopName: string;
  shopUrl: string;
  findings: RawFinding[];
  liveUrls: string[]; // sample of known-good URLs for redirect matching
}): Promise<TriagedFinding[]> {
  const { findings, liveUrls } = args;
  if (findings.length === 0) return [];

  const findingList = findings
    .map(
      (f) =>
        `id: ${f.id}
category: ${f.category}
url: ${f.url}
initial_severity: ${f.initialSeverity}
details: ${f.details}`,
    )
    .join("\n\n---\n\n");

  const candidatesList = liveUrls.slice(0, 80).join("\n");

  const prompt = ChatPromptTemplate.fromMessages([
    ["system", SYSTEM],
    [
      "human",
      `Store: {shopName} ({shopUrl})

# Findings to triage ({count})
{findings}

# Live URL candidates (for redirect matching)
{candidates}

For each finding above (matched by id), return a triage record.`,
    ],
  ]);

  const model = buildChatModel({ temperature: 0.2 }).withStructuredOutput(
    TriageSchema,
    { name: "AuditTriage" },
  );

  const chain = prompt.pipe(model);
  const result = await chain.invoke({
    shopName: args.shopName,
    shopUrl: args.shopUrl,
    count: findings.length,
    findings: findingList,
    candidates: candidatesList,
  });

  return result.triaged;
}
