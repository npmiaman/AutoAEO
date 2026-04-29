import type { Playbook, ProposedChange } from "@/lib/agent/types";
import {
  fetchArticles,
  fetchCollections,
  fetchPages,
  fetchProducts,
  fetchPublishedTheme,
  fetchShopInfo,
  fetchThemeAssetText,
} from "./queries";
import {
  generateLlmsFullTxt,
  generateLlmsTxt,
  generateRobotsTxt,
  machineArticleSection,
  machineCollectionSection,
  machineIndexSection,
  machineLayoutLiquid,
  machinePageSection,
  machineProductSection,
  machineTemplateJson,
} from "./generator";

/**
 * "Machine Layer" — generates the full set of artifacts that make a Shopify
 * store legible to AI crawlers:
 *   - /llms.txt + /llms-full.txt  (as Online Store pages with .txt handles)
 *   - layout/machine.liquid       (stripped layout for AI consumption)
 *   - sections/machine-*.liquid   (markdown-style renderers for each resource)
 *   - templates/*.machine.json    (wires the sections via ?template_suffix=machine)
 *   - robots.txt.liquid           (explicitly invites AI bots, links sitemaps)
 *
 * This playbook PROPOSES changes; nothing is written to the live theme until
 * the user reviews and approves the run.
 */
