import "server-only";
import { z } from "zod";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import type { Playbook, ProposedChange } from "@/lib/agent/types";
import type { ShopifyClient } from "@/lib/shopify/client";
import { buildChatModel } from "@/lib/agent/llm";
import {
  fetchPages,
  fetchShopInfo,
  type PageSummary,
  type ShopInfo,
} from "@/lib/agent/playbooks/machine-layer/queries";

// ─────────────────────────────────────────────────────────────────────
// FAQ Generator (Pillar 2, Content GEO).
//
// Reads existing pages + the shop's About content and uses Gemini to
// extract / generate Q&A pairs. The output is stored as a JSON metafield
// (`autoaeo.faq` on each Page) shaped exactly the way our Schema Markup
// playbook's snippet expects — so once both playbooks are applied,
// every page emits FAQPage JSON-LD. FAQPage is the single biggest
// AEO-citation win.
//
// We target Pages (not Products) for v1 because:
//   1. Pages tend to have prose content with implicit Q&A patterns.
//   2. Product FAQs are more naturally surfaced inside the product
//      description (handled by the Description Rewriter).
// ─────────────────────────────────────────────────────────────────────

const MIN_BODY_BYTES = 400;
const MAX_PAGES = 30;

// ─── Output schema ──────────────────────────────────────────────────

const FaqEntrySchema = z.object({
  question: z
    .string()
    .describe(
      "A natural-language question a real shopper would type into ChatGPT or Perplexity about this content. Phrase it as a complete question.",
    ),
  answer: z
    .string()
    .describe(
      "Direct, factual answer in 30-100 words. Plain text only (no HTML). Lead with the answer in the first sentence; add supporting detail after. Must be derivable from the source page content — do not invent facts.",
    ),
});

const FaqsSchema = z.object({
  faqs: z
    .array(FaqEntrySchema)
    .min(0)
    .max(10)
    .describe(
      "0–10 frequently-asked questions and answers extracted from the page content. Skip rather than fabricate — return an empty array if the page doesn't naturally support FAQ extraction.",
    ),
});

const SYSTEM = `You extract or generate frequently-asked questions for an AEO-optimized FAQPage
schema, working from a single page's content.

Goals:
- The FAQ entries become structured data that AI engines (ChatGPT, Claude, Perplexity,
  Google AI) cite as direct answers.
- Each Q&A pair must be useful to a real shopper: questions must be natural-language and
  decision-relevant, answers must be concrete and citable.

Rules:
- Read only the source content provided. Never invent facts not supported by the source.
- If the page doesn't naturally support FAQs (e.g., a contact page with no informational
  content), return an empty array — quality over quantity.
- Phrase questions as a real shopper would: "Does X ship internationally?", "How do I…",
  "What is X made of?", "When does X arrive?".
- Lead each answer with a direct response. Add detail after.
- 30–100 words per answer.
- Plain text only — no HTML, no markdown.
- Avoid duplicate or near-duplicate questions across the set.`;

interface PageWithMetafields extends PageSummary {
  bodyHtml: string;
  pageGid: string;
  existingFaqMetafield: string | null;
}

