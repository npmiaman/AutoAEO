import type { Playbook, ProposedChange } from "@/lib/agent/types";
import {
  fetchPublishedTheme,
  fetchThemeAssetText,
} from "@/lib/agent/playbooks/machine-layer/queries";
import {
  AUTOAEO_SCHEMA_SNIPPET,
  injectSchemaRender,
  themeLiquidHasSchemaInjection,
} from "./generator";

/**
 * Schema Markup playbook — emits schema.org JSON-LD on every page so
 * Google rich results, AI search citations, and voice assistants can
 * read the store as structured data.
 *
 * Two artifacts:
 *   1. snippets/autoaeo-schema.liquid — the dynamic JSON-LD generator
 *   2. {% render 'autoaeo-schema' %} injected into layout/theme.liquid <head>
 *
 * No LLM required: the schema vocabulary maps deterministically from
 * Shopify resources to schema.org properties.
 */
export const schemaMarkupPlaybook: Playbook = {
  id: "schema-markup",
  name: "Schema Markup",
  description:
    "Inject schema.org JSON-LD on every page (Organization, WebSite, Product, BreadcrumbList, CollectionPage, BlogPosting, WebPage, FAQPage) so search engines and AI agents can parse your store as structured data.",

  async run({ shopify }) {
    const theme = await fetchPublishedTheme(shopify);
    if (!theme) {
      return {
        summary: "No published theme found on this store.",
        proposals: [],
      };
    }

    const proposals: ProposedChange[] = [];

    // 1. Snippet
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
            ? "Create the dynamic schema generator. Emits Organization, WebSite, Product, BreadcrumbList, CollectionPage, BlogPosting, WebPage, and FAQPage as JSON-LD."
            : "Update the schema generator with the latest schema.org coverage.",
        before: existingSnippet ?? null,
        after: AUTOAEO_SCHEMA_SNIPPET,
      });
    }

    // 2. Injection into theme.liquid head
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

    return {
      summary:
        proposals.length === 0
          ? "Schema markup already up to date on this theme."
          : `Generated ${proposals.length} proposed change${
              proposals.length === 1 ? "" : "s"
            } to add schema.org markup site-wide.`,
      metrics: {
        proposals: proposals.length,
        themeId: theme.id,
      },
      proposals,
    };
  },
};