export const machineLayerPlaybook: Playbook = {
  id: "machine-layer",
  name: "Machine Layer",
  description:
    "Generate /llms.txt, /llms-full.txt, machine-readable templates for products/collections/pages/articles, and an AI-friendly robots.txt.",

  async run({ shopify }) {
    // 1. Pull everything we need from Shopify in parallel.
    const [shop, products, collections, pages, articles, theme] =
      await Promise.all([
        fetchShopInfo(shopify),
        fetchProducts(shopify, 100),
        fetchCollections(shopify, 50),
        fetchPages(shopify, 100),
        fetchArticles(shopify, 25),
        fetchPublishedTheme(shopify),
      ]);

    if (!theme) {
      return {
        summary:
          "No published theme found on this store — connect a theme first.",
        proposals: [],
      };
    }

    // 2. Generate all content.
    const llmsTxt = generateLlmsTxt({
      shop,
      products,
      collections,
      pages,
      articles,
    });
    const llmsFullTxt = generateLlmsFullTxt({
      shop,
      products,
      collections,
      pages,
      articles,
    });
    const robotsTxt = generateRobotsTxt({
      primaryDomain: shop.primaryDomain,
    });

    // 3. Read existing assets so we can show before/after diffs and skip no-ops.
    const assetKeys = [
      "layout/machine.liquid",
      "sections/machine-product.liquid",
      "sections/machine-collection.liquid",
      "sections/machine-page.liquid",
      "sections/machine-article.liquid",
      "sections/machine-index.liquid",
      "templates/product.machine.json",
      "templates/collection.machine.json",
      "templates/page.machine.json",
      "templates/article.machine.json",
      "config/robots.txt.liquid",
    ] as const;

    const existing: Record<string, string | null> = {};
    await Promise.all(
      assetKeys.map(async (key) => {
        existing[key] = await fetchThemeAssetText(shopify, theme.id, key);
      }),
    );

    // 4. Build the list of proposed changes.
    const proposals: ProposedChange[] = [];

    const pushAsset = (key: string, content: string, title: string) => {
      const before = existing[key];
      if (before === content) return; // already up to date
      proposals.push({
        kind: key.endsWith(".json") ? "theme_template" : "theme_asset",
        target: key,
        title,
        description:
          before == null
            ? "Create this theme file"
            : "Update this theme file with the latest machine-layer content",
        before: before ?? null,
        after: content,
      });
    };

    pushAsset(
      "layout/machine.liquid",
      machineLayoutLiquid,
      "Machine layout (stripped, no chrome)",
    );
    pushAsset(
      "sections/machine-product.liquid",
      machineProductSection,
      "Machine-readable product renderer",
    );
    pushAsset(
      "sections/machine-collection.liquid",
      machineCollectionSection,
      "Machine-readable collection renderer",
    );
    pushAsset(
      "sections/machine-page.liquid",
      machinePageSection,
      "Machine-readable page renderer",
    );
    pushAsset(
      "sections/machine-article.liquid",
      machineArticleSection,
      "Machine-readable article renderer",
    );
    pushAsset(
      "sections/machine-index.liquid",
      machineIndexSection,
      "Machine-readable index renderer",
    );

    pushAsset(
      "templates/product.machine.json",
      machineTemplateJson("machine-product"),
      "Product machine template",
    );
    pushAsset(
      "templates/collection.machine.json",
      machineTemplateJson("machine-collection"),
      "Collection machine template",
    );
    pushAsset(
      "templates/page.machine.json",
      machineTemplateJson("machine-page"),
      "Page machine template",
    );
    pushAsset(
      "templates/article.machine.json",
      machineTemplateJson("machine-article"),
      "Article machine template",
    );

    // robots.txt is special-case
    if (existing["config/robots.txt.liquid"] !== robotsTxt) {
      proposals.push({
        kind: "robots_txt",
        target: "config/robots.txt.liquid",
        title: "Update robots.txt for AI crawlers",
        description:
          "Explicitly allows GPTBot, ClaudeBot, PerplexityBot, OAI-SearchBot, Google-Extended, etc., and lists /llms.txt + /llms-full.txt as sitemaps.",
        before: existing["config/robots.txt.liquid"] ?? null,
        after: robotsTxt,
      });
    }

    // /llms.txt + /llms-full.txt as Shopify Online Store pages.
    proposals.push({
      kind: "page_create",
      target: "/pages/llms.txt",
      title: "Create /pages/llms.txt — AI-readable index",
      description:
        "An llms.txt-style index of every important resource on the store, linking to the machine version of each.",
      after: {
        title: "llms.txt",
        handle: "llms.txt",
        body_html: `<pre>${escapeHtml(llmsTxt)}</pre>`,
        published: true,
      },
    });
    proposals.push({
      kind: "page_create",
      target: "/pages/llms-full.txt",
      title: "Create /pages/llms-full.txt — full corpus",
      description:
        "Concatenated machine-readable version of the entire catalog, collections, pages, and articles. Designed for one-shot ingestion by AI agents.",
      after: {
        title: "llms-full.txt",
        handle: "llms-full.txt",
        body_html: `<pre>${escapeHtml(llmsFullTxt)}</pre>`,
        published: true,
      },
    });

    // Snippet inject into theme.liquid so every page advertises the machine alternate.
    const themeLiquid = await fetchThemeAssetText(
      shopify,
      theme.id,
      "layout/theme.liquid",
    );
    if (themeLiquid && !themeLiquid.includes("autoaeo-alternate")) {
      proposals.push({
        kind: "snippet_inject",
        target: "layout/theme.liquid",
        title: "Advertise machine alternate in <head>",
        description:
          "Adds <link rel=\"alternate\" type=\"text/markdown\"> to every page so AI crawlers can discover and follow the machine version.",
        before: themeLiquid,
        after: injectAlternateLink(themeLiquid),
      });
    }

    return {
      summary: `Generated ${proposals.length} proposed change${
        proposals.length === 1 ? "" : "s"
      } across ${products.length} products, ${collections.length} collections, ${pages.length} pages, ${articles.length} articles.`,
      metrics: {
        products: products.length,
        collections: collections.length,
        pages: pages.length,
        articles: articles.length,
        proposals: proposals.length,
      },
      proposals,
    };
  },
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

const ALTERNATE_SNIPPET = `<!-- autoaeo-alternate -->
{%- unless request.path contains '?view=machine' or template contains 'machine' -%}
  {%- assign machine_url = canonical_url | append: '?view=machine' -%}
  <link rel="alternate" type="text/markdown" title="Machine-readable version" href="{{ machine_url }}">
{%- endunless -%}
<!-- /autoaeo-alternate -->`;

function injectAlternateLink(themeLiquid: string): string {
  // Inject just before </head>. If </head> isn't found (rare), append.
  const idx = themeLiquid.toLowerCase().indexOf("</head>");
  if (idx === -1) return `${themeLiquid}\n${ALTERNATE_SNIPPET}\n`;
  return `${themeLiquid.slice(0, idx)}${ALTERNATE_SNIPPET}\n${themeLiquid.slice(idx)}`;
}
