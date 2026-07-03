import "server-only";
import { z } from "zod";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { Annotation, StateGraph, START, END } from "@langchain/langgraph";
import type { Playbook, ProposedChange } from "@/lib/agent/types";
import type { ShopifyClient } from "@/lib/shopify/client";
import { buildChatModel } from "@/lib/agent/llm";
import {
  fetchProducts,
  fetchShopInfo,
  type ProductSummary,
  type ShopInfo,
} from "@/lib/agent/playbooks/machine-layer/queries";
import {
  upsertProductEmbeddings,
  retrieveSimilarProducts,
  type ProductEmbeddingInput,
} from "@/lib/agent/vector-store";

// ─────────────────────────────────────────────────────────────────────
// Product Description Rewriter (Pillar 2, Content GEO).
//
// LangGraph flow:
//
//   START → fetchProducts → embedProducts → rewriteDescriptions → END
//
// For each product, asks Gemini to rewrite the description in AEO format:
//   - Direct answer first (50–75 words that completely describe the product)
//   - Specifications block
//   - Use cases / who it's for
//   - 2–3 frequently asked questions with concise answers
//   - Proper H2/H3 structure throughout
//   - Entity-clear language (no orphan pronouns)
//
// Vector retrieval surfaces similar catalog products as voice/tone
// references so Gemini stays consistent with the merchant's existing
// style. The original description is preserved as `before` for diff
// review and rollback.
// ─────────────────────────────────────────────────────────────────────

const MAX_PRODUCTS = 50;
const REWRITE_TEMPERATURE = 0.5;

// ─── Output schema ──────────────────────────────────────────────────

const RewriteSchema = z.object({
  rewrites: z
    .array(
      z.object({
        handle: z.string(),
        descriptionHtml: z
          .string()
          .describe(
            "AEO-optimized HTML body. Must contain (in order): a direct-answer paragraph, an h2 'Specifications' or equivalent block (use a ul or table), an h2 'Who it's for' or 'Use cases', and an h2 'Frequently asked questions' with 2-3 question/answer pairs as h3 + p. Use <h2>/<h3> not <h1>. Avoid CSS classes and inline styles. No marketing fluff: no 'discover', 'experience', 'crafted with care', 'premium', 'luxury', 'ultimate'.",
          ),
        seoTitle: z
          .string()
          .max(70)
          .describe(
            "SEO-optimized page title under 70 chars. Format: '<Specific Product Noun> — <Most distinctive attribute> | <Brand>'. No stop words, no fluff.",
          ),
        seoDescription: z
          .string()
          .max(165)
          .describe(
            "SEO meta description under 165 chars. Direct, factual, leads with the most query-relevant attribute. No marketing fluff.",
          ),
      }),
    )
    .describe("Exactly one rewrite per input product, keyed by handle."),
});

const SYSTEM = `You are an AEO (Answer Engine Optimization) copywriter rewriting Shopify product
content for AI search engines. Your output is read by AI crawlers like GPTBot, ClaudeBot,
PerplexityBot, and Google-Extended — and by AI search engines that decide whether to cite
this product when answering shopping queries.

Rules for the descriptionHtml:
- Lead with a 50–75 word direct-answer paragraph that completely describes the product:
  what it is, what it does, who it's for, the most query-relevant differentiating attribute.
- Follow with structured sections (h2/h3) the AI can extract: Specifications, Who it's for /
  Use cases, Frequently asked questions (2–3 Q&A pairs as h3 + p).
- Use entity-clear language: never use a pronoun where you could use the product noun.
- Use plain prose and HTML. No <h1> (Shopify renders the product title as h1).
- No marketing fluff: ban "discover", "experience", "crafted with care", "premium",
  "luxury", "ultimate", "elevate", "perfect for", "indulge".
- Every fact you state must be derivable from the source description, title, type, vendor,
  tags, or options. Never invent specifications, materials, dimensions, ingredients,
  or origin claims.
- Match the merchant's existing brand voice (you'll see catalog exemplars).

Rules for seoTitle: under 70 chars, format "<Specific Product Noun> — <Most distinctive
attribute> | <Brand>". No fluff.

Rules for seoDescription: under 165 chars, direct/factual, leads with the most
query-relevant attribute.`;

