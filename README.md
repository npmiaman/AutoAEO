# AutoAEO

**An autonomous SEO + AEO agent. It measures where your site shows up in AI search, fixes what's missing, verifies the fix actually helped, and remembers what worked — on Shopify or any custom-coded site.**

---

## What it does

AI assistants (ChatGPT, Perplexity, Gemini) increasingly answer buying questions directly — and if they don't surface *you*, they surface a competitor. AutoAEO runs a continuous loop:

1. **Measure (autoresearch).** It generates ~50 realistic searches a real person would type for your business (including adjacent ones), runs them against live, web-grounded AI engines, and reports — with no vanity score — **how often you show up, which searches you're invisible on, and exactly who's winning them instead.**
2. **Diagnose.** An LLM, grounded in a real 2026 AEO/SEO strategy playbook ([docs/aeo-seo-strategy.md](docs/aeo-seo-strategy.md)), decodes *why* you win the searches you win and what's missing on the ones you don't.
3. **Act.** An autonomous agent composes flexible tools — write schema (FAQPage/HowTo/Organization JSON-LD), rewrite content answer-first, fix meta, set robots, create redirects — to close the gaps it found.
4. **Verify + keep/rollback.** Every change is snapshotted, then the targeted searches are re-measured. A clean win is kept; anything that doesn't help is **automatically reverted**.
5. **Remember.** Every outcome is written to an experiment memory (SQL + vector recall), so the agent never repeats a dead end or redoes a win.

This runs as a **daily batch** per site. The safety mechanism for "fully autonomous" is reversibility: nothing survives that didn't measurably improve visibility.

## Works on any site

- **Shopify** — OAuth, writes to the theme / pages / metafields (with before/after diffs + one-click rollback, described below).
- **Any custom site / landing page** — the agent crawls it, and the changes are delivered via **[`@autoaeo/sdk`](packages/sdk)** (runtime injection in Next.js/any app) or **`npx autoaeo build`** (build-time artifacts for static/JAMstack sites). Startups and hand-coded sites get the same agent.

## Try the visibility scan (no setup)

```bash
npm run scan -- --business "a plumber in Columbus, Ohio" \
                --brand "The Eco Plumbers" --domain ecoplumbers.com
```

Prints, for any business: appearance rate across live AI searches, per-search who-ranks, the competitors beating you, and strategy-grounded recommendations. (`npm run loop -- --site <id>` runs the full apply/measure/rollback cycle against a connected site.)

Requires `OPENAI_API_KEY` in `.env.local`. Engines are pluggable (`MEASUREMENT_ENGINES`); OpenAI's grounded `search-preview` model is the default.

---

## Shopify machine layer (Pillar 1)

AutoAEO also connects to your Shopify store via OAuth and publishes a clean, machine-readable version alongside your existing storefront. Your customers still see your theme; AI agents — guided by `/llms.txt`, `<link rel="alternate">`, and an AI-friendly `robots.txt` — are routed to a stripped-down, structured version built for them to parse and quote. Every change is shown as a before/after diff and can be rolled back in one click.

---

## The problem in one paragraph

Search engines have spent 25 years figuring out how to read messy HTML. AI engines are starting from scratch — and they prefer sites that hand them clean, structured data. When ChatGPT tries to answer "what's a good stainless-steel kitchen widget under $50," it has to wade through 1–3 MB of JavaScript, theme chrome, popups, and tracking pixels to find your product. Half the time it gives up and cites someone else. AutoAEO fixes this by giving AI agents their own purpose-built version of your store — without changing anything for human visitors.

## Before / after

What the same `/products/widget` URL looks like to two different audiences after AutoAEO runs:

| | **Human visitor** | **AI agent** |
|---|---|---|
| URL | `yourstore.com/products/widget` | `yourstore.com/products/widget?view=machine` (discovered via `<link rel="alternate">`) |
| Layout | Full theme | Bare markdown |
| Navigation | Header, mega-menu, footer | None |
| Images | Hero, gallery, zoom | URLs only |
| JavaScript | Loaded | None |
| Reviews | Interactive widget | Plain summary |
| Page weight | 1–3 MB | 5–15 KB |
| Time to extract product info | Seconds (lossy) | Milliseconds (perfect) |

