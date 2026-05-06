import "server-only";
import { z } from "zod";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { buildChatModel } from "@/lib/agent/llm";

// ─────────────────────────────────────────────────────────────────────
// LLM enrichment for the Schema Markup playbook.
//
// Reads page / article / (richly-described) product content and asks
// Gemini to:
//   1. Decide whether the resource warrants a richer schema.org type
//      beyond the universal Product / WebPage / BlogPosting we already
//      emit (e.g., Recipe, HowTo, Course, Service, Event, Book,
//      SoftwareApplication, ItemList, Review).
//   2. If yes, extract the structured data and return a complete
//      JSON-LD entity (without @context) ready to drop into the
//      schema snippet's @graph.
//
// The output entity is stored as the autoaeo.schema_extra metafield
// on its owner; the snippet renders it conditionally.
// ─────────────────────────────────────────────────────────────────────

export const ENRICHED_SCHEMA_TYPES = [
  "Recipe",
  "HowTo",
  "Course",
  "Service",
  "Event",
  "Book",
  "SoftwareApplication",
  "ItemList",
  "VideoObject",
  "MusicRecording",
  "Person",
  "QAPage",
] as const;

const EnrichmentSchema = z.object({
  applicable: z
    .boolean()
    .describe(
      "Does this content warrant a richer schema.org type beyond the universal one we already emit? Set to false (and skip extraction) if the content is generic and adding more schema would be cargo-cult.",
    ),
  schemaType: z
    .enum(ENRICHED_SCHEMA_TYPES)
    .nullable()
    .describe(
      "The most specific schema.org type that fits the content. null if applicable=false.",
    ),
  jsonLd: z
    .string()
    .nullable()
    .describe(
      "A complete JSON-LD entity as a JSON-encoded string (without the @context wrapper — that lives in the snippet). MUST be valid JSON parsable into a single object. Include @type, all required fields for the chosen type, and any optional fields you can extract verifiably from the source. Never invent facts not in the source. null if applicable=false.",
    ),
  reasoning: z
    .string()
    .describe(
      "1–2 sentences explaining why this type was chosen (or why no enrichment applies).",
    ),
});

export type EnrichmentResult = z.infer<typeof EnrichmentSchema>;

const SYSTEM = `You are a schema.org expert evaluating Shopify content for AEO optimization.

For each input — a page, article, or product description — decide whether it warrants
a richer schema.org type than the universal one we already emit (Product / WebPage /
BlogPosting). Examples:
  - A "How to install our widget" article → HowTo
  - A "Sourdough starter" recipe page → Recipe
  - A "Online jewelry-making class" product → Course
  - A "Repair service for X" product → Service
  - An event page → Event
  - A coffee subscription that's a list of items → ItemList

If the content is generic (a contact page, a regular product description with no
special structure, a marketing page), set applicable=false and skip extraction. Quality
over quantity — a wrong schema is worse than no schema.

When you do extract:
  - Output a COMPLETE JSON-LD entity as a JSON-encoded string (just the object, no @context).
  - Include @type and all required fields for that schema.org type.
  - Include optional fields ONLY if you can verify them from the source.
  - NEVER invent facts (ingredients, durations, prices, dates, addresses, names) not in the source.
  - Use schema.org standard property names exactly.

Required fields by type (non-exhaustive):
  - Recipe: name, recipeIngredient, recipeInstructions
  - HowTo: name, step (HowToStep[])
  - Course: name, description, provider
  - Service: name, provider, areaServed
  - Event: name, startDate, location
  - Book: name, author
  - SoftwareApplication: name, applicationCategory, operatingSystem`;

export interface EnrichmentInput {
  resourceKind: "page" | "article" | "product";
  title: string;
  contentText: string;
  url: string;
  contextHint?: string;
}

export async function enrichSchema(
  input: EnrichmentInput,
): Promise<EnrichmentResult> {
  const cleanContent = input.contentText
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 8_000);

  const prompt = ChatPromptTemplate.fromMessages([
    ["system", SYSTEM],
    [
      "human",
      `Resource type: {kind}
Title: {title}
URL: {url}
{contextLine}

# Content
{content}

Decide whether to enrich. If yes, extract the JSON-LD entity (as a JSON-encoded string).`,
    ],
  ]);

  const model = buildChatModel({ temperature: 0.2 }).withStructuredOutput(
    EnrichmentSchema,
    { name: "SchemaEnrichment" },
  );

  const chain = prompt.pipe(model);
  const result = await chain.invoke({
    kind: input.resourceKind,
    title: input.title,
    url: input.url,
    contextLine: input.contextHint ? `Context: ${input.contextHint}` : "",
    content: cleanContent || "(empty)",
  });

  // Sanity-check that jsonLd parses if present.
  if (result.applicable && result.jsonLd) {
    try {
      const parsed = JSON.parse(result.jsonLd);
      if (typeof parsed !== "object" || parsed === null) {
        return { ...result, applicable: false, schemaType: null, jsonLd: null };
      }
    } catch {
      return { ...result, applicable: false, schemaType: null, jsonLd: null };
    }
  }

  return result;
}
