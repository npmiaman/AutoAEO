# @pigeon/sdk

**Make your site show up in AI search (ChatGPT, Perplexity, Gemini) — for any site, not just Shopify.**

Pigeon's agent continuously analyzes your site against real AI-assistant searches, figures out where you're invisible and who's beating you, and generates the fixes (schema.org JSON-LD, better meta, an `llms.txt`). This SDK applies those fixes to your site — at **runtime** (SDK) or **build time** (CLI). You write no optimization code; the agent does the thinking.

## Install

```bash
npm install @pigeon/sdk
```

Get an API key by connecting your site at [app.pigeon.com](https://app.pigeon.com).

## Runtime (Next.js App Router)

```ts
// lib/aeo.ts
import { createPigeon } from "@pigeon/sdk";
export const aeo = createPigeon({ apiKey: process.env.PIGEON_KEY! });
```

```tsx
// app/page.tsx
import { pigeonMetadata, PigeonJsonLd } from "@pigeon/sdk/next";
import { aeo } from "@/lib/aeo";

export async function generateMetadata() {
  return pigeonMetadata(aeo, "/"); // AI-optimized <title>/<meta description>
}

export default async function Page() {
  return (
    <>
      {await PigeonJsonLd({ client: aeo, path: "/" })} {/* injects JSON-LD */}
      <main>…</main>
    </>
  );
}
```

```ts
// app/llms.txt/route.ts
import { llmsTxtResponse } from "@pigeon/sdk/next";
import { aeo } from "@/lib/aeo";
export const GET = () => llmsTxtResponse(aeo);
```

## Build time (any static / JAMstack site)

```jsonc
// package.json
{ "scripts": { "prebuild": "pigeon build --key $PIGEON_KEY" } }
```

Writes `public/llms.txt` and `public/pigeon-artifacts.json` (per-route meta + JSON-LD) into your build output for your framework to inline.

## Framework-agnostic core

```ts
import { createPigeon, renderJsonLd } from "@pigeon/sdk";
const aeo = createPigeon({ apiKey: "…" });
const route = await aeo.getRoute(req.path);
res.setHeader("…"); // set <title>/<meta> from route.title / route.description
html = html.replace("</head>", renderJsonLd(route) + "</head>");
```

Fails safe: a network hiccup never breaks your site — it serves stale artifacts or nothing.
