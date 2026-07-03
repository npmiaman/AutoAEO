import "server-only";

// ─────────────────────────────────────────────────────────────────────
// The AEO/SEO strategy the agent follows. Distilled from a July-2026 deep
// research brief (industry publications, Princeton GEO study, expert
// commentary from Lily Ray / Mike King / Rand Fishkin, and documented case
// studies). Full brief: docs/aeo-seo-strategy.md.
//
// Two consumers:
//   1. `STRATEGY_BRIEF` is injected into the diagnosis + planning prompts so
//      the agent's recommendations reflect what actually moves AI citations,
//      not generic SEO folklore.
//   2. `PLAYBOOK_ACTIONS` enumerates the concrete moves the autonomous loop
//      can take (Phase 4 SEO/AEO actions map onto these), each tagged with the
//      strategy layer and expected impact so the loop can prioritize.
// ─────────────────────────────────────────────────────────────────────

// Compact, high-signal version for prompt injection. Kept tight on purpose —
// it's context for every diagnosis call, so every line must earn its tokens.
export const STRATEGY_BRIEF = `AEO/SEO PLAYBOOK (what actually moves AI citations in 2026):

FIRST PRINCIPLE: AEO sits ON TOP of SEO — most AI engines (ChatGPT, Perplexity, Gemini) retrieve from a live search index (RAG). If a page doesn't rank in classic search, it usually can't be cited. Fix SEO fundamentals first; they are the foundation, not a separate old discipline.

1. ENTITY & TRUST FOUNDATION (do first):
- Consistent Organization/Person identity everywhere (same name, logo, description, links across site, LinkedIn, Crunchbase, G2/Clutch, Google Business Profile).
- One Organization schema @id referenced site-wide so the site reads as ONE entity.
- Claim Wikidata item with sameAs links where eligible (strongest entity signal).
- VERIFY crawlers aren't blocked: GPTBot, ClaudeBot, PerplexityBot, OAI-SearchBot, ChatGPT-User, Google-Extended, CCBot in robots.txt AND any CDN/WAF (Cloudflare blocks AI bots by default for many). A single blocked crawler makes you invisible for no other reason.

2. ANSWER-FIRST CONTENT:
- Lead every section with a direct, self-contained answer in the first 40–100 words, then expand. Write the opener as if it's the only thing the AI reads.
- Question-format H2/H3 headings mirroring real prompts ("How does X work" not "X Overview").
- Tables earn ~2.5x more AI citations than the same info as prose — use them for data.
- Fact/statistic density every ~150–200 words; back claims with numbers, named sources, expert quotes. Unsupported opinion gets cited far less.
- Cover query fan-out: AI splits one question into sub-queries — answer the likely sub-questions as their own sections.
- Depth with substance: thin AI-generated summaries get filtered out; original expertise/data gets cited.

3. STRUCTURED DATA (by citation impact):
- FAQPage — highest impact (35–60% higher citation rates). Only mark up FAQs answered on the visible page; AI validates schema vs visible content and demotes mismatches.
- HowTo — for step-by-step/tutorial queries.
- Article + Author/Person — ties content to a named, credentialed author (E-E-A-T).
- Organization + BreadcrumbList + DefinedTerm — identity + glossary clarity.
- 3+ schema types together compound. No "AI-only" schema exists — standard schema.org is sufficient (Google's May-2026 guidance).

4. llms.txt — LOW PRIORITY: independent 2026 studies (Limy, OtterlyAI, ALLMO, SE Ranking) + Google's own guide show ~no measurable citation impact. Cheap to add, but NOT a strategy. Never treat it as a primary lever.

5. OFF-SITE AUTHORITY (most-skipped, high-impact):
- AI weights third-party mentions over brand-owned claims: Reddit, Quora, G2/Capterra, LinkedIn, trade press, podcasts.
- Digital PR that earns real backlinks helps citations AND rankings (they mirror each other).
- Freshness matters disproportionately: 83% of AI citations for evaluation-stage queries came from pages updated within 12 months. Refresh evergreen content.
- Identify the 2–3 external domains already generating citations in the niche and pursue placement there.

6. MEASUREMENT:
- Run a fixed set of real buyer prompts across ChatGPT/Claude/Gemini/Perplexity regularly; each has a different retrieval stack, so a citation on one ≠ all.
- GEO output is probabilistic — use rolling averages, not single spot-checks.
- Track qualified leads from AI-referred sessions, not just visibility.

OUTDATED / DON'T: keyword stuffing, exact-match keyword titles, mass low-quality backlinks, thin/programmatic content at scale, judging success by rankings alone, chasing every algo update, generic "what is X" content with no unique angle, treating llms.txt or "AI-specific schema" as citation levers.`;