export const faqGeneratorPlaybook: Playbook = {
  id: "faq-generator",
  name: "FAQ Generator (AI)",
  description:
    "Gemini extracts and generates a FAQPage-shaped Q&A set for each substantive page on your store, then writes it to the autoaeo.faq metafield. The Schema Markup playbook's snippet automatically emits the FAQPage JSON-LD wherever this metafield exists. Requires GOOGLE_API_KEY.",

  async run({ shopify }) {
    if (
      !process.env.GOOGLE_API_KEY &&
      !process.env.GOOGLE_GENERATIVE_AI_API_KEY
    ) {
      return {
        summary: "GOOGLE_API_KEY is not configured. Set it in .env.local.",
        proposals: [],
      };
    }

    const [shop, pages] = await Promise.all([
      fetchShopInfo(shopify),
      fetchAllPagesWithBodyAndFaqMetafield(shopify, MAX_PAGES),
    ]);

    // Filter to pages that have substantive content worth FAQ-ifying.
    const candidates = pages.filter(
      (p) => stripHtml(p.bodyHtml).length >= MIN_BODY_BYTES,
    );

    if (candidates.length === 0) {
      return {
        summary:
          "No pages found with enough content to extract FAQs from. Add page content (About, Shipping, FAQ, etc.) and re-run.",
        proposals: [],
      };
    }

    // Generate FAQs page-by-page. Each is an independent LLM call so a
    // failure on one page doesn't poison the others.
    const proposals: ProposedChange[] = [];
    let succeeded = 0;
    let skipped = 0;
    let failed = 0;

    for (const page of candidates) {
      try {
        const faqs = await generateFaqsForPage(shop, page);
        if (faqs.length === 0) {
          skipped++;
          continue;
        }

        // Shape it as FAQPage Question entities so the snippet can render
        // it with no further transformation.
        const mainEntity = faqs.map((f) => ({
          "@type": "Question",
          name: f.question,
          acceptedAnswer: { "@type": "Answer", text: f.answer },
        }));
        const value = JSON.stringify(mainEntity);

        const before = page.existingFaqMetafield
          ? { type: "json", value: page.existingFaqMetafield }
          : null;
        const after = { type: "json", value };

        proposals.push({
          kind: "metafield_set",
          target: `${page.pageGid}:autoaeo.faq`,
          title: `FAQ schema for "${page.title}" (${faqs.length} questions)`,
          description: `Generates a FAQPage-shaped Q&A set from this page's content. Once applied, the Schema Markup playbook's site-wide snippet automatically emits FAQPage JSON-LD on this page so AI engines can cite individual Q&A pairs.`,
          before,
          after,
        });
        succeeded++;
      } catch (err) {
        failed++;
        proposals.push({
          kind: "audit_finding",
          target: `/pages/${page.handle}`,
          title: `FAQ generation failed for "${page.title}"`,
          description: err instanceof Error ? err.message : String(err),
          before: null,
          after: { severity: "low" },
        });
      }
    }

    return {
      summary: `Generated FAQ schema for ${succeeded} page${succeeded === 1 ? "" : "s"}${
        skipped > 0 ? ` (${skipped} skipped — content not FAQ-shaped)` : ""
      }${failed > 0 ? ` (${failed} failed)` : ""}.`,
      metrics: {
        pagesScanned: pages.length,
        candidates: candidates.length,
        succeeded,
        skipped,
        failed,
      },
      proposals,
    };
  },
};

// ─── LLM call per page ──────────────────────────────────────────────

async function generateFaqsForPage(
  shop: ShopInfo,
  page: PageWithMetafields,
): Promise<Array<{ question: string; answer: string }>> {
  const cleanBody = stripHtml(page.bodyHtml).slice(0, 12_000);

  const prompt = ChatPromptTemplate.fromMessages([
    ["system", SYSTEM],
    [
      "human",
      `Store: {shopName}
Brand: {shopDescription}

# Page
Title: {pageTitle}
URL: {pageUrl}

## Page content
{pageBody}

Extract or generate FAQ Q&A pairs from the content above. Return at most 8 entries; quality over quantity. Empty array is acceptable if the content doesn't naturally support FAQs.`,
    ],
  ]);

  const model = buildChatModel({ temperature: 0.3 }).withStructuredOutput(
    FaqsSchema,
    { name: "PageFaqs" },
  );

  const chain = prompt.pipe(model);
  const result = await chain.invoke({
    shopName: shop.name,
    shopDescription: shop.description ?? "",
    pageTitle: page.title,
    pageUrl: `${shop.url}/pages/${page.handle}`,
    pageBody: cleanBody,
  });

  return result.faqs;
}

// ─── Shopify queries ────────────────────────────────────────────────

async function fetchAllPagesWithBodyAndFaqMetafield(
  client: ShopifyClient,
  limit: number,
): Promise<PageWithMetafields[]> {
  // GraphQL pages query — gives us the gid (needed for metafields) +
  // body + existing autoaeo.faq metafield in one round-trip.
  const data = await client.graphql<{
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
      query AutoAEO_PagesWithFaq($first: Int!) {
        pages(first: $first, sortKey: UPDATED_AT, reverse: true) {
          edges {
            node {
              id
              handle
              title
              body
              metafield(namespace: "autoaeo", key: "faq") { value }
            }
          }
        }
      }
    `,
    { first: limit },
  );

  return data.pages.edges.map((e) => ({
    id: String(e.node.id),
    pageGid: e.node.id,
    handle: e.node.handle,
    title: e.node.title,
    bodySummary: stripHtml(e.node.body).slice(0, 280),
    bodyHtml: e.node.body,
    existingFaqMetafield: e.node.metafield?.value ?? null,
    onlineStoreUrl: null,
  }));
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}
