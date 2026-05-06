import "server-only";
import { z } from "zod";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import type { Playbook, ProposedChange } from "@/lib/agent/types";
import {
  fetchProducts,
  type ProductSummary,
} from "@/lib/agent/playbooks/machine-layer/queries";
import {
  upsertProductEmbeddings,
  retrieveSimilarProducts,
  type ProductEmbeddingInput,
} from "@/lib/agent/vector-store";
import { buildChatModel } from "@/lib/agent/llm";

// ─────────────────────────────────────────────────────────────────────
// Internal Linking Suggester (Pillar 1, Technical GEO).
//
// Phase 1 — vector retrieval:
//   For each product, find the top-k semantically related products via
//   the libsql vector store.
//
// Phase 2 — LLM integration (Gemini):
//   For each gap, ask Gemini to write a natural-language paragraph that
//   integrates 1–4 internal links into the source product's existing
//   description voice. Returns: anchor text per link, sentence(s)
//   wrapping them, and the full updated descriptionHtml with the
//   integration appended.
//
// Output: `product_update` proposals — when applied, the merchant's
// product description gains a real "Related products" paragraph
// written in their own voice, not a mechanical bullet list.
//
// LLM is opt-in: without GOOGLE_API_KEY we fall back to the previous
// HTML-list audit_finding output so non-LLM tier still gets value.
// ─────────────────────────────────────────────────────────────────────

const TOP_K = 4;
const MAX_PRODUCTS = 60;
const MAX_INTEGRATIONS = 30; // cap LLM calls per run

// ─── Output schema ──────────────────────────────────────────────────

const IntegrationSchema = z.object({
  anchorText: z
    .string()
    .max(80)
    .describe(
      "Anchor text for the link to the related product. Should be a meaningful phrase that previews what the user will find — not the bare product title.",
    ),
  paragraph: z
    .string()
    .describe(
      "Complete HTML paragraph (with embedded <a href>) written in the source product's voice, integrating the related-product links naturally. Lead with a transition sentence; explain the relationship; end with a clear call to follow the link. Use semantic HTML (<p>, <a>). No marketing fluff.",
    ),
  rationale: z
    .string()
    .describe("1 sentence: why this link makes sense from the source product's POV."),
});

const RewriteSchema = z.object({
  integrations: z
    .array(
      z.object({
        sourceHandle: z.string(),
        appendedHtml: z
          .string()
          .describe(
            "HTML block to append to the source product's existing descriptionHtml. Should include a heading like <h3>You might also like</h3> followed by the integrated paragraph(s). No surrounding <html>/<body>.",
          ),
        links: z.array(IntegrationSchema),
      }),
    )
    .describe("One integration per source product"),
});

const SYSTEM = `You write internal-link integration paragraphs for Shopify product descriptions.

Goals:
- Help AI search engines map this catalog as a coherent, interconnected entity.
- Help shoppers discover the right product variant from this product's page.
- Match the existing description's voice and register.

Rules:
- Output is HTML to APPEND to an existing product description (so produce a fragment,
  not a full document).
- Lead with an <h3> (e.g., "You might also like" or a more specific phrase that fits the
  voice — "Other ways to use this", "Compare with", "Pairs well with").
- Follow with one or two short paragraphs that integrate the related-product links
  naturally. Each link should explain WHY a shopper might prefer the related product
  (more power, smaller size, lower price, different use case).
- Use <a href="/products/<handle>"> for links — relative URLs only.
- Anchor text should preview what the user will find, not be the bare title. E.g.,
  "the more compact Mini Widget" not just "Mini Widget".
- No marketing fluff: ban "discover", "experience", "elevate", "perfect for", "indulge",
  "premium", "luxury".
- Match the source product's voice (you'll see the existing description as reference).`;

interface ProductPair {
  sourceHandle: string;
  sourceTitle: string;
  sourceDescription: string;
  candidates: Array<{
    handle: string;
    title: string;
    similarity: number;
  }>;
}

