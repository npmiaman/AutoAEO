# AEO + SEO Strategy Brief (July 2026)

> This is the source-of-truth strategy the AutoAEO agent follows. The distilled,
> machine-consumed version lives in [`src/lib/agent/strategy/index.ts`](../src/lib/agent/strategy/index.ts)
> (`STRATEGY_BRIEF` + `PLAYBOOK_ACTIONS`), which is injected into the agent's
> diagnosis and planning prompts. Keep the two in sync when this changes.

Compiled from industry publications, expert commentary (Lily Ray, Rand Fishkin,
Mike King, Aleyda Solis, Jason Barnard, Kevin Indig), the Princeton/Georgia
Tech/IIT Delhi/Allen Institute "GEO: Generative Engine Optimization" paper
(SIGKDD 2024), YouTube/Reddit/Indie Hackers threads, and documented case
studies.

## 1. What AEO is (vs SEO vs GEO)

- **SEO** — ranking pages in classic results. Wins when your page ranks page 1.
- **AEO** — being the direct, extractable answer in a zero-click AI response.
- **GEO** — being cited/quoted as one of 3–8 sources inside a longer AI answer.
- **LLMO / AIO** — vendor-branded synonyms.

**The uncomfortable truth every serious practitioner agrees on:** most AI answer
engines still retrieve from a live web search index (RAG). If your content isn't
ranking in Google/Bing, it usually can't be cited by the AI either. Strong SEO is
the foundation, not a separate old-school discipline.

## 2. The six core strategy layers

### 5.1 Entity & Trust Foundation (do first)
- Consistent Organization/Person identity everywhere (name, description, logo,
  links) across site, LinkedIn, Crunchbase, G2/Clutch, Google Business Profile.
- One Organization schema `@id` referenced across every page → the site reads as
  one recognizable entity.
- Claim a Wikidata item with `sameAs` links where eligible (strongest signal).
- **Verify robots.txt / WAF isn't blocking** GPTBot, ClaudeBot, PerplexityBot,
  OAI-SearchBot, ChatGPT-User, Google-Extended, CCBot. Cloudflare blocks AI bots
  by default for many accounts. This single check rescues whole programs.

### 5.2 Answer-First Content Structure
- Lead every section with a direct, self-contained answer in the first 40–100
  words, then expand.
- Question-format H2/H3 headings that mirror real prompts.
- **Tables earn ~2.5x more AI citations** than the same info as prose.
- Fact/statistic density every ~150–200 words; back claims with numbers, named
  sources, expert quotes.
- Cover **query fan-out** — answer the sub-queries the AI decomposes a question
  into, each as its own section.
- Depth with real expertise; thin AI summaries get filtered out.

### 5.3 Structured Data (by citation impact)
1. **FAQPage** — highest impact (35–60% higher citation rates). Only mark up
   FAQs answered on the visible page; mismatches get demoted.
2. **HowTo** — step-by-step / tutorial queries.
3. **Article + Author/Person** — ties content to a credentialed author (E-E-A-T).
4. **Organization + BreadcrumbList + DefinedTerm** — identity + glossary clarity.
- 3+ schema types compound. No "AI-only" schema exists — standard schema.org is
  sufficient (Google May-2026 guidance).

### 5.4 llms.txt — read the fine print
Independent 2026 studies (Limy — 515M bot events; OtterlyAI; ALLMO — ~94,600
cited URLs; SE Ranking — 300,000 domains) and Google's own May-2026 guide all
converge: **llms.txt currently has essentially no measurable impact on
citations.** Cheap to add, but not a strategy.

### 5.5 Off-Site Authority (the part most people skip)
- AI weights third-party mentions over brand-owned claims: Reddit, Quora,
  G2/Capterra, LinkedIn, trade press, podcasts.
- Digital PR that earns real backlinks helps citations AND rankings.
- **Freshness matters disproportionately:** 83% of AI citations for
  evaluation-stage queries came from pages updated within 12 months.
- Solo founders: real presence on X/Reddit/Indie Hackers/Product Hunt does double
  duty (direct discovery + third-party citation source). See Pieter Levels:
  ChatGPT went from ~4% → ~20% of his traffic in one month via clear, well-titled,
  crawlable pages + strong personal brand.

### 5.6 Measurement (the part everyone gets wrong)
- Standard analytics don't separate AI referral traffic — set a custom channel
  grouping matching `chatgpt|perplexity|copilot|gemini|claude|poe`.
- Check server logs for AI crawler user-agents (crawled ≠ cited).
- Run a fixed set of real buyer prompts across all four engines regularly; each
  has a different retrieval stack.
- GEO output is probabilistic — use rolling averages, not spot-checks.
- Track qualified leads from AI-referred sessions, not just visibility.

## 3. SEO 2026 — Do / Don't / Outdated

**Do:** topical authority via content clusters; write from first-hand experience;
E-E-A-T signals (named authors, About pages); earn backlinks via digital PR;
solid technical SEO (Core Web Vitals, mobile, crawlability); genuine reviews /
community; refresh evergreen content; local intent where relevant.

**Don't:** keyword-stuff; publish thin/AI-generated content at scale; chase spammy
mass link-building; run SEO disconnected from PR/product; judge success by
rankings alone; assume one global page fits every market.

**Outdated:** keyword stuffing / exact-match titles; mass low-quality backlinks;
high volumes of short low-depth posts; hreflang/metadata as the whole
international strategy; chasing every algo update; generic "what is X" content.

## 4. GEO 2026 — Do / Don't / Outdated

**Do:** answer in the first 100–200 words (TLDR-first); cite sources + add stats +
expert quotes (Princeton study: biggest visibility drivers, up to +40%); structure
for query fan-out; confirm AI crawlers can reach server-rendered content; publish
original data; build external earned citations; one primary entity per page with
3–6 linked supporting entities; track Share of Model with a fixed weekly prompt
set (rolling 4-week averages).

**Don't:** treat GEO as one-time; equate length with quality; neglect traditional
SEO; rely on stale/undated content; over-index on a single AI platform; assume
brand-owned content alone gets cited.

**Outdated / overhyped:** llms.txt as a major lever; "AI-specific" schema; keyword
rankings as a proxy for AI visibility; chasing audit-tool scores as the end goal;
SGE "tricks" separate from good content.

## 5. 90-Day Roadmap

| Phase | Timeframe | Focus |
|---|---|---|
| Foundation | Weeks 1–2 | Fix crawler access, unify entity identity, Organization + FAQPage + Article schema on top pages |
| Content restructure | Weeks 3–6 | Answer-first rewrites of top pages, real FAQ sections, tables for data |
| External signals | Weeks 7–10 | Third-party mentions: directories, PR, community, reviews |
| Monitor & iterate | Ongoing | Monthly prompt testing across 4 engines, quarterly schema re-validation, refresh top pages every 6 months |

Typical time-to-first-citation: Perplexity 2–3 weeks; ChatGPT/Claude 30–60 days;
Gemini 60–90 days. No movement by day 90 → usually weak external signals or thin
content, not a missing technical tweak.

## 6. Bottom line

- AEO does not replace SEO — weak SEO undermines AI visibility (RAG).
- The tactics are the fundamentals, sharpened — not secret hacks.
- Distribution and being talked about elsewhere matters as much as on-page work.
- llms.txt is a nice-to-have, not a strategy.
- Measurement is the most commonly skipped step — most teams don't know their
  real AI-citation rate. (This is AutoAEO's wedge.)
