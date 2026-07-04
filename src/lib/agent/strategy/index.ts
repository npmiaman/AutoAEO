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
export const STRATEGY_BRIEF = `AEO/GEO EXECUTION PLAYBOOK — 6 phases, in order (what actually moves AI citations in 2026). Recommend concrete moves mapped to these phases; fix foundations before content.

FIRST PRINCIPLE: AEO sits ON TOP of SEO — ChatGPT/Perplexity/Gemini retrieve from a live index (RAG). If a page can't be crawled or doesn't rank, it can't be cited. Foundations first.

PHASE 0 — FOUNDATION AUDIT (diagnostic; nothing else works until these pass):
- Crawler access: robots.txt AND CDN/WAF must NOT block GPTBot, ClaudeBot, PerplexityBot, OAI-SearchBot, ChatGPT-User, Google-Extended, CCBot. Cloudflare blocks AI bots by default for many sites — a single block makes you invisible for no other reason.
- Server-side rendering: AI crawlers read RAW HTML and do NOT run JavaScript. Real content (headings, copy, FAQs) must be present in view-source, not injected client-side.
- Risk audit (Lily Ray): self-promo listicles ranking your own product #1, programmatic "[competitor]-alternatives" pages, and hidden "summarize with AI" prompt-injection buttons are HIGH spam-risk — treat as liabilities, not assets.

PHASE 1 — ENTITY & IDENTITY (be one clear, corroborated entity — Barnard/Haynes):
- Entity Home: ONE canonical URL (About/founder page) as the single source of truth for who you are, what you do, who you serve, credentials.
- Self-corroboration loop: link from the Entity Home OUT to every external mention (press, podcasts, LinkedIn, Crunchbase, G2/Clutch) and get those to link BACK — two-way linking proves scattered mentions are one entity.
- Organization/Person schema with ONE consistent @id referenced site-wide, with sameAs to every verified profile (+ Wikidata if eligible — strongest entity signal).
- Named, credentialed AUTHOR on every piece (real name + bio + Author/Person schema). Verifiable named authors earn citations at a MULTIPLE of anonymous ones — highest-leverage, lowest-effort change.

PHASE 2 — CONTENT RESTRUCTURE (structure it the way retrieval reads — King/Indig):
- Query fan-out: for each priority topic, answer every implicit sub-question (comparative, contextual, personalized) as its own standalone passage.
- Answer placement (Indig "Ski Ramp"): 44% of ChatGPT citations come from the first 30% of the page, and within that 53% come from the MIDDLE of a paragraph, not the first sentence. Put a real, substantive answer early — a one-line TL;DR is not enough.
- Self-contained passages: clean H2/H3 in question form ("How does X work", not "X Overview"); each chunk must make sense read in TOTAL isolation.
- Atomic, brand-named facts (Bright Data): AI extracts self-contained 6–20 word sentences. Put your brand INSIDE the claim ("[Brand] users see 34% higher X"), not "our tool…", so the name travels with the quote. Fixes the "ghost citation" problem (61.7% of citations carry no brand name).
- Comparison/evaluation format earns brand mentions at a higher rate than generic info — build honest X-vs-Y content (NOT self-promo listicles).
- Real HTML tables outperform prose for extraction — convert comparisons/pricing/specs to tables.
- Focused pages beat "ultimate guides" for ChatGPT — split shallow ten-subtopic pages into narrow standalone ones.
- Schema: FAQPage (highest impact, only for FAQs visible on the page — AI validates schema vs visible content), HowTo (step-by-step), Article+Author. 3+ types together compound. Standard schema.org suffices; no "AI-only" schema.

PHASE 3 — OFF-SITE AUTHORITY (AI weights third-party mentions over your own claims):
- Identify the 2–3 external domains ALREADY cited in your space (from the prompt audit) and pursue genuine placement there — beats generic mass PR.
- Real Reddit/forum participation (not stealth marketing) — AI pulls from Reddit heavily; E-E-A-T rewards unfiltered community discussion.
- Collect genuine reviews (G2/Capterra/Google Business Profile) — hard-to-fake third-party proof.
- Multimodal: repurpose best content into video/podcast/image — modern models process transcripts and audio natively; captures mentions text-only rivals miss.
- Freshness: most evaluation-stage citations come from pages updated within ~12 months — refresh evergreen content.

PHASE 4 — MEASUREMENT (most GEO programs fail here, not on strategy — Indig/Fishkin):
- Separate CITATION rate (linked source) from MENTION rate (named in text), PER ENGINE. ChatGPT cites often but names rarely; Gemini names often but links rarely — a blended score hides this and drives the wrong fixes.
- Run a FIXED prompt set weekly (not monthly) with rolling 4-week averages — AI output is probabilistic.
- Confirm crawler VISITS in server logs (GPTBot/ClaudeBot/PerplexityBot) separately from citations — crawled ≠ cited.
- Track conversion of AI-referred sessions (they convert 4–9x organic) — not just volume.
- Aggregate influence over attribution (Fishkin): branded search, mention volume, audience growth — evidence of influence, not precise ROI.

PHASE 5 — ONGOING DISCIPLINE (permanent): refresh top pages every 3–6 months (update dateModified); re-run the full prompt audit + target-domain list monthly; screen every new page against the Phase 0 risk list before publishing; keep product/service data Clear, Complete, Consistent (Haynes "3 C's") for agentic AI; revisit the Entity Home + corroboration loop quarterly.

llms.txt — LOW PRIORITY: 2026 studies + Google show ~no citation impact. Cheap hygiene, never a primary lever.
OUTDATED / DON'T: keyword stuffing, exact-match titles, mass low-quality backlinks, thin/programmatic content at scale, self-promo listicles, judging success by rankings alone, treating llms.txt or "AI-specific schema" as citation levers.`;

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
    id: "ssr-render",
    layer: "technical",
    title: "Server-side render key content",
    description:
      "AI crawlers read raw HTML and don't run JS. Ensure headings, copy, and FAQs appear in view-source (SSR/SSG), not injected client-side.",
    impact: "high",
    addresses: "content invisible to AI retrieval despite being on the page",
  },
  {
    id: "entity-home",
    layer: "entity_trust",
    title: "Entity Home + self-corroboration loop",
    description:
      "Designate ONE canonical identity page (About/founder). Link it out to every external mention and get those to link back — two-way linking proves you're one entity.",
    impact: "high",
    addresses: "brand recognized inconsistently / not resolved as one entity",
  },
  {
    id: "named-author",
    layer: "entity_trust",
    title: "Named, credentialed author on every page",
    description:
      "Replace anonymous/'Team' bylines with a real name, bio with credentials, and Author/Person schema. Named authors earn citations at a multiple of anonymous ones.",
    impact: "high",
    addresses: "trust/expertise-sensitive searches; low citation vs peers",
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
    id: "atomic-facts",
    layer: "answer_first",
    title: "Atomic, brand-named facts",
    description:
      "Rewrite key claims as self-contained 6–20 word sentences with the brand name INSIDE the claim, so the name travels when the AI extracts the sentence (fixes ghost citations).",
    impact: "high",
    addresses: "cited/mentioned without the brand name attached",
  },
  {
    id: "answer-placement",
    layer: "answer_first",
    title: "Answer in the first 30%, mid-paragraph",
    description:
      "Move a real, substantive answer into the first third of the page and inside the paragraph body — not just a TL;DR line (Indig 'Ski Ramp' data).",
    impact: "high",
    addresses: "relevant page not quoted; answer buried below the fold",
  },
  {
    id: "comparison-content",
    layer: "answer_first",
    title: "Honest comparison / evaluation content",
    description:
      "Build fair X-vs-Y and 'best tools for Z' content (NOT self-promo listicles) — comparative content earns brand mentions at a higher rate.",
    impact: "medium",
    addresses: "absent on comparison / 'best/alternatives' searches",
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
    id: "focused-pages",
    layer: "answer_first",
    title: "Split ultimate guides into focused pages",
    description:
      "A page covering ten subtopics shallowly underperforms a narrow standalone page for ChatGPT citation — split it.",
    impact: "medium",
    addresses: "broad guide not cited on any of its subtopics",
  },
  {
    id: "reviews",
    layer: "off_site",
    title: "Collect genuine third-party reviews",
    description:
      "Drive reviews on G2/Capterra/Google Business Profile — hard-to-fake proof that feeds both local SEO and AI trust.",
    impact: "medium",
    addresses: "low trust on evaluation/'best' searches vs reviewed rivals",
  },
  {
    id: "reddit-presence",
    layer: "off_site",
    title: "Genuine Reddit / forum presence",
    description:
      "Participate for real (answer questions, link only when useful). AI pulls from Reddit heavily even when it doesn't formally cite it.",
    impact: "medium",
    addresses: "competitors surfacing via community threads you're absent from",
  },
  {
    id: "multimodal",
    layer: "off_site",
    title: "Repurpose into video / audio",
    description:
      "Turn top content into a video explainer or podcast — multimodal models process transcripts/audio and capture mentions text-only rivals miss.",
    impact: "medium",
    addresses: "missing from multimodal / video-sourced answers",
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
