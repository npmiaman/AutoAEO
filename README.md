# AutoAEO

AI-search optimization for Shopify. Connect a store and ship a machine-readable layer (`/llms.txt`, schema markup, AEO-optimized sections) with one click — fully reversible, gated by per-change human approval.

## Stack

- Next.js 16 (App Router, Turbopack) · TypeScript · Tailwind v4 · shadcn/ui (Base UI)
- Drizzle ORM + SQLite locally (libsql)
- better-auth (email + password)
- Custom Shopify OAuth (HMAC-verified, AES-256-GCM encrypted access tokens at rest)
- Vercel AI SDK + Anthropic Claude (wired, not yet invoked by playbooks)

## What it ships today

The **Machine Layer** playbook generates and applies (after approval):

- `/pages/llms.txt` — markdown index of products, collections, pages, articles
- `/pages/llms-full.txt` — concatenated full corpus for one-shot AI ingestion
- `layout/machine.liquid` — bare HTML shell, no nav/footer/JS
- `sections/machine-{product,collection,page,article}.liquid` — markdown-style renderers
- `templates/{product,collection,page,article}.machine.json` — wire sections via `?template_suffix=machine`
- `config/robots.txt.liquid` — explicitly invites GPTBot, ClaudeBot, PerplexityBot, OAI-SearchBot, Google-Extended, etc., and lists `/llms.txt` as a sitemap
- `<link rel="alternate" type="text/markdown">` injected into `theme.liquid` `<head>`

Per-change diff review, approve / reject / approve-all, apply to the published theme, one-click rollback.

## Quick start

See [SETUP.md](./SETUP.md) for the full path: Partner account → dev store → Partner app → `.env.local` → connect.

```bash
npm install
npm run db:push
npm run dev
```

## Roadmap (next)

- Schema markup playbook (Organization, Product, BreadcrumbList, FAQPage JSON-LD)
- Meta description rewriter (first LLM-driven playbook)
- AEO FAQ sections playbook
- Audit / scoring page (0-100 per Tech / GEO / AEO)
- Duplicate-theme preview before applying
- GDPR + uninstall webhooks
- Background job runner for large stores
