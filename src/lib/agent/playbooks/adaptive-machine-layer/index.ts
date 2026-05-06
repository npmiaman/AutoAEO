import "server-only";
import type { Playbook, ProposedChange } from "@/lib/agent/types";
import { fetchThemeAssetText } from "@/lib/agent/playbooks/machine-layer/queries";
import {
  generateLlmsFullTxt,
  generateRobotsTxt,
  machineArticleSection,
  machineCollectionSection,
  machineIndexSection,
  machineLayoutLiquid,
  machinePageSection,
  machineTemplateJson,
} from "@/lib/agent/playbooks/machine-layer/generator";
import { runAdaptiveAgent } from "./graph";
import { pickProductTemplate } from "./variants";

/**
 * Adaptive Machine Layer — driven by a LangGraph state machine.
 *
 *   fetchStore → embedProducts → profileStore → summarize
 *
 *   - `fetchStore` pulls shop / products / collections / pages /
 *     articles / theme via Shopify GraphQL (parallel inside the node).
 *   - `embedProducts` upserts each product into a libsql vector index
 *     so downstream nodes can use RAG-retrieved exemplars.
 *   - `profileStore` is a single Gemini call returning a structured
 *     StoreProfile (vertical, schema type, brand voice, etc.).
 *   - `summarize` is a batched Gemini call, with vector-retrieved
 *     catalog exemplars in-context, producing AEO-formatted product
 *     one-liners.
 *
 *   The resulting state is then folded into the same proposal shape
 *   the basic Machine Layer playbook produces, so the approve / apply /
 *   rollback pipeline works identically.
 *
 *   LangSmith tracing is automatic when LANGCHAIN_TRACING_V2=true and
 *   LANGCHAIN_API_KEY are set in env.
 */
export const adaptiveMachineLayerPlaybook: Playbook = {
  id: "adaptive-machine-layer",
  name: "Adaptive Machine Layer (AI)",
  description:
    "LangGraph-driven agent: Gemini profiles your store, embeds products into a vector DB for RAG context, and produces AEO-optimized summaries plus a vertical-tuned product machine template. Requires GOOGLE_API_KEY.",

  async run({ shopId, shopify }) {
    if (
      !process.env.GOOGLE_API_KEY &&
      !process.env.GOOGLE_GENERATIVE_AI_API_KEY
    ) {
      return {
        summary:
          "GOOGLE_API_KEY is not configured. Set it in .env.local (Generative Language API key from Google AI Studio).",
        proposals: [],
      };
    }

    // Run the LangGraph agent.
    const result = await runAdaptiveAgent({ shopId, shopify });
    const { shop, products, collections, pages, articles, theme, profile, summaries, embeddingsStored } =
      result;

    if (!theme) {
      return {
        summary: "No published theme found on this store.",
        proposals: [],
      };
    }
    if (!profile) {
      return {
        summary: "Store profiling failed — agent returned no profile.",
        proposals: [],
      };
    }
    if (products.length === 0) {
      return {
        summary:
          "Store has no active products yet. Add products before running this playbook.",
        proposals: [],
      };
    }

    // Build content (deterministic, post-LLM).
    const llmsTxt = buildAdaptiveLlmsTxt({
      shop,
      profile,
      products,
      collections,
      pages,
      articles,
      summaries,
    });
    const llmsFullTxt = `# ${shop.name}\n\n${profile.brandSummary}\n\n${generateLlmsFullTxt(
      { shop, products, collections, pages, articles },
    )
      .split("\n")
      .slice(2)
      .join("\n")}`;
    const robotsTxt = generateRobotsTxt({ primaryDomain: shop.primaryDomain });
    const productTemplate = pickProductTemplate(profile);

    // Diff against existing theme assets to skip no-ops.
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

    const proposals: ProposedChange[] = [];

    const pushAsset = (
      key: string,
      content: string,
      title: string,
      description: string,
    ) => {
      const before = existing[key];
      if (before === content) return;
      proposals.push({
        kind: key.endsWith(".json") ? "theme_template" : "theme_asset",
        target: key,
        title,
        description,
        before: before ?? null,
        after: content,
      });
    };

    pushAsset(
      "layout/machine.liquid",
      machineLayoutLiquid,
      "Machine layout (stripped, no chrome)",
      "Bare HTML shell used by every machine template.",
    );
    pushAsset(
      "sections/machine-product.liquid",
      productTemplate,
      `Product renderer — ${profile.vertical.replace(/_/g, " ")} variant`,
      `Tuned for ${profile.vertical.replace(/_/g, " ")} (${profile.highValueAttributes.slice(0, 5).join(", ")}). Emits ${profile.schemaType} schema.org type.`,
    );
    pushAsset(
      "sections/machine-collection.liquid",
      machineCollectionSection,
      "Collection renderer",
      "Markdown-style collection page.",
    );
    pushAsset(
      "sections/machine-page.liquid",
      machinePageSection,
      "Page renderer",
      "Markdown-style page renderer.",
    );
    pushAsset(
      "sections/machine-article.liquid",
      machineArticleSection,
      "Article renderer",
      "Markdown-style article renderer.",
    );
    pushAsset(
      "sections/machine-index.liquid",
      machineIndexSection,
      "Index renderer",
      "Default machine page renderer.",
    );

    pushAsset(
      "templates/product.machine.json",
      machineTemplateJson("machine-product"),
      "Product machine template",
      "Wires the machine product section under ?template_suffix=machine.",
    );
    pushAsset(
      "templates/collection.machine.json",
      machineTemplateJson("machine-collection"),
      "Collection machine template",
      "Wires the machine collection section.",
    );
    pushAsset(
      "templates/page.machine.json",
      machineTemplateJson("machine-page"),
      "Page machine template",
      "Wires the machine page section.",
    );
    pushAsset(
      "templates/article.machine.json",
      machineTemplateJson("machine-article"),
      "Article machine template",
      "Wires the machine article section.",
    );

    if (existing["config/robots.txt.liquid"] !== robotsTxt) {
      proposals.push({
        kind: "robots_txt",
        target: "config/robots.txt.liquid",
        title: "AI-friendly robots.txt",
        description:
          "Allow GPTBot, ClaudeBot, PerplexityBot, OAI-SearchBot, Google-Extended, etc. List /llms.txt as a sitemap.",
        before: existing["config/robots.txt.liquid"] ?? null,
        after: robotsTxt,
      });
    }

    proposals.push({
      kind: "page_create",
      target: "/pages/llms.txt",
      title: "Create /pages/llms.txt — brand-aware AI index",
      description: `Brand summary, ${profile.vertical.replace(
        /_/g,
        " ",
      )} positioning, and AEO-optimized one-line summaries for ${products.length} products.`,
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
      description: "Complete machine-readable corpus with brand summary header.",
      after: {
        title: "llms-full.txt",
        handle: "llms-full.txt",
        body_html: `<pre>${escapeHtml(llmsFullTxt)}</pre>`,
        published: true,
      },
    });

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
          "Adds <link rel=\"alternate\" type=\"text/markdown\"> so AI crawlers can discover the machine version.",
        before: themeLiquid,
        after: injectAlternateLink(themeLiquid),
      });
    }

    return {
      summary: `Profile: ${profile.vertical.replace(/_/g, " ")} · ${profile.audienceHint} · ${
        profile.schemaType
      } schema. Embedded ${embeddingsStored} products. Generated ${proposals.length} adaptive change${
        proposals.length === 1 ? "" : "s"
      } across ${products.length} products.`,
      metrics: {
        vertical: profile.vertical,
        schemaType: profile.schemaType,
        language: profile.language,
        products: products.length,
        productsSummarized: summaries.size,
        embeddingsStored,
        proposals: proposals.length,
      },
      proposals,
    };
  },
};