// ─── LangGraph state ────────────────────────────────────────────────

interface RewriteResult {
  handle: string;
  descriptionHtml: string;
  seoTitle: string;
  seoDescription: string;
}

const State = Annotation.Root({
  shopId: Annotation<string>,
  shopify: Annotation<ShopifyClient>,
  shop: Annotation<ShopInfo>,
  products: Annotation<ProductSummary[]>,
  embeddingsStored: Annotation<number>,
  rewrites: Annotation<RewriteResult[]>,
});

type AgentState = typeof State.State;

// ─── Nodes ──────────────────────────────────────────────────────────

async function fetchProductsNode(state: AgentState): Promise<Partial<AgentState>> {
  const [shop, products] = await Promise.all([
    fetchShopInfo(state.shopify),
    fetchProducts(state.shopify, MAX_PRODUCTS),
  ]);
  return { shop, products };
}

async function embedProductsNode(state: AgentState): Promise<Partial<AgentState>> {
  if (state.products.length === 0) return { embeddingsStored: 0 };
  const inputs: ProductEmbeddingInput[] = state.products.map((p) => {
    const desc = stripHtml(p.description ?? "");
    const meta: string[] = [];
    if (p.productType) meta.push(`Type: ${p.productType}`);
    if (p.vendor) meta.push(`Vendor: ${p.vendor}`);
    if (p.tags.length) meta.push(`Tags: ${p.tags.slice(0, 8).join(", ")}`);
    return {
      handle: p.handle,
      title: p.title,
      content: [meta.join(" · "), desc].filter(Boolean).join("\n\n"),
    };
  });
  const stored = await upsertProductEmbeddings(state.shopId, inputs);
  return { embeddingsStored: stored };
}

async function rewriteDescriptionsNode(
  state: AgentState,
): Promise<Partial<AgentState>> {
  if (state.products.length === 0) return { rewrites: [] };

  // Pull a handful of catalog exemplars as voice/tone reference. We use the
  // shop name + description as the retrieval seed so we get representative
  // products from across the catalog rather than products similar to one item.
  let exemplars: Awaited<ReturnType<typeof retrieveSimilarProducts>> = [];
  try {
    exemplars = await retrieveSimilarProducts(
      state.shopId,
      `${state.shop.name}\n${state.shop.description ?? ""}`,
      4,
    );
  } catch {
    exemplars = [];
  }

  const exemplarSection =
    exemplars.length > 0
      ? `# Catalog exemplars (reference for voice/tone — DO NOT copy; just match the register)
${exemplars
  .slice(0, 4)
  .map(
    (e, i) =>
      `## Exemplar ${i + 1}: ${e.title}\n${e.content.replace(/\s+/g, " ").slice(0, 600)}`,
  )
  .join("\n\n")}\n`
      : "";

  const productList = state.products
    .map((p) => {
      const desc = stripHtml(p.description ?? "").slice(0, 1500);
      const price =
        p.priceRangeFrom && p.currencyCode
          ? `${p.currencyCode} ${p.priceRangeFrom}`
          : "";
      const optionsBlock = ""; // ProductSummary doesn't carry options yet; skip for v1
      return `### handle: ${p.handle}
title: ${p.title}${price ? ` (${price})` : ""}
type: ${p.productType || "(unspecified)"}
vendor: ${p.vendor || "(none)"}
tags: ${p.tags.join(", ") || "(none)"}
${optionsBlock}existing description (source of truth — do not invent beyond this):
${desc || "(empty)"}`;
    })
    .join("\n\n");

  const prompt = ChatPromptTemplate.fromMessages([
    ["system", SYSTEM],
    [
      "human",
      `Store: {shopName}
Brand: {shopDescription}

{exemplarSection}
# Products to rewrite ({count})
{productList}