export const internalLinkingPlaybook: Playbook = {
  id: "internal-linking",
  name: "Internal Linking Suggester (AI)",
  description:
    "Vector similarity finds related products that aren't linked from each other; Gemini then writes a natural-voice paragraph integrating the links into the source product's description. Emits product_update proposals so apply ships real, AI-written internal links — not just suggestions.",

  async run({ shopId, shopify }) {
    const products = await fetchProducts(shopify, MAX_PRODUCTS);
    if (products.length < 4) {
      return {
        summary:
          "Not enough products to analyze internal linking. Need at least 4 active products.",
        proposals: [],
      };
    }

    // 1. Refresh embeddings.
    const inputs: ProductEmbeddingInput[] = products.map((p) => ({
      handle: p.handle,
      title: p.title,
      content: buildEmbeddingText(p),
    }));
    const embeddingsStored = await upsertProductEmbeddings(shopId, inputs);

    // 2. Find linking gaps.
    const byHandle = new Map<string, ProductSummary>(
      products.map((p) => [p.handle, p]),
    );
    const pairs: ProductPair[] = [];
    let pairsAnalyzed = 0;

    for (const p of products) {
      let hits;
      try {
        hits = await retrieveSimilarProducts(shopId, buildEmbeddingText(p), TOP_K + 1);
      } catch {
        continue;
      }
      const candidates = hits
        .filter((h) => h.handle !== p.handle && byHandle.has(h.handle))
        .slice(0, TOP_K);
      pairsAnalyzed += candidates.length;

      const existing = extractInternalProductLinks(p.description ?? "");
      const missing = candidates.filter((c) => !existing.has(c.handle));
      if (missing.length === 0) continue;

      pairs.push({
        sourceHandle: p.handle,
        sourceTitle: p.title,
        sourceDescription: stripHtml(p.description ?? "").slice(0, 1200),
        candidates: missing.map((m) => ({
          handle: m.handle,
          title: m.title,
          similarity: 1 - m.distance,
        })),
      });
    }

    if (pairs.length === 0) {
      return {
        summary: `No linking gaps found across ${products.length} products. ${pairsAnalyzed} candidate pairs analyzed.`,
        metrics: {
          productsAnalyzed: products.length,
          pairsAnalyzed,
          embeddingsStored,
          productsWithGaps: 0,
          llmIntegrated: 0,
        },
        proposals: [],
      };
    }

    const llmAvailable =
      !!process.env.GOOGLE_API_KEY ||
      !!process.env.GOOGLE_GENERATIVE_AI_API_KEY;

    if (!llmAvailable) {
      // Fallback: emit informational findings only.
      return {
        summary: `${pairs.length} products have linking gaps (${pairs.reduce((s, p) => s + p.candidates.length, 0)} suggested links). Set GOOGLE_API_KEY to generate AI-written integration paragraphs and turn these into apply-able product updates.`,
        metrics: {
          productsAnalyzed: products.length,
          pairsAnalyzed,
          embeddingsStored,
          productsWithGaps: pairs.length,
          llmIntegrated: 0,
        },
        proposals: pairs.map((pair) => fallbackFinding(pair)),
      };
    }

    // 3. LLM integration — generate natural paragraphs.
    const targets = pairs.slice(0, MAX_INTEGRATIONS);
    let integrations: Awaited<ReturnType<typeof generateIntegrations>> = [];
    try {
      integrations = await generateIntegrations(targets);
    } catch (err) {
      // If LLM fails, fall back to informational findings.
      return {
        summary: `LLM integration failed (${err instanceof Error ? err.message : String(err)}). Falling back to plain link suggestions for ${pairs.length} products.`,
        metrics: {
          productsAnalyzed: products.length,
          pairsAnalyzed,
          embeddingsStored,
          productsWithGaps: pairs.length,
          llmIntegrated: 0,
        },
        proposals: pairs.map((pair) => fallbackFinding(pair)),
      };
    }

    const integrationByHandle = new Map(
      integrations.map((i) => [i.sourceHandle, i]),
    );

    const proposals: ProposedChange[] = [];
    for (const pair of pairs) {
      const source = byHandle.get(pair.sourceHandle);
      if (!source) continue;
      const integration = integrationByHandle.get(pair.sourceHandle);

      if (!integration) {
        // No LLM result for this pair — emit informational fallback.
        proposals.push(fallbackFinding(pair));
        continue;
      }

      // Stitch the integration onto the existing description.
      const originalHtml = source.description ?? "";
      const newHtml = `${originalHtml.trimEnd()}\n\n${integration.appendedHtml}`;

      proposals.push({
        kind: "product_update",
        target: source.id,
        title: `Add internal links: ${source.title}`,
        description: `Adds AI-written 'related products' section linking to ${integration.links.length} semantically-similar product${integration.links.length === 1 ? "" : "s"}: ${integration.links.map((l) => l.anchorText).join(", ")}.`,
        before: { descriptionHtml: originalHtml },
        after: { descriptionHtml: newHtml },
      });
    }

    return {
      summary: `Generated AI-written internal-link integrations for ${proposals.filter((p) => p.kind === "product_update").length} products. ${pairsAnalyzed} candidate pairs analyzed.`,
      metrics: {
        productsAnalyzed: products.length,
        pairsAnalyzed,
        embeddingsStored,
        productsWithGaps: pairs.length,
        llmIntegrated: integrations.length,
      },
      proposals,
    };
  },
};