// ─────────────────────────────────────────────────────────────────────

function buildAdaptiveLlmsTxt(args: {
  shop: { name: string; url: string; primaryDomain: string };
  profile: { brandSummary: string; audienceHint: string; brandVoice: string };
  products: Array<{
    handle: string;
    title: string;
    priceRangeFrom: string | null;
    currencyCode: string | null;
  }>;
  collections: Array<{ handle: string; title: string; description: string }>;
  pages: Array<{ handle: string; title: string; bodySummary: string }>;
  articles: Array<{
    handle: string;
    blogHandle: string;
    title: string;
    summary: string;
  }>;
  summaries: Map<string, string>;
}): string {
  const { shop, profile, products, collections, pages, articles, summaries } =
    args;
  const lines: string[] = [];
  lines.push(`# ${shop.name}`);
  lines.push("");
  lines.push(`> ${profile.brandSummary}`);
  lines.push("");
  lines.push(`Storefront: ${shop.url}`);
  lines.push("");

  if (products.length) {
    lines.push("## Products");
    for (const p of products) {
      const summary = summaries.get(p.handle) ?? "";
      const price =
        p.priceRangeFrom && p.currencyCode
          ? ` — ${p.currencyCode} ${p.priceRangeFrom}`
          : "";
      lines.push(
        `- [${p.title}](/products/${p.handle}?view=machine)${price}${
          summary ? `: ${summary}` : ""
        }`,
      );
    }
    lines.push("");
  }

  if (collections.length) {
    lines.push("## Collections");
    for (const c of collections) {
      const desc = stripHtml(c.description).slice(0, 140);
      lines.push(
        `- [${c.title}](/collections/${c.handle}?view=machine)${
          desc ? `: ${desc}` : ""
        }`,
      );
    }
    lines.push("");
  }

  if (pages.length) {
    lines.push("## Pages");
    for (const p of pages) {
      const desc = stripHtml(p.bodySummary).slice(0, 140);
      lines.push(
        `- [${p.title}](/pages/${p.handle}?view=machine)${desc ? `: ${desc}` : ""}`,
      );
    }
    lines.push("");
  }

  if (articles.length) {
    lines.push("## Articles");
    for (const a of articles) {
      const desc = stripHtml(a.summary).slice(0, 140);
      lines.push(
        `- [${a.title}](/blogs/${a.blogHandle}/${a.handle}?view=machine)${
          desc ? `: ${desc}` : ""
        }`,
      );
    }
    lines.push("");
  }

  lines.push("---");
  lines.push("");
  lines.push(
    "_This page is the AI-readable index for this store. Generated by AutoAEO with Gemini + LangGraph._",
  );
  lines.push(`_Last updated: ${new Date().toISOString()}_`);
  return lines.join("\n");
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

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
  const idx = themeLiquid.toLowerCase().indexOf("</head>");
  if (idx === -1) return `${themeLiquid}\n${ALTERNATE_SNIPPET}\n`;
  return `${themeLiquid.slice(0, idx)}${ALTERNATE_SNIPPET}\n${themeLiquid.slice(idx)}`;
}
