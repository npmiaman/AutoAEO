import "server-only";
import type { Playbook, ProposedChange } from "@/lib/agent/types";
import type { ShopifyClient } from "@/lib/shopify/client";
import {
  fetchPublishedTheme,
  fetchThemeAssetText,
} from "@/lib/agent/playbooks/machine-layer/queries";
import {
  AUTOAEO_SCHEMA_SNIPPET,
  injectSchemaRender,
  themeLiquidHasSchemaInjection,
} from "./generator";
import { enrichSchema } from "./enricher";

// ─────────────────────────────────────────────────────────────────────
// Schema Markup playbook (Pillar 1, Technical GEO).
//
// Two layers:
//
//   A) Deterministic site-wide JSON-LD via Liquid snippet
//      - snippets/autoaeo-schema.liquid (Organization, WebSite, Product,
//        BreadcrumbList, CollectionPage, BlogPosting, WebPage, FAQPage)
//      - {% render 'autoaeo-schema' %} injected into theme.liquid <head>
//
//   B) LLM enrichment per resource (Gemini)
//      - For pages, articles, and richly-described products: classify
//        whether a richer schema.org type applies (Recipe, HowTo,
//        Course, Service, Event, etc.) and extract structured data.
//      - Output JSON-LD entity is stored as autoaeo.schema_extra
//        metafield on the resource.
//      - The snippet conditionally emits this metafield as an
//        additional @graph member.
//
// Layer A is always applied (works without LLM). Layer B requires
// GOOGLE_API_KEY and is skipped gracefully if it's missing.
// ─────────────────────────────────────────────────────────────────────

const MAX_PAGES_TO_ENRICH = 30;
const MAX_ARTICLES_TO_ENRICH = 15;
const MAX_PRODUCTS_TO_ENRICH = 30;
const PRODUCT_DESC_MIN_BYTES = 800;
const PAGE_BODY_MIN_BYTES = 400;
const ARTICLE_BODY_MIN_BYTES = 400;

export const schemaMarkupPlaybook: Playbook = {
  id: "schema-markup",
  name: "Schema Markup",
  description:
    "Deploys schema.org JSON-LD on every page (Organization, WebSite, Product, BreadcrumbList, CollectionPage, BlogPosting, WebPage, FAQPage) via a single dynamic Liquid snippet. With GOOGLE_API_KEY set, Gemini also classifies pages/articles/products and extracts richer schema (Recipe, HowTo, Course, Service, Event, etc.) per-resource into metafields the snippet picks up automatically.",

  async run({ shopify }) {
    const theme = await fetchPublishedTheme(shopify);
    if (!theme) {
      return {
        summary: "No published theme found on this store.",
        proposals: [],
      };
    }

    const proposals: ProposedChange[] = [];

    // ── Layer A: deterministic snippet + theme.liquid inject ─────────

    const snippetKey = "snippets/autoaeo-schema.liquid";
    const existingSnippet = await fetchThemeAssetText(
      shopify,
      theme.id,
      snippetKey,
    );
    if (existingSnippet !== AUTOAEO_SCHEMA_SNIPPET) {
      proposals.push({
        kind: "theme_asset",
        target: snippetKey,
        title: "Schema.org JSON-LD snippet",
        description:
          existingSnippet == null
            ? "Create the dynamic schema generator. Emits Organization, WebSite, Product, BreadcrumbList, CollectionPage, BlogPosting, WebPage, and FAQPage as JSON-LD. Reads autoaeo.schema_extra metafields for LLM-enriched per-resource schema."
            : "Update the schema generator (now reads autoaeo.schema_extra metafields for LLM-enriched per-resource schema in addition to existing types).",
        before: existingSnippet ?? null,
        after: AUTOAEO_SCHEMA_SNIPPET,
      });
    }

    const themeLiquidKey = "layout/theme.liquid";
    const existingThemeLiquid = await fetchThemeAssetText(
      shopify,
      theme.id,
      themeLiquidKey,
    );
    if (existingThemeLiquid && !themeLiquidHasSchemaInjection(existingThemeLiquid)) {
      proposals.push({
        kind: "snippet_inject",
        target: themeLiquidKey,
        title: "Render schema snippet in <head>",
        description:
          "Adds {% render 'autoaeo-schema' %} just before </head> so JSON-LD is emitted on every page.",
        before: existingThemeLiquid,
        after: injectSchemaRender(existingThemeLiquid),
      });
    }

    // ── Layer B: LLM enrichment ──────────────────────────────────────

    const llmAvailable =
      !!process.env.GOOGLE_API_KEY ||
      !!process.env.GOOGLE_GENERATIVE_AI_API_KEY;

    let enrichmentMetrics = {
      enriched: 0,
      skipped: 0,
      failed: 0,
      pagesScanned: 0,
      articlesScanned: 0,
      productsScanned: 0,
    };

    if (llmAvailable) {
      const resources = await fetchEnrichableResources(shopify);
      enrichmentMetrics.pagesScanned = resources.pages.length;
      enrichmentMetrics.articlesScanned = resources.articles.length;
      enrichmentMetrics.productsScanned = resources.products.length;

      const allResources = [
        ...resources.pages.map((p) => ({
          kind: "page" as const,
          gid: p.gid,
          title: p.title,
          url: p.url,
          contentText: p.body,
          existingExtra: p.existingExtra,
        })),
        ...resources.articles.map((a) => ({
          kind: "article" as const,
          gid: a.gid,
          title: a.title,
          url: a.url,
          contentText: a.body,
          existingExtra: a.existingExtra,
        })),
        ...resources.products.map((p) => ({
          kind: "product" as const,
          gid: p.gid,
          title: p.title,
          url: p.url,
          contentText: p.description,
          existingExtra: p.existingExtra,
        })),
      ];

      for (const r of allResources) {
        try {
          const result = await enrichSchema({
            resourceKind: r.kind,
            title: r.title,
            contentText: r.contentText,
            url: r.url,
          });

          if (!result.applicable || !result.jsonLd) {
            enrichmentMetrics.skipped++;
            continue;
          }

          // Skip if it matches the existing metafield exactly.
          if (r.existingExtra === result.jsonLd) {
            enrichmentMetrics.skipped++;
            continue;
          }

          proposals.push({
            kind: "metafield_set",
            target: `${r.gid}:autoaeo.schema_extra`,
            title: `Add ${result.schemaType} schema: ${r.title}`,
            description: `${result.reasoning}\n\nThe Schema Markup snippet automatically emits this entity as JSON-LD on the resource's page.`,
            before: r.existingExtra
              ? { type: "json", value: r.existingExtra }
              : null,
            after: { type: "json", value: result.jsonLd },
          });
          enrichmentMetrics.enriched++;
        } catch {
          enrichmentMetrics.failed++;
        }
      }
    }

    // ── Build summary ────────────────────────────────────────────────

    const layerASummary =
      proposals.filter((p) => p.kind !== "metafield_set").length === 0
        ? "Schema snippet already up to date"
        : "Deployed schema snippet + head injection";

    const layerBSummary = llmAvailable
      ? `LLM enrichment: ${enrichmentMetrics.enriched} enriched, ${enrichmentMetrics.skipped} skipped${enrichmentMetrics.failed > 0 ? `, ${enrichmentMetrics.failed} failed` : ""}`
      : "Set GOOGLE_API_KEY to enable LLM-driven Recipe/HowTo/Course/Service schema enrichment.";

    return {
      summary: `${layerASummary}. ${layerBSummary}.`,
      metrics: {
        proposals: proposals.length,
        themeId: theme.id,
        ...enrichmentMetrics,
      },
      proposals,
    };
  },
};

