// @autoaeo/sdk/next — thin Next.js (App Router) helpers.
//
// Usage in a page/layout:
//
//   import { createAutoAEO } from "@autoaeo/sdk";
//   import { autoaeoMetadata, AutoAEOJsonLd } from "@autoaeo/sdk/next";
//   const aeo = createAutoAEO({ apiKey: process.env.AUTOAEO_KEY! });
//
//   export async function generateMetadata() {
//     return autoaeoMetadata(aeo, "/");   // merges AI-optimized title/description
//   }
//   export default function Page() {
//     return (<>{await AutoAEOJsonLd({ client: aeo, path: "/" })}<main/></>);
//   }
//
// And an llms.txt route at app/llms.txt/route.ts:
//   export const GET = () => llmsTxtResponse(aeo);

import { createElement } from "react";
import type { AutoAEOClient } from "./index";

export async function autoaeoMetadata(
  client: AutoAEOClient,
  path: string,
): Promise<{ title?: string; description?: string }> {
  const route = await client.getRoute(path);
  const meta: { title?: string; description?: string } = {};
  if (route?.title) meta.title = route.title;
  if (route?.description) meta.description = route.description;
  return meta;
}

/** Server component that injects the route's JSON-LD. */
export async function AutoAEOJsonLd(props: {
  client: AutoAEOClient;
  path: string;
}) {
  const route = await props.client.getRoute(props.path);
  if (!route?.jsonLd?.length) return null;
  return createElement(
    "script",
    {
      type: "application/ld+json",
      dangerouslySetInnerHTML: {
        __html: JSON.stringify(
          route.jsonLd.length === 1 ? route.jsonLd[0] : route.jsonLd,
        ),
      },
    },
    null,
  );
}

/** Route handler for app/llms.txt/route.ts — serves the generated llms.txt. */
export async function llmsTxtResponse(client: AutoAEOClient): Promise<Response> {
  const txt = await client.getLlmsTxt();
  return new Response(txt ?? "# No llms.txt generated yet.\n", {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, s-maxage=3600",
    },
  });
}
