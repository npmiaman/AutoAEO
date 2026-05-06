import "server-only";
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

// ─────────────────────────────────────────────────────────────────────
// Internal Linking Suggester (Pillar 1, Technical GEO).
//
// For each product, finds the top-k semantically related products via
// the vector store, then checks which of those are NOT already linked
// from the source product's description. For each missing link, emits
// an `audit_finding` proposal with the suggested href (and an HTML
// snippet you could paste to add a "You might also like" section).
//
// We don't auto-edit descriptions here — that's the Description
// Rewriter's job. This playbook is purely for surfacing opportunities.
// ─────────────────────────────────────────────────────────────────────

const TOP_K = 5;
const MAX_PRODUCTS = 100;

export const internalLinkingPlaybook: Playbook = {
  id: "internal-linking",
  name: "Internal Linking Suggester",
  description:
    "Uses vector similarity to find pairs of related products that should link to each other. Strong internal linking across topic clusters helps AI bots map your catalog as a coherent entity. Surfaces gap suggestions; doesn't auto-edit content.",

  async run({ shopId, shopify }) {
    const products = await fetchProducts(shopify, MAX_PRODUCTS);
    if (products.length < 4) {
      return {
        summary:
          "Not enough products to analyze internal linking. Need at least 4 active products.",
        proposals: [],
      };
    }

    // 1. Embed (or refresh embeddings for) the catalog so we can search.
    const inputs: ProductEmbeddingInput[] = products.map((p) => ({
      handle: p.handle,
      title: p.title,
      content: buildEmbeddingText(p),
    }));
    const embeddingsStored = await upsertProductEmbeddings(shopId, inputs);

    // 2. Build a map of products by handle for cheap lookups.
    const byHandle = new Map<string, ProductSummary>(
      products.map((p) => [p.handle, p]),
    );

    // 3. For each product, find similar candidates and detect missing links.
    const proposals: ProposedChange[] = [];
    let pairsAnalyzed = 0;
    let suggestionsCount = 0;

    for (const p of products) {
      // Use the product's own embedding text as the query so we get its
      // closest matches in the catalog.
      const query = buildEmbeddingText(p);
      let hits;
      try {
        hits = await retrieveSimilarProducts(shopId, query, TOP_K + 1);
      } catch {
        continue;
      }

      // Drop the product itself from the results.
      const candidates = hits.filter((h) => h.handle !== p.handle).slice(0, TOP_K);
      pairsAnalyzed += candidates.length;

      const existingLinks = extractInternalProductLinks(p.description ?? "");
      const missing = candidates.filter(
        (c) => byHandle.has(c.handle) && !existingLinks.has(c.handle),
      );

      if (missing.length === 0) continue;

      const suggestionList = missing
        .map(
          (m, i) =>
            `${i + 1}. ${m.title} — /products/${m.handle} (similarity: ${(1 - m.distance).toFixed(2)})`,
        )
        .join("\n");

      const suggestedSnippet = `<h3>You might also like</h3>\n<ul>\n${missing
        .map((m) => `  <li><a href="/products/${m.handle}">${m.title}</a></li>`)
        .join("\n")}\n</ul>`;

      proposals.push({
        kind: "audit_finding",
        target: `/products/${p.handle}`,
        title: `${missing.length} related products are not linked from "${p.title}"`,
        description: `Vector-similar products that don't appear as links in this product's description:\n\n${suggestionList}\n\nSuggested HTML to insert into the product description:\n\n${suggestedSnippet}`,
        before: null,
        after: {
          severity: "low",
          sourceHandle: p.handle,
          suggestions: missing.map((m) => ({
            handle: m.handle,
            title: m.title,
            similarity: 1 - m.distance,
          })),
          snippet: suggestedSnippet,
        },
      });
      suggestionsCount += missing.length;
    }

    return {
      summary: `Analyzed ${pairsAnalyzed} candidate product pairs across ${products.length} products. Found ${proposals.length} products with linking gaps (${suggestionsCount} suggested links).`,
      metrics: {
        productsAnalyzed: products.length,
        pairsAnalyzed,
        productsWithGaps: proposals.length,
        suggestedLinks: suggestionsCount,
        embeddingsStored,
      },
      proposals,
    };
  },
};

function buildEmbeddingText(p: ProductSummary): string {
  const desc = (p.description || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const meta: string[] = [];
  if (p.productType) meta.push(`Type: ${p.productType}`);
  if (p.vendor) meta.push(`Vendor: ${p.vendor}`);
  if (p.tags.length) meta.push(`Tags: ${p.tags.slice(0, 8).join(", ")}`);
  return [meta.join(" · "), desc].filter(Boolean).join("\n\n");
}

/**
 * Extract product handles linked from a description's HTML body. Matches
 * /products/<handle> hrefs (relative or absolute).
 */
function extractInternalProductLinks(html: string): Set<string> {
  const links = new Set<string>();
  const pattern = /href=["']([^"']*\/products\/([a-z0-9][a-z0-9-]*)[^"']*)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(html))) {
    links.add(m[2]);
  }
  return links;
}
