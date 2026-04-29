import "server-only";
import { generateObject } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import type {
  ProductSummary,
  ShopInfo,
} from "@/lib/agent/playbooks/machine-layer/queries";

// ─────────────────────────────────────────────────────────────────────
// Store profiling. One Claude call. Reads a sample of the store and
// returns a structured profile that downstream generators use to pick
// vertical-aware templates and write brand-aware content.
// ─────────────────────────────────────────────────────────────────────

export const VERTICALS = [
  "apparel_fashion",
  "beauty_personal_care",
  "food_beverage",
  "supplements_wellness",
  "electronics_gadgets",
  "home_furniture",
  "jewelry_accessories",
  "sports_outdoors",
  "pet_supplies",
  "art_collectibles",
  "books_media",
  "digital_courses",
  "services_subscriptions",
  "b2b_industrial",
  "general",
] as const;

export const SCHEMA_TYPES = [
  "Product",
  "Course",
  "Service",
  "Event",
  "Recipe",
  "SoftwareApplication",
  "Book",
] as const;

const StoreProfileSchema = z.object({
  vertical: z.enum(VERTICALS).describe(
    "best-fit vertical for this store; pick 'general' only if no other matches",
  ),
  schemaType: z
    .enum(SCHEMA_TYPES)
    .describe("primary schema.org type that best represents the items sold"),
  language: z
    .string()
    .describe(
      "ISO 639-1 language code of the storefront content (e.g. 'en', 'fr', 'de', 'ja')",
    ),
  brandVoice: z
    .string()
    .describe(
      "1–2 sentences describing the brand's tone, voice, and personality",
    ),
  brandSummary: z
    .string()
    .describe(
      "Crisp 2–3 sentence summary of what the store sells, who it's for, and what makes it different. Written in the brand's voice. This becomes the intro paragraph of /llms.txt.",
    ),
  highValueAttributes: z
    .array(z.string())
    .max(8)
    .describe(
      "Attributes most relevant to AI shopping queries for this vertical, in priority order. E.g. for supplements: ['ingredients','dosage','allergens','certifications']. For apparel: ['materials','sizing','fit','care']. For electronics: ['specs','compatibility','warranty','dimensions'].",
    ),
  productSummaryGuidance: z
    .string()
    .describe(
      "1 sentence guiding how each product should be summarized for AI consumption — what to lead with, what details matter, what to avoid.",
    ),
  audienceHint: z
    .string()
    .describe(
      "1 sentence describing the typical buyer (e.g. 'cost-conscious home cooks', 'enterprise dev teams', 'fashion-forward 20-somethings').",
    ),
});

export type StoreProfile = z.infer<typeof StoreProfileSchema>;

export interface ProfileInput {
  shop: ShopInfo;
  sampleProducts: ProductSummary[];
  aboutPageContent?: string | null;
}

const SYSTEM_PROMPT = `You are an expert e-commerce SEO and AEO (Answer Engine Optimization) analyst.
Your job is to read a sample of a Shopify store and produce a concise, structured profile
of what kind of store it is, who it sells to, and how its content should be optimized
for AI search engines like ChatGPT, Claude, and Perplexity.

Be precise and decisive. Do not hedge. Do not make things up — if a field is genuinely
unclear from the sample, infer the most likely value from the products provided.

The brandSummary you produce will become the first paragraph of an /llms.txt file —
the public AI-readable index of the store. Make it count: it should help an AI agent
quickly understand what this store is and decide whether to surface it for relevant
queries. Avoid marketing fluff. Be concrete about category, audience, and differentiation.`;

export async function profileStore(input: ProfileInput): Promise<StoreProfile> {
  const sampleText = input.sampleProducts
    .slice(0, 12)
    .map((p, i) => {
      const desc = (p.description || "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 400);
      const price =
        p.priceRangeFrom && p.currencyCode
          ? `${p.currencyCode} ${p.priceRangeFrom}`
          : "";
      return `${i + 1}. ${p.title}${price ? ` — ${price}` : ""}
   Type: ${p.productType || "(unspecified)"} · Vendor: ${p.vendor || "(none)"}
   Tags: ${p.tags.join(", ") || "(none)"}
   Description: ${desc || "(empty)"}`;
    })
    .join("\n\n");

  const prompt = `Analyze this Shopify store and produce a structured profile.

# Store
Name: ${input.shop.name}
Description: ${input.shop.description || "(empty)"}
URL: ${input.shop.url}

${input.aboutPageContent ? `# About page (excerpt)\n${input.aboutPageContent.slice(0, 2000)}\n` : ""}

# Sample products (${input.sampleProducts.length} total in store)
${sampleText || "(no products yet)"}

Return the structured profile.`;

  const { object } = await generateObject({
    model: anthropic("claude-sonnet-4-6"),
    schema: StoreProfileSchema,
    system: SYSTEM_PROMPT,
    prompt,
  });

  return object;
}
