import "server-only";
import { z } from "zod";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { buildChatModel } from "@/lib/agent/llm";
import type {
  ProductSummary,
  ShopInfo,
} from "@/lib/agent/playbooks/machine-layer/queries";

// ─────────────────────────────────────────────────────────────────────
// Store profiling — single Gemini call via LangChain.
// Reads a sample of the store and returns a structured profile that
// downstream nodes use to pick vertical-aware templates and write
// brand-aware content. Output is type-safe via Zod + withStructuredOutput.
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

export const StoreProfileSchema = z.object({
  vertical: z
    .enum(VERTICALS)
    .describe("best-fit vertical; use 'general' only if nothing else matches"),
  schemaType: z
    .enum(SCHEMA_TYPES)
    .describe("primary schema.org type that best represents items sold"),
  language: z
    .string()
    .describe("ISO 639-1 language code of the storefront content"),
  brandVoice: z
    .string()
    .describe("1–2 sentences describing tone, voice, and personality"),
  brandSummary: z
    .string()
    .describe(
      "Crisp 2–3 sentence summary in brand voice. Becomes the /llms.txt intro paragraph.",
    ),
  highValueAttributes: z
    .array(z.string())
    .max(8)
    .describe(
      "Attributes most relevant to AI shopping queries for this vertical, ordered by priority.",
    ),
  productSummaryGuidance: z
    .string()
    .describe(
      "1 sentence guiding how each product should be summarized — what to lead with, what details matter.",
    ),
  audienceHint: z
    .string()
    .describe("1 sentence describing the typical buyer."),
});

export type StoreProfile = z.infer<typeof StoreProfileSchema>;

const SYSTEM_PROMPT = `You are an expert e-commerce SEO and AEO (Answer Engine Optimization) analyst.
Read a sample of a Shopify store and produce a concise, structured profile of what kind of store
it is, who it sells to, and how its content should be optimized for AI search engines.

Be precise and decisive. Do not hedge. Do not invent facts; if a field is unclear from the
sample, infer the most likely value from the products provided.

The brandSummary becomes the first paragraph of /llms.txt — the AI-readable index of the store.
Make it count: it should help an AI agent quickly understand what this store is and decide
whether to surface it for relevant queries. Avoid marketing fluff. Be concrete about category,
audience, and differentiation.`;

export interface ProfileInput {
  shop: ShopInfo;
  sampleProducts: ProductSummary[];
  aboutPageContent?: string | null;
}

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

  const prompt = ChatPromptTemplate.fromMessages([
    ["system", SYSTEM_PROMPT],
    [
      "human",
      `Analyze this Shopify store and produce a structured profile.

# Store
Name: {shopName}
Description: {shopDescription}
URL: {shopUrl}

{aboutSection}

# Sample products ({totalCount} total in store)
{sampleText}

Return the structured profile.`,
    ],
  ]);

  const model = buildChatModel({ temperature: 0.2 }).withStructuredOutput(
    StoreProfileSchema,
    { name: "StoreProfile" },
  );

  const chain = prompt.pipe(model);

  const profile = await chain.invoke({
    shopName: input.shop.name,
    shopDescription: input.shop.description ?? "(empty)",
    shopUrl: input.shop.url,
    aboutSection: input.aboutPageContent
      ? `# About page (excerpt)\n${input.aboutPageContent.slice(0, 2000)}\n`
      : "",
    totalCount: input.sampleProducts.length,
    sampleText: sampleText || "(no products yet)",
  });

  return profile;
}
