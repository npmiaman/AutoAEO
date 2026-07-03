import "server-only";
import { generateText } from "./llm";
import { STRATEGY_BRIEF } from "@/lib/agent/strategy";
import type { SearchOutcome } from "./ranking";

// ─────────────────────────────────────────────────────────────────────
// Diagnosis — the intelligence step. Given the searches we DID rank on and
// the ones we DIDN'T, an LLM decodes what makes the difference: what our SEO
// and GEO (generative engine optimization) do well on the winners, what's
// missing on the losers, and concrete moves — both to WIN the searches we're
// absent from and to STRENGTHEN the ones we already own.
//
// The output feeds the autonomous loop as candidate actions (each with the
// example searches it should move the needle on, so we can re-measure them).
// ─────────────────────────────────────────────────────────────────────

export interface Recommendation {
  kind: "win_missing" | "strengthen_existing";
  action: string; // what to change, concretely (a GEO/SEO move)
  rationale: string; // why this should move the needle
  exampleQueries: string[]; // searches this targets, for re-measurement
}

export interface Diagnosis {
  rankedOn: string[]; // searches we appear on
  missingOn: string[]; // searches we don't
  whatWorks: string[]; // patterns behind the wins
  whatsMissing: string[]; // SEO/GEO gaps behind the losses
  recommendations: Recommendation[];
}

export async function diagnose(args: {
  brandName: string;
  domain: string;
  business: string;
  outcomes: SearchOutcome[];
  // Searches where NO strong competitor appears — the easiest to win.
  whitespace?: string[];
}): Promise<Diagnosis> {
  const scored = args.outcomes.filter((o) => !o.error);
  const rankedOn = scored.filter((o) => o.appeared).map((o) => o.query);
  const missingOn = scored.filter((o) => !o.appeared).map((o) => o.query);

  // Build compact context: for winners, who we beat/sat with; for losers, who won.
  const winnerLines = scored
    .filter((o) => o.appeared)
    .map(
      (o) =>
        `- "${o.query}"  (our rank: ${o.position ?? "cited"}; alongside: ${o.rankedEntities
          .slice(0, 5)
          .join(", ")})`,
    )
    .join("\n");
  const loserLines = scored
    .filter((o) => !o.appeared)
    .map(
      (o) =>
        `- "${o.query}"  (winners: ${o.rankedEntities.slice(0, 5).join(", ") || "n/a"})`,
    )
    .join("\n");

  const prompt = `You are a GEO/SEO strategist. Base every recommendation on the playbook below — recommend what actually moves AI citations, not generic advice. Prefer high-impact layers (entity/trust, answer-first content, FAQPage schema, off-site authority, crawler access) and explicitly de-prioritize low-impact ones (llms.txt, "AI-specific" schema).

${STRATEGY_BRIEF}

────────────────────────────────────────

A business is tested against ${scored.length} realistic AI-assistant searches. It appears in ${rankedOn.length} and is absent from ${missingOn.length}.

BUSINESS: "${args.brandName}" (${args.domain}) — ${args.business}

SEARCHES WE ALREADY RANK ON:
${winnerLines || "(none)"}

SEARCHES WE ARE ABSENT FROM (and who wins them):
${loserLines || "(none)"}
${
  args.whitespace?.length
    ? `\nWHITESPACE — absent searches where NO strong competitor appears (only weak/thin players). These are the EASIEST to win; prioritize win_missing recommendations that target them:\n${args.whitespace
        .map((q) => `- ${q}`)
        .join("\n")}`
    : ""
}

Decode the difference. Be concrete and specific to this business — not generic advice. When you recommend win_missing actions, prefer targeting the whitespace searches first.

Return ONLY JSON, no prose:
{
  "whatWorks": ["why we rank on the winners — content, structure, entities, or authority patterns"],
  "whatsMissing": ["what our SEO/GEO lacks that keeps us out of the losers"],
  "recommendations": [
    {"kind":"win_missing","action":"<specific GEO/SEO change>","rationale":"<why it moves the needle>","exampleQueries":["<2-4 of the absent searches this targets>"]},
    {"kind":"strengthen_existing","action":"...","rationale":"...","exampleQueries":["..."]}
  ]
}`;

  try {
    const raw = await generateText(prompt, { temperature: 0.3 });
    const jsonText = raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1);
    const parsed = JSON.parse(jsonText) as Partial<Diagnosis>;
    return {
      rankedOn,
      missingOn,
      whatWorks: parsed.whatWorks ?? [],
      whatsMissing: parsed.whatsMissing ?? [],
      recommendations: (parsed.recommendations ?? []).map((r) => ({
        kind: r.kind === "strengthen_existing" ? "strengthen_existing" : "win_missing",
        action: r.action ?? "",
        rationale: r.rationale ?? "",
        exampleQueries: (r.exampleQueries ?? []).slice(0, 6),
      })),
    };
  } catch {
    return {
      rankedOn,
      missingOn,
      whatWorks: [],
      whatsMissing: [],
      recommendations: [],
    };
  }
}