// The concrete moves the autonomous loop can choose from. Phase 4 SEO/AEO
// actions implement these; the loop prioritizes by `impact` and whether the
// diagnosis flagged the relevant gap.
export type StrategyLayer =
  | "entity_trust"
  | "answer_first"
  | "structured_data"
  | "off_site"
  | "technical"
  | "measurement";

export interface PlaybookAction {
  id: string;
  layer: StrategyLayer;
  title: string;
  description: string;
  impact: "high" | "medium" | "low";
  // Which measurement gaps this is meant to close, for loop targeting.
  addresses: string;
}

export const PLAYBOOK_ACTIONS: PlaybookAction[] = [
  {
    id: "crawler-access",
    layer: "technical",
    title: "Unblock AI crawlers (robots.txt + WAF)",
    description:
      "Ensure GPTBot, ClaudeBot, PerplexityBot, OAI-SearchBot, Google-Extended, CCBot are allowed in robots.txt and not blocked by CDN/WAF.",
    impact: "high",
    addresses: "invisible across all/most searches (nothing crawled)",
  },
  {
    id: "org-schema-identity",
    layer: "entity_trust",
    title: "Unified Organization schema + consistent entity",
    description:
      "Single Organization @id referenced site-wide with sameAs to LinkedIn/Crunchbase/GBP; consistent name/logo/description everywhere.",
    impact: "high",
    addresses: "brand not recognized as an entity; inconsistent across queries",
  },
  {
    id: "faq-schema",
    layer: "structured_data",
    title: "FAQPage schema on answer pages",
    description:
      "Add FAQPage schema for FAQs genuinely answered on the visible page. Highest-impact schema type for citations.",
    impact: "high",
    addresses: "absent on question-style / how-to searches",
  },
  {
    id: "answer-first-rewrite",
    layer: "answer_first",
    title: "Answer-first content restructure",
    description:
      "Lead sections with a self-contained 40–100 word answer; question-format headings; tables for data; fact density with sources.",
    impact: "high",
    addresses: "ranks below competitors / not quoted despite being relevant",
  },
  {
    id: "howto-schema",
    layer: "structured_data",
    title: "HowTo schema on tutorial content",
    description: "Add HowTo schema to step-by-step content for how-to queries.",
    impact: "medium",
    addresses: "absent on 'how to' / DIY searches",
  },
  {
    id: "author-eeat",
    layer: "entity_trust",
    title: "Author/Person schema + E-E-A-T signals",
    description:
      "Named authors with real bios/credentials, Article+Author schema, clear About page.",
    impact: "medium",
    addresses: "trust/expertise-sensitive searches (reviews, advice)",
  },
  {
    id: "query-fanout-coverage",
    layer: "answer_first",
    title: "Cover query fan-out sub-topics",
    description:
      "For each target query, add well-covered sections answering the likely sub-queries the AI decomposes it into.",
    impact: "medium",
    addresses: "adjacent / comparison searches where competitors appear",
  },
  {
    id: "freshness-refresh",
    layer: "off_site",
    title: "Refresh evergreen pages",
    description:
      "Update stats, examples, and dates on key pages; recency drives evaluation-stage citations.",
    impact: "medium",
    addresses: "losing to fresher competitor pages on commercial queries",
  },
  {
    id: "machine-layer",
    layer: "technical",
    title: "Machine-readable layer + llms.txt",
    description:
      "Clean structured version for crawlers. LOW citation impact per 2026 data — do only as cheap hygiene, never as a primary lever.",
    impact: "low",
    addresses: "crawler ingestion hygiene (not a citation driver)",
  },
];
