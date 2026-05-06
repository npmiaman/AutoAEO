import "server-only";
import { z } from "zod";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { buildChatModel } from "@/lib/agent/llm";
import {
  retrieveSimilarProducts,
  type SimilarProductHit,
} from "@/lib/agent/vector-store";
import type { ProductSummary } from "@/lib/agent/playbooks/machine-layer/queries";
import type { StoreProfile } from "./profile";

// ─────────────────────────────────────────────────────────────────────
// AEO-formatted product summaries via Gemini, with vector retrieval.
//
// For each product, we retrieve k semantically-similar products from
// the same store as RAG context. This gives Gemini concrete examples
// of how the store's catalog frames similar items, leading to summaries
// that are consistent in tone and surface attributes the LLM might
// otherwise miss.
//
// Implementation notes:
//   - We batch products into a single LLM call (one shot per ~50 products)
//     to amortize latency and keep summaries internally consistent.
//   - The retrieval context is included in the prompt as few-shot examples.
//   - Output is type-safe via Zod + withStructuredOutput.
// ─────────────────────────────────────────────────────────────────────

const SummariesSchema = z.object({
  summaries: z
    .array(
      z.object({
        handle: z.string(),
        summary: z
          .string()
          .describe(
            "One sentence (max 25 words). Lead with the concrete category noun. Surface the single most query-relevant attribute first. No marketing fluff.",
          ),
      }),
    )
    .describe("Exactly one summary per input product, keyed by handle"),
});

const SYSTEM = `You write product one-liners for an AI-readable index (/llms.txt).
Each summary helps an AI agent decide whether the product is relevant to a user's query.

Rules:
- Maximum 25 words. Often fewer is better.
- Lead with the concrete category noun (e.g. "Stainless steel kitchen knife…", "Daily multivitamin for women…").
  Never lead with the brand name.
- Surface the single most query-relevant attribute first (price tier / material / dosage / use case / spec).
- Avoid marketing copy: no "discover", "experience", "crafted with care", "premium", "luxury", "ultimate".
- Use plain, direct, factual language matching the store's voice.
- If the source description is empty or generic, infer from the title and product type.
  Do not invent specifications you cannot verify.`;

export interface SummariesInput {
  profile: StoreProfile;
  products: ProductSummary[];
  shopId: string;
}

export async function generateProductSummaries(
  input: SummariesInput,
): Promise<Map<string, string>> {
  const { profile, products, shopId } = input;
  if (products.length === 0) return new Map();

  // Hard cap to keep token count reasonable.
  const sliced = products.slice(0, 100);

  // RAG: for each product we retrieve k similar products from the vector
  // store and inline them as few-shot reference. We do this once for the
  // batch by retrieving against the *centroid* concept (the profile's
  // brandSummary) — this gives a consistent set of catalog exemplars
  // that match the store's voice without doing N retrievals.
  const retrievalQuery = `${profile.brandSummary}\n\nVertical: ${profile.vertical}\nAudience: ${profile.audienceHint}`;
  let exemplars: SimilarProductHit[] = [];
  try {
    exemplars = await retrieveSimilarProducts(shopId, retrievalQuery, 5);
  } catch {
    // If the vector index isn't ready yet (first run) we proceed without
    // RAG context. The profile + per-product description still produce
    // good summaries; RAG is an enhancement, not a hard requirement.
    exemplars = [];
  }

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

  const exemplarSection =
    exemplars.length > 0
      ? `# Catalog exemplars (similar products in this store, for tone/voice reference)
${exemplars
  .map(
    (e, i) =>
      `${i + 1}. ${e.title}\n   ${e.content.replace(/\s+/g, " ").slice(0, 240)}`,
  )
  .join("\n")}\n`
      : "";

  const prompt = ChatPromptTemplate.fromMessages([
    ["system", SYSTEM],
    [
      "human",
      `# Store profile
Vertical: {vertical}
Audience: {audience}
Brand voice: {voice}
Per-product guidance: {guidance}
High-value attributes (priority list — surface these when present): {attrs}

{exemplarSection}
# Products to summarize ({count})
{productList}

Return one summary per product, keyed by handle.`,
    ],
  ]);

  const model = buildChatModel({ temperature: 0.4 }).withStructuredOutput(
    SummariesSchema,
    { name: "ProductSummaries" },
  );

  const chain = prompt.pipe(model);

  const result = await chain.invoke({
    vertical: profile.vertical,
    audience: profile.audienceHint,
    voice: profile.brandVoice,
    guidance: profile.productSummaryGuidance,
    attrs: profile.highValueAttributes.join(", "),
    exemplarSection,
    count: sliced.length,
    productList,
  });

  const map = new Map<string, string>();
  for (const s of result.summaries) {
    map.set(s.handle, s.summary);
  }
  return map;
}