// ─── LLM call ───────────────────────────────────────────────────────

async function generateIntegrations(
  pairs: ProductPair[],
): Promise<
  Array<{
    sourceHandle: string;
    appendedHtml: string;
    links: Array<{
      anchorText: string;
      paragraph: string;
      rationale: string;
    }>;
  }>
> {
  if (pairs.length === 0) return [];

  const targetsList = pairs
    .map((pair) => {
      const candidates = pair.candidates
        .map(
          (c, i) =>
            `${i + 1}. handle: ${c.handle} | title: ${c.title} | similarity: ${c.similarity.toFixed(2)}`,
        )
        .join("\n  ");
      return `## Source product: ${pair.sourceTitle} (handle: ${pair.sourceHandle})
Existing description (voice/tone reference):
${pair.sourceDescription || "(empty)"}

Candidates to link:
  ${candidates}`;
    })
    .join("\n\n---\n\n");

  const prompt = ChatPromptTemplate.fromMessages([
    ["system", SYSTEM],
    [
      "human",
      `Generate one internal-link integration block per source product below. Match each source product's voice. Use 1-4 links per integration (don't have to use all candidates).

{targets}

Return one integration per source product, keyed by sourceHandle.`,
    ],
  ]);

  const model = buildChatModel({ temperature: 0.5 }).withStructuredOutput(
    RewriteSchema,
    { name: "InternalLinkIntegrations" },
  );

  const chain = prompt.pipe(model);
  const result = await chain.invoke({ targets: targetsList });
  return result.integrations;
}

// ─── Fallback (no LLM) ─────────────────────────────────────────────

function fallbackFinding(pair: ProductPair): ProposedChange {
  const list = pair.candidates
    .map(
      (c, i) =>
        `${i + 1}. ${c.title} — /products/${c.handle} (similarity: ${c.similarity.toFixed(2)})`,
    )
    .join("\n");
  const snippet = `<h3>You might also like</h3>\n<ul>\n${pair.candidates
    .map((c) => `  <li><a href="/products/${c.handle}">${c.title}</a></li>`)
    .join("\n")}\n</ul>`;
  return {
    kind: "audit_finding",
    target: `/products/${pair.sourceHandle}`,
    title: `${pair.candidates.length} related products are not linked from "${pair.sourceTitle}"`,
    description: `Vector-similar products that don't appear as links in this product's description:\n\n${list}\n\nSuggested HTML to insert:\n\n${snippet}`,
    before: null,
    after: {
      severity: "low",
      sourceHandle: pair.sourceHandle,
      suggestions: pair.candidates,
      snippet,
    },
  };
}

// ─── Helpers ───────────────────────────────────────────────────────

function buildEmbeddingText(p: ProductSummary): string {
  const desc = stripHtml(p.description || "");
  const meta: string[] = [];
  if (p.productType) meta.push(`Type: ${p.productType}`);
  if (p.vendor) meta.push(`Vendor: ${p.vendor}`);
  if (p.tags.length) meta.push(`Tags: ${p.tags.slice(0, 8).join(", ")}`);
  return [meta.join(" · "), desc].filter(Boolean).join("\n\n");
}

function extractInternalProductLinks(html: string): Set<string> {
  const links = new Set<string>();
  const pattern = /href=["']([^"']*\/products\/([a-z0-9][a-z0-9-]*)[^"']*)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(html))) {
    links.add(m[2]);
  }
  return links;
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}
