import "server-only";
import { generateObject } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import type { ProductSummary } from "@/lib/agent/playbooks/machine-layer/queries";
import type { StoreProfile } from "./profile";

// ─────────────────────────────────────────────────────────────────────
// One batched Claude call to produce AEO-formatted one-line summaries
// for a list of products. These replace the truncated raw descriptions
// in /llms.txt with brand-aware, query-relevant value props.
// ─────────────────────────────────────────────────────────────────────

const SummariesSchema = z.object({
  summaries: z
    .array(
      z.object({
        handle: z.string(),
        summary: z
          .string()
          .describe(
            "One sentence (max 25 words) capturing what the product is, who it's for, and the single most relevant attribute for AI shopping queries. No marketing fluff. No 'discover' / 'experience' / 'crafted with care'. Lead with the concrete noun.",
          ),
      }),
    )
    .describe("Exactly one summary per input product, keyed by handle"),
});

const SYSTEM = `You write product one-liners for an AI-readable index (/llms.txt).
Each summary helps an AI agent decide whether the product is relevant to a user's query.

Rules:
- Maximum 25 words. Often fewer is better.
- Lead with the concrete category noun (e.g. "Stainless steel kitchen knife…", "Daily multivitamin for women…", "Wireless noise-cancelling headphones…"). Never lead with the brand name.
- Surface the single most query-relevant attribute first (price tier / material / dosage / use case / spec).
- Avoid marketing copy: no "discover", "experience", "crafted with care", "premium", "luxury", "ultimate".
- Use plain, direct, factual language matching the store's voice.
- If the source description is empty or generic, infer from the title and product type. Do not invent specifications you can't verify.`;

export async function generateProductSummaries(args: {
  profile: StoreProfile;
  products: ProductSummary[];
}): Promise<Map<string, string>> {
  const { profile, products } = args;
  if (products.length === 0) return new Map();

  // Hard cap to keep token count reasonable.
  const sliced = products.slice(0, 100);

  const productList = sliced
    .map((p) => {
      const desc = (p.description || "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 350);
      const price =
        p.priceRangeFrom && p.currencyCode
          ? `${p.currencyCode} ${p.priceRangeFrom}`
          : "";
      return `- handle: ${p.handle}
  title: ${p.title}${price ? ` (${price})` : ""}
  type: ${p.productType || "(unspecified)"}
  desc: ${desc || "(empty)"}`;
    })
    .join("\n");

  const prompt = `# Store profile
Vertical: ${profile.vertical}
Audience: ${profile.audienceHint}
Brand voice: ${profile.brandVoice}
Per-product guidance: ${profile.productSummaryGuidance}
High-value attributes (use these as your priority list when choosing what to surface): ${profile.highValueAttributes.join(", ")}

# Products to summarize (${sliced.length})
${productList}

Return one summary per product, keyed by handle.`;

  const { object } = await generateObject({
    model: anthropic("claude-sonnet-4-6"),
    schema: SummariesSchema,
    system: SYSTEM,
    prompt,
  });

  const map = new Map<string, string>();
  for (const s of object.summaries) {
    map.set(s.handle, s.summary);
  }
  return map;
}
