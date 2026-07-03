import "server-only";
import { generateText } from "./llm";
import { STRATEGY_BRIEF } from "@/lib/agent/strategy";
import type { CompetitiveMap } from "./competitors";
import type { Diagnosis } from "./diagnosis";

// ─────────────────────────────────────────────────────────────────────
// Improvement planner. Turns a scan (where we stand + who ranks where +
// focus signals) into an ACTION PLAN, not a score:
//
//   overall strategies
//     └─ focus areas (quick-win whitespace, strengthen wins, crack contested)
//          └─ multiple TESTS per area, each with a concrete KPI tied to
//             specific searches — so the periodic evaluator can re-measure
//             them, see where we got signal, and double down.
//
// Every KPI's targetQueries are REAL searches from the scan, so they can be
// re-run verbatim weeks later for a true before/after comparison.
// ─────────────────────────────────────────────────────────────────────

export interface Kpi {
  metric: string; // human: what success looks like
  targetQueries: string[]; // the exact searches to re-measure
  target: number; // appear on >= this many of them
  windowDays: number; // by when
}

export interface Test {
  hypothesis: string;
  action: string; // the concrete change to make
  kpi: Kpi;
}

export interface FocusArea {
  title: string;
  signal: "quick_win" | "strengthen" | "contested";
  rationale: string;
  tests: Test[]; // multiple tests to try in parallel; keep the winners
}

export interface ImprovementPlan {
  overallStrategies: string[];
  focusAreas: FocusArea[];
}

export async function buildImprovementPlan(args: {
  brandName: string;
  domain: string;
  business: string;
  competitors: CompetitiveMap;
  diagnosis: Diagnosis;
}): Promise<ImprovementPlan> {
  const { competitors: c, diagnosis } = args;

  const basisLines = c.basis
    .map(
      (b) =>
        `- ${b.name} ranks via: ${b.factors.slice(0, 2).join("; ")}. Beat by: ${b.howToBeat
          .slice(0, 2)
          .join("; ")}`,
    )
    .join("\n");

  const prompt = `You are a GEO/SEO strategist building an EXPERIMENT PLAN for a business to show up more in AI-assistant answers. Ground everything in this playbook:

${STRATEGY_BRIEF}
────────────────────────────────────────

BUSINESS: "${args.brandName}" (${args.domain}) — ${args.business}

WHERE WE STAND: appear on ${c.ourAppearances}/${c.totalSearches} searches.

QUICK-WIN WHITESPACE (absent, NO strong competitor — attack first; monthly search demand shown, prioritize HIGH demand):
${
  c.focus.quickWins
    .map((q) => {
      const d = c.demand[q];
      const vol = d?.monthlyVolume;
      return `- ${q}  [${vol != null ? `~${vol}/mo demand${d.source === "llm-estimate" ? " est." : ""}` : "demand unknown"}]`;
    })
    .join("\n") || "- (none)"
}

SEARCHES WE WIN (defend/strengthen):
${c.focus.ourWins.map((q) => `- ${q}`).join("\n") || "- (none)"}

CONTESTED (dominated by strong competitors — hardest):
${c.focus.entrenched.map((q) => `- ${q}`).join("\n") || "- (none)"}

WHY LEADERS RANK:
${basisLines || "- (not analyzed)"}

WHAT'S MISSING: ${diagnosis.whatsMissing.join(" ") || "n/a"}

Produce a plan. Rules:
- 2-4 overall strategies (portfolio-level).
- 2-4 focus areas. Start with quick_win areas. Each focus area gets 2-3 DISTINCT tests (different approaches to the same goal — so we can compare and keep the winner).
- Each test has a concrete "action" (a specific GEO/SEO change) and a KPI.
- KPI.targetQueries MUST be chosen verbatim from the searches listed above (so we can re-measure them). target = how many of those searches we aim to appear on. windowDays = realistic (quick wins 14, harder 45-90).

Return ONLY JSON:
{"overallStrategies":["..."],
 "focusAreas":[
   {"title":"...","signal":"quick_win","rationale":"...",
    "tests":[
      {"hypothesis":"...","action":"...","kpi":{"metric":"...","targetQueries":["<verbatim search>"],"target":2,"windowDays":14}}
    ]}
 ]}`;

  try {
    const raw = await generateText(prompt, { temperature: 0.4 });
    const parsed = JSON.parse(
      raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1),
    ) as ImprovementPlan;
    return {
      overallStrategies: parsed.overallStrategies ?? [],
      focusAreas: (parsed.focusAreas ?? []).map((f) => ({
        title: f.title ?? "",
        signal: f.signal ?? "quick_win",
        rationale: f.rationale ?? "",
        tests: (f.tests ?? []).map((t) => ({
          hypothesis: t.hypothesis ?? "",
          action: t.action ?? "",
          kpi: {
            metric: t.kpi?.metric ?? "",
            targetQueries: t.kpi?.targetQueries ?? [],
            target: t.kpi?.target ?? 1,
            windowDays: t.kpi?.windowDays ?? 14,
          },
        })),
      })),
    };
  } catch {
    return { overallStrategies: [], focusAreas: [] };
  }
}