## What AutoAEO ships to your store

After running the **Machine Layer** playbook on a connected store and approving the proposed changes:

| Artifact | Path | Purpose |
|---|---|---|
| `llms.txt` | `/pages/llms.txt` | Markdown index of every product, collection, page, and article — the standard AI-discoverable manifest |
| `llms-full.txt` | `/pages/llms-full.txt` | Full corpus, concatenated, for one-shot AI ingestion |
| Machine layout | `layout/machine.liquid` | Bare HTML shell — no nav, footer, or JS |
| Machine sections | `sections/machine-{product,collection,page,article}.liquid` | Markdown-style renderers, one per resource type |
| Machine templates | `templates/{product,collection,page,article}.machine.json` | Wire the sections via Shopify's `?template_suffix=machine` mechanism |
| AI-friendly `robots.txt` | `config/robots.txt.liquid` | Explicitly allows GPTBot, ChatGPT-User, OAI-SearchBot, ClaudeBot, anthropic-ai, PerplexityBot, Google-Extended, Applebot-Extended, CCBot — and lists `/llms.txt` as a sitemap |
| Discovery link | `layout/theme.liquid` `<head>` | Injects `<link rel="alternate" type="text/markdown" href="...?view=machine">` so crawlers landing on human URLs find the alternate |

After applying, you can verify by visiting:

- `yourstore.com/llms.txt` — the markdown index
- `yourstore.com/products/anything?view=machine` — the stripped machine version
- `yourstore.com/robots.txt` — the AI-bot directives

## Sample `/llms.txt` output

```markdown
# Acme Kitchen Co

> Stainless steel kitchen tools, designed in Brooklyn, made in the USA.

Storefront: https://acmekitchen.com

## Products
- [Acme Widget](/products/widget?view=machine) — USD 49.00: 304 stainless steel kitchen tool, dishwasher-safe top rack, 2-year warranty.
- [Pro Widget](/products/pro-widget?view=machine) — USD 79.00: Titanium upgrade with 5-year warranty.
- [Mini Widget](/products/mini?view=machine) — USD 29.00: Compact version for travel.

## Collections
- [Best sellers](/collections/best?view=machine): Our most-loved tools.
- [New arrivals](/collections/new?view=machine): Released this season.

## Pages
- [About](/pages/about?view=machine): Our story and what we make.
- [Care guide](/pages/care?view=machine): How to keep your tools in top shape.

---
_This page is the AI-readable index for this store. Generated by AutoAEO._
```

## How it works

```
1. Connect            → Shopify OAuth. Access token encrypted at rest (AES-256-GCM).

2. Read               → Pull products, collections, pages, articles via Shopify GraphQL.

3. Generate           → Build llms.txt, machine templates, robots.txt. Diff against
                        existing theme assets — skip anything already up-to-date.

4. Review             → Every proposed change shown as a before/after diff in the UI.

5. Approve / Reject   → Per-change buttons, or one-click "Approve all".

6. Apply              → Writes approved changes to your published theme via the Asset
                        API + creates Online Store pages.

7. Rollback           → One click reverses every applied change using the stored
                        before snapshots. Theme assets restored or deleted, pages
                        deleted if newly created.
```

The full happy path takes about six clicks: sign up → enter store domain → install on Shopify → run playbook → approve all → apply. Total time on a clean dev store: under two minutes.

## Quick start

See [SETUP.md](./SETUP.md) for the complete walkthrough (Shopify Partner account → development store → Partner app → environment variables → connect).

```bash
git clone https://github.com/amandilippandit/AutoAEO.git
cd AutoAEO
npm install
cp .env.example .env.local       # then fill in SHOPIFY_API_KEY / SECRET / ANTHROPIC_API_KEY
npm run db:push                  # apply schema to local SQLite
npm run dev
```

Open `http://localhost:3000` → sign up → connect a Shopify dev store.

## Stack

