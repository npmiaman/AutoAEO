import "server-only";
import { z } from "zod";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import type { Playbook, ProposedChange } from "@/lib/agent/types";
import type { ShopifyClient } from "@/lib/shopify/client";
import { buildChatModel } from "@/lib/agent/llm";

// ─────────────────────────────────────────────────────────────────────
// Alt Text Generator (Pillar 2, Content GEO).
//
// Multimodal Gemini (gemini-2.5-flash) writes descriptive, SEO-friendly
// alt text for every product image that's missing one. AI image search,
// accessibility tools, and crawlers all rely on alt text for visual
// content — a missing alt is a dropped signal.
//
// We deliberately only target images with no existing alt text or with
// generic placeholders (e.g., "image", "product"). We do not overwrite
// alt text that already looks human-authored.
// ─────────────────────────────────────────────────────────────────────

const MAX_IMAGES = 100;
const MAX_PRODUCTS_TO_FETCH = 100;

interface ProductImage {
  productId: string; // gid://shopify/Product/...
  productTitle: string;
  productHandle: string;
  imageId: string; // numeric or gid
  imageUrl: string;
  currentAlt: string | null;
}

const AltTextSchema = z.object({
  altText: z
    .string()
    .max(125)
    .describe(
      "Descriptive alt text under 125 characters. Lead with the concrete subject (the product noun + most distinctive visual attribute). Mention setting/context only if visible. No 'image of', 'photo of', 'picture of'. No marketing fluff. Be precise about what is visually depicted.",
    ),
});

const SYSTEM = `You write alt text for Shopify product images. The alt text serves three audiences:
1. Screen reader users
2. Image search crawlers (Google Images, Bing Images)
3. AI search engines that read alt text as a structured signal about visual content

Rules:
- Maximum 125 characters
- Lead with the concrete product noun (e.g. "Stainless steel chef's knife with walnut handle…")
- Describe what is VISUALLY present in the image: the subject, distinguishing features, color, material, setting if relevant
- Mention the brand only if it is visibly part of the image (e.g. logo on packaging)
- Never use "image of", "photo of", "picture of"
- Never use marketing words ("premium", "luxury", "ultimate", "elevate", "indulge")
- If the image is clearly a context/lifestyle shot, describe the setting briefly (e.g. "…on a wooden cutting board with fresh herbs")
- If the image is clearly a packaging/closeup, describe what's visible

You will receive the product title and the image URL. Use the visual content as the source of truth for what to describe.`;

export const altTextGeneratorPlaybook: Playbook = {
  id: "alt-text-generator",
  name: "Alt Text Generator (AI)",
  description:
    "Gemini's multimodal model writes descriptive, AEO-friendly alt text for every product image that's missing or has placeholder alt. Closes the visual-content gap that AI image search and accessibility tools care about. Requires GOOGLE_API_KEY.",

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

    // 1. Pull products + their images. This needs a richer GraphQL query
    // than the standard fetchProducts because we need image IDs and alt text.
    const images = await fetchProductImagesMissingAlt(shopify, MAX_PRODUCTS_TO_FETCH);
    if (images.length === 0) {
      return {
        summary:
          "Every product image already has alt text. Nothing to generate.",
        proposals: [],
      };
    }

    const targets = images.slice(0, MAX_IMAGES);

    // 2. For each image, call Gemini Vision to generate alt text.
    const proposals: ProposedChange[] = [];
    let succeeded = 0;
    let failed = 0;

    for (const img of targets) {
      try {
        const altText = await generateAltText(img);
        proposals.push({
          kind: "image_alt_update",
          target: `${img.productId}:${img.imageId}`,
          title: `Alt text: ${img.productTitle}`,
          description: img.currentAlt
            ? `Replaces placeholder alt text "${img.currentAlt}" with a descriptive version.`
            : `Adds alt text to a previously empty image.`,
          before: { altText: img.currentAlt ?? "" },
          after: { altText, imageUrl: img.imageUrl },
        });
        succeeded++;
      } catch (err) {
        failed++;
        // Surface as audit_finding so the merchant sees the failure but the
        // run can still apply successful proposals.
        proposals.push({
          kind: "audit_finding",
          target: `${img.productId}:${img.imageId}`,
          title: `Alt text generation failed for ${img.productTitle}`,
          description: `Image: ${img.imageUrl}\nReason: ${err instanceof Error ? err.message : String(err)}`,
          before: null,
          after: { severity: "low" },
        });
      }
    }

    return {
      summary: `Generated alt text for ${succeeded} image${succeeded === 1 ? "" : "s"}${failed > 0 ? ` (${failed} failed)` : ""} across ${new Set(targets.map((t) => t.productId)).size} products. ${images.length > MAX_IMAGES ? `${images.length - MAX_IMAGES} more images need alt text — re-run to process them.` : ""}`,
      metrics: {
        imagesScanned: images.length,
        imagesProcessed: targets.length,
        succeeded,
        failed,
      },
      proposals,
    };
  },
};

// ─── Vision call ────────────────────────────────────────────────────

async function generateAltText(img: ProductImage): Promise<string> {
  const model = buildChatModel({ temperature: 0.4 }).withStructuredOutput(
    AltTextSchema,
    { name: "AltText" },
  );

  const messages = [
    new SystemMessage(SYSTEM),
    new HumanMessage({
      content: [
        {
          type: "text",
          text: `Write alt text for this product image.\n\nProduct title: ${img.productTitle}\nProduct handle: ${img.productHandle}\nImage URL (for reference): ${img.imageUrl}\n\nReturn the alt text.`,
        },
        {
          type: "image_url",
          image_url: img.imageUrl,
        },
      ],
    }),
  ];

  const result = await model.invoke(messages);
  return result.altText;
}

// ─── Shopify query: products + images with alt text status ──────────

async function fetchProductImagesMissingAlt(
  client: ShopifyClient,
  productLimit: number,
): Promise<ProductImage[]> {
  const data = await client.graphql<{
    products: {
      edges: Array<{
        node: {
          id: string;
          title: string;
          handle: string;
          images: {
            edges: Array<{
              node: {
                id: string;
                url: string;
                altText: string | null;
              };
            }>;
          };
        };
      }>;
    };
  }>(
    /* GraphQL */ `
      query AutoAEO_ProductImages($first: Int!) {
        products(first: $first, query: "status:active", sortKey: UPDATED_AT, reverse: true) {
          edges {
            node {
              id
              title
              handle
              images(first: 6) {
                edges {
                  node { id url altText }
                }
              }
            }
          }
        }
      }
    `,
    { first: productLimit },
  );

  const out: ProductImage[] = [];
  for (const pEdge of data.products.edges) {
    const p = pEdge.node;
    for (const iEdge of p.images.edges) {
      const img = iEdge.node;
      if (needsAlt(img.altText)) {
        out.push({
          productId: p.id,
          productTitle: p.title,
          productHandle: p.handle,
          imageId: img.id,
          imageUrl: img.url,
          currentAlt: img.altText,
        });
      }
    }
  }
  return out;
}

function needsAlt(alt: string | null): boolean {
  if (!alt) return true;
  const trimmed = alt.trim().toLowerCase();
  if (trimmed.length === 0) return true;
  if (trimmed.length < 4) return true;
  if (
    /^(image|photo|picture|product|main|hero|thumbnail|untitled|default)$/.test(trimmed)
  ) {
    return true;
  }
  return false;
}