// ─── Resource fetch (with metafield read for idempotency) ──────────

interface EnrichableResource {
  gid: string;
  title: string;
  url: string;
  body: string;
  existingExtra: string | null;
}

interface EnrichableProduct {
  gid: string;
  title: string;
  url: string;
  description: string;
  existingExtra: string | null;
}

async function fetchEnrichableResources(client: ShopifyClient): Promise<{
  pages: EnrichableResource[];
  articles: EnrichableResource[];
  products: EnrichableProduct[];
}> {
  const [pagesData, articlesData, productsData] = await Promise.all([
    client.graphql<{
      pages: {
        edges: Array<{
          node: {
            id: string;
            handle: string;
            title: string;
            body: string;
            metafield: { value: string } | null;
          };
        }>;
      };
    }>(
      /* GraphQL */ `
        query AutoAEO_PagesForEnrichment($first: Int!) {
          pages(first: $first, sortKey: UPDATED_AT, reverse: true) {
            edges {
              node {
                id handle title body
                metafield(namespace: "autoaeo", key: "schema_extra") { value }
              }
            }
          }
        }
      `,
      { first: MAX_PAGES_TO_ENRICH },
    ),
    client.graphql<{
      articles: {
        edges: Array<{
          node: {
            id: string;
            handle: string;
            title: string;
            body: string;
            blog: { handle: string };
            metafield: { value: string } | null;
          };
        }>;
      };
    }>(
      /* GraphQL */ `
        query AutoAEO_ArticlesForEnrichment($first: Int!) {
          articles(first: $first, sortKey: PUBLISHED_AT, reverse: true) {
            edges {
              node {
                id handle title body
                blog { handle }
                metafield(namespace: "autoaeo", key: "schema_extra") { value }
              }
            }
          }
        }
      `,
      { first: MAX_ARTICLES_TO_ENRICH },
    ),
    client.graphql<{
      products: {
        edges: Array<{
          node: {
            id: string;
            handle: string;
            title: string;
            description: string;
            metafield: { value: string } | null;
          };
        }>;
      };
    }>(
      /* GraphQL */ `
        query AutoAEO_ProductsForEnrichment($first: Int!) {
          products(first: $first, query: "status:active", sortKey: UPDATED_AT, reverse: true) {
            edges {
              node {
                id handle title description
                metafield(namespace: "autoaeo", key: "schema_extra") { value }
              }
            }
          }
        }
      `,
      { first: MAX_PRODUCTS_TO_ENRICH },
    ),
  ]);

  const pages = pagesData.pages.edges
    .map((e) => ({
      gid: e.node.id,
      title: e.node.title,
      url: `/pages/${e.node.handle}`,
      body: e.node.body ?? "",
      existingExtra: e.node.metafield?.value ?? null,
    }))
    .filter((p) => stripHtml(p.body).length >= PAGE_BODY_MIN_BYTES);

  const articles = articlesData.articles.edges
    .map((e) => ({
      gid: e.node.id,
      title: e.node.title,
      url: `/blogs/${e.node.blog.handle}/${e.node.handle}`,
      body: e.node.body ?? "",
      existingExtra: e.node.metafield?.value ?? null,
    }))
    .filter((a) => stripHtml(a.body).length >= ARTICLE_BODY_MIN_BYTES);

  const products = productsData.products.edges
    .map((e) => ({
      gid: e.node.id,
      title: e.node.title,
      url: `/products/${e.node.handle}`,
      description: e.node.description ?? "",
      existingExtra: e.node.metafield?.value ?? null,
    }))
    .filter((p) => stripHtml(p.description).length >= PRODUCT_DESC_MIN_BYTES);

  return { pages, articles, products };
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}