For each product, return a complete AEO-optimized rewrite (descriptionHtml + seoTitle + seoDescription), keyed by handle. Output exactly {count} rewrites.`,
    ],
  ]);

  const model = buildChatModel({ temperature: REWRITE_TEMPERATURE }).withStructuredOutput(
    RewriteSchema,
    { name: "DescriptionRewrites" },
  );

  const chain = prompt.pipe(model);
  const result = await chain.invoke({
    shopName: state.shop.name,
    shopDescription: state.shop.description ?? "(no shop description)",
    exemplarSection,
    count: state.products.length,
    productList,
  });

  return { rewrites: result.rewrites };
}

// ─── Graph compilation ──────────────────────────────────────────────

let _compiled: ReturnType<ReturnType<typeof buildGraph>["compile"]> | null = null;
function buildGraph() {
  return new StateGraph(State)
    .addNode("fetchProducts", fetchProductsNode)
    .addNode("embedProducts", embedProductsNode)
    .addNode("rewriteDescriptions", rewriteDescriptionsNode)
    .addEdge(START, "fetchProducts")
    .addEdge("fetchProducts", "embedProducts")
    .addEdge("embedProducts", "rewriteDescriptions")
    .addEdge("rewriteDescriptions", END);
}
function getCompiledGraph() {
  if (_compiled) return _compiled;
  _compiled = buildGraph().compile();
  return _compiled;
}

// ─── Playbook ───────────────────────────────────────────────────────

export const descriptionRewriterPlaybook: Playbook = {
  id: "description-rewriter",
  name: "Product Description Rewriter (AI)",
  description:
    "Gemini rewrites every product description in AEO format: direct-answer lead, structured spec/use-case sections, FAQ block, and updated SEO meta. Vector retrieval grounds the rewrites in your catalog's voice. Requires GOOGLE_API_KEY.",

  async run({ shopId, shopify }) {
    if (
      !process.env.GOOGLE_API_KEY &&
      !process.env.GOOGLE_GENERATIVE_AI_API_KEY
    ) {
      return {
        summary: "GOOGLE_API_KEY is not configured. Set it in .env.local.",
        proposals: [],
      };
    }

    const graph = getCompiledGraph();
    const finalState = await graph.invoke(
      { shopId, shopify },
      {
        configurable: { thread_id: `description-rewriter-${shopId}-${Date.now()}` },
        runName: "DescriptionRewriter",
        tags: ["pigeon", "description-rewriter"],
        metadata: { shopId },
      },
    );

    const products = finalState.products ?? [];
    const rewrites = finalState.rewrites ?? [];

    if (products.length === 0) {
      return {
        summary:
          "Store has no active products yet. Add products before running this playbook.",
        proposals: [],
      };
    }

    const productById = new Map(products.map((p) => [p.handle, p]));
    const proposals: ProposedChange[] = [];

    for (const r of rewrites) {
      const original = productById.get(r.handle);
      if (!original) continue;

      const before = {
        descriptionHtml: original.description ?? "",
      };
      const after = {
        descriptionHtml: r.descriptionHtml,
        seoTitle: r.seoTitle,
        seoDescription: r.seoDescription,
      };

      proposals.push({
        kind: "product_update",
        target: original.id, // GraphQL gid://shopify/Product/...
        title: `Rewrite description: ${original.title}`,
        description: `AEO-restructured product page: direct-answer lead, structured specs, FAQ block, and refreshed SEO meta tags. Original preserved as before-state for rollback.`,
        before,
        after,
      });
    }

    return {
      summary: `Rewrote ${proposals.length} product description${proposals.length === 1 ? "" : "s"} (${products.length} fetched, ${finalState.embeddingsStored ?? 0} embeddings refreshed).`,
      metrics: {
        productsFetched: products.length,
        productsRewritten: proposals.length,
        embeddingsStored: finalState.embeddingsStored ?? 0,
      },
      proposals,
    };
  },
};

// ─── Helpers ────────────────────────────────────────────────────────

function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}