| Layer | Tools |
|---|---|
| Frontend | Next.js 16 (App Router · Turbopack) · TypeScript · Tailwind v4 · shadcn/ui (Base UI) |
| Auth | better-auth (email + password) |
| DB | Drizzle ORM · SQLite (libsql) locally · Postgres-ready for production |
| Shopify | Custom OAuth (HMAC-verified) · Admin GraphQL · Asset + Pages REST · AES-256-GCM token encryption |
| Agent | Vercel AI SDK · Anthropic Claude (installed; LLM-driven playbooks coming next) |

## Project layout

```
AutoAEO/
├── src/
│   ├── app/                            Next.js App Router
│   │   ├── (signin|signup)/
│   │   ├── dashboard/                  Stores list
│   │   ├── connect/                    Connect a Shopify store
│   │   ├── shops/[shopId]/
│   │   │   ├── audit/                  Playbook launcher + recent runs
│   │   │   ├── runs/[runId]/           Diff review · approve · apply · rollback
│   │   │   └── actions.ts              Server actions
│   │   └── api/
│   │       ├── auth/[...all]/          better-auth handler
│   │       └── shopify/                OAuth install + callback
│   ├── lib/
│   │   ├── auth.ts                     better-auth server config
│   │   ├── crypto.ts                   AES-256-GCM token encryption
│   │   ├── db/                         Drizzle schema + client
│   │   ├── shopify/                    Client · OAuth · scopes · REST writes
│   │   └── agent/
│   │       ├── runner.ts               Playbook execution + persistence
│   │       ├── applier.ts              Apply + rollback orchestrators
│   │       └── playbooks/
│   │           └── machine-layer/      The first playbook
│   └── components/                     shadcn UI + dashboard shell
├── SETUP.md                            Full setup walkthrough
└── drizzle.config.ts
```

## Safety properties

- **Per-proposal approval** — every change requires explicit Approve before Apply considers it.
- **Reversible** — every applied proposal stores its prior state. One click rolls them all back.
- **Idempotent re-runs** — running a playbook again skips assets that already match the proposed content.
- **Auth-scoped** — every server action verifies shop/run ownership against the signed-in user.
- **Encrypted tokens** — Shopify access tokens never touch the DB in plaintext.
- **HMAC-verified callbacks** — Shopify OAuth callbacks fail closed on signature mismatch.

## Status

**v0.1** — Foundation + Machine Layer playbook, end-to-end. Run, review, approve, apply, rollback all working against a live Shopify dev store.

### Built

- [x] Sign up / sign in (better-auth)
- [x] Shopify OAuth flow with HMAC verification + AES-256-GCM token encryption
- [x] Multi-tenant DB schema (users, shops, runs, proposals)
- [x] Machine Layer playbook (llms.txt, llms-full.txt, machine layout/sections/templates, robots.txt, alternate-link injection)
- [x] Per-proposal diff review with approve / reject / approve-all
- [x] Apply approved proposals to the published theme
- [x] One-click rollback using stored before snapshots

### Up next (in priority order)

- [ ] Audit / scoring page — quantify "your AEO score is X/100" before users click Run
- [ ] Schema markup playbook — Organization, Product, BreadcrumbList, FAQPage JSON-LD
- [ ] Meta description rewriter — first LLM-driven playbook
- [ ] AEO FAQ sections playbook — question-first FAQ blocks with FAQPage schema
- [ ] Duplicate-theme preview before applying

### Production blockers (before public merchant use)

- [ ] GDPR + uninstall webhooks (mandatory for Shopify Public Apps)
- [ ] Background job runner for large stores (>60 s runs would time out today)
- [ ] Postgres / Turso for the production DB
- [ ] Rate-limit backpressure (Shopify Basic is 2 req/s)
- [ ] HTTPS deployment + Partner app reconfigured for prod URLs

## Roadmap

| Phase | Theme |
|---|---|
| **v0.1 (now)** | Foundation + Machine Layer |
| **v0.2** | Audit scoring · Schema markup playbook |
| **v0.3** | First LLM-driven playbook (meta descriptions) · AEO FAQ sections |
| **v0.4** | Duplicate-theme preview · webhooks · background jobs |
| **v0.5** | LLM-driven smart `llms.txt` · brand-aware copy · AI-crawler analytics |
| **v1.0** | Shopify App Store readiness · billing · production deploy |

## License

Private repository. All rights reserved.
