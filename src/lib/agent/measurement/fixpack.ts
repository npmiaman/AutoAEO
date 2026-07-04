import "server-only";
import { generateText } from "./llm";
import { STRATEGY_BRIEF } from "@/lib/agent/strategy";
import type { AeoAudit } from "./aeo-audit";

// ─────────────────────────────────────────────────────────────────────
// Fix Pack — the "do everything" layer. Given the audit's failing checks and the
// searches the site is losing, the agent GENERATES the concrete, paste-ready
// artifacts to fix them: valid JSON-LD schema, visible FAQ Q&As, atomic
// brand-named facts, an answer-first opening rewrite, and an Entity-Home
// outline. Each is tied to a playbook phase so the dashboard can order them.
// ─────────────────────────────────────────────────────────────────────

export interface FixArtifact {
  title: string;
  phase: number;
  kind: "schema" | "content" | "steps"; // how to render/apply it
  body: string; // ready to paste (JSON-LD code, HTML/markdown, or a checklist)
}

export async function generateFixPack(args: {
  brandName: string;
  domain: string;
  business: string;
  audit: AeoAudit;
  topQueries: string[]; // the searches to target (gaps / quick wins)
}): Promise<FixArtifact[]> {
  const fails = args.audit.checks.filter((c) => c.status !== "pass");
  if (fails.length === 0 && args.topQueries.length === 0) return [];

  const prompt = `You are an AEO/GEO engineer. Produce CONCRETE, READY-TO-PASTE artifacts that fix this specific site — real code and copy, not advice. Ground everything in the playbook.

${STRATEGY_BRIEF}

────────────────────────────────────────
BUSINESS: "${args.brandName}" (${args.domain}) — ${args.business}

FAILING/WEAK TECHNICAL CHECKS:
${fails.map((c) => `- [${c.status}] ${c.label}: ${c.detail}${c.fix ? ` → ${c.fix}` : ""}`).join("\n") || "(none)"}

SEARCHES TO WIN (target these with the content artifacts):
${args.topQueries.slice(0, 8).map((q) => `- ${q}`).join("\n") || "(none)"}

Generate the artifacts that are actually needed given the failing checks and target searches. Choose from:
- Organization/Person JSON-LD (only if org-schema is weak/failing): valid schema.org, @id "https://${args.domain}/#organization", real name/url, and sameAs placeholders for LinkedIn/Crunchbase/X.
- FAQPage JSON-LD + the matching VISIBLE Q&As (only if answer-schema is weak/failing): 4-6 real questions drawn from the target searches, each answer 2-4 sentences, self-contained, with "${args.brandName}" named inside the answer.
- Atomic facts: 3-5 self-contained 6-20 word sentences with "${args.brandName}" inside the claim.
- Answer-first opening: a real 60-100 word opening paragraph for the single highest-value target search, with the substantive answer up front and the brand named.
- Entity Home outline (only if entity/corroboration is weak): the sections + exact sameAs/link list for the canonical identity page.

Rules: bodies must be paste-ready. For JSON-LD use a complete <script type="application/ld+json"> block. Be specific to THIS business — no lorem/placeholders except social URLs. Max 7 artifacts, highest-impact first.

Return ONLY a JSON array, no prose:
[{"title":"...","phase":<0-3>,"kind":"schema"|"content"|"steps","body":"...paste-ready..."}]`;

  try {
    const raw = await generateText(prompt, { temperature: 0.4 });
    const json = JSON.parse(
      raw.slice(raw.indexOf("["), raw.lastIndexOf("]") + 1),
    ) as Array<Partial<FixArtifact>>;
    return json
      .map((a) => ({
        title: String(a.title ?? "").trim(),
        phase: Number(a.phase ?? 0),
        kind:
          a.kind === "schema" || a.kind === "steps" ? a.kind : ("content" as const),
        body: String(a.body ?? "").trim(),
      }))
      .filter((a) => a.title && a.body)
      .slice(0, 7);
  } catch {
    return [];
  }
}
