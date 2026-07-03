import "server-only";
import type { Artifact } from "@/lib/agent/site/adapter";
import type {
  MachineDocumentPayload,
  RawAssetPayload,
  RedirectPayload,
  ResourceFieldPayload,
  RobotsPayload,
  StructuredDataPayload,
} from "@/lib/agent/site/payloads";
import { quickMeasure } from "@/lib/agent/measurement/harness";
import { findSimilarAttempts } from "@/lib/agent/memory";
import type { AgentTool, ToolContext } from "./types";

// Snapshot → apply → record. Shared by every mutating tool so the engine can
// always revert, regardless of what the agent chose to write.
async function applyArtifact(
  ctx: ToolContext,
  artifact: Artifact,
  intent: string,
): Promise<string> {
  const snapshot = await ctx.adapter.snapshot(artifact);
  await ctx.adapter.apply(artifact);
  ctx.mutations.push({ artifact, snapshot, intent });
  return `OK — applied ${artifact.kind} to "${artifact.target}". It is snapshotted and will be auto-reverted if visibility doesn't improve.`;
}

function ok<T>(v: T): string {
  return JSON.stringify(v);
}

export function buildTools(): AgentTool[] {
  return [
    // ── Inspect ──────────────────────────────────────────────────────
    {
      name: "list_resources",
      description:
        "List the site's pages/products/collections/articles (id, type, handle, url, title). Use to see what exists before deciding what to change.",
      parameters: {
        type: "object",
        properties: {
          types: {
            type: "array",
            items: {
              type: "string",
              enum: ["product", "collection", "page", "article", "route"],
            },
            description: "Optional filter; omit for everything.",
          },
        },
      },
      async execute(args, ctx) {
        const types = args.types as string[] | undefined;
        const list = await ctx.adapter.listResources(
          types as Parameters<typeof ctx.adapter.listResources>[0],
        );
        return ok(
          list.map((r) => ({
            type: r.type,
            id: r.id,
            handle: r.handle,
            url: r.url,
            title: r.title,
          })),
        );
      },
    },
    {
      name: "get_resource",
      description:
        "Fetch one resource's full content (body text/html, meta, data) by type + id or handle.",
      parameters: {
        type: "object",
        properties: {
          type: {
            type: "string",
            enum: ["product", "collection", "page", "article", "route"],
          },
          id: { type: "string" },
        },
        required: ["type", "id"],
      },
      async execute(args, ctx) {
        const r = await ctx.adapter.getResource(
          args.type as Parameters<typeof ctx.adapter.getResource>[0],
          String(args.id),
        );
        return r ? ok(r) : "Resource not found.";
      },
    },
    {
      name: "fetch_public_url",
      description:
        "Fetch a public URL/path exactly as an AI crawler would (no auth). Returns status + a snippet. Use to check robots.txt, current page HTML, etc.",
      parameters: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
      },
      async execute(args, ctx) {
        const res = await ctx.adapter.fetchPublic(String(args.path));
        return ok({
          status: res.status,
          contentType: res.contentType,
          bodySnippet: res.body.slice(0, 4000),
        });
      },
    },
    {
      name: "recall_memory",
      description:
        "Recall past optimization attempts on this site semantically similar to a described idea, with their verdicts. ALWAYS call before acting so you don't repeat a dead end or redo a win.",
      parameters: {
        type: "object",
        properties: {
          idea: {
            type: "string",
            description: "Describe the change you're considering.",
          },
        },
        required: ["idea"],
      },
      async execute(args, ctx) {
        const hits = await findSimilarAttempts(ctx.site.id, String(args.idea), 5);
        return hits.length
          ? ok(
              hits.map((h) => ({
                tried: h.text,
                verdict: h.verdict,
                similarity: Number((1 - h.distance).toFixed(2)),
              })),
            )
          : "No similar past attempts. This is new territory.";
      },
    },

    // ── Write (each snapshotted + reversible) ─────────────────────────
    {
      name: "set_robots",
      description:
        "Write the site's robots.txt (Shopify: config/robots.txt.liquid). Provide the full file content. Use to ensure AI crawlers (GPTBot, ClaudeBot, PerplexityBot, OAI-SearchBot, Google-Extended) are allowed.",
      parameters: {
        type: "object",
        properties: { value: { type: "string" } },
        required: ["value"],
      },
      async execute(args, ctx) {
        const payload: RobotsPayload = {
          key: "config/robots.txt.liquid",
          value: String(args.value),
        };
        return applyArtifact(
          ctx,
          { kind: "robots", target: payload.key, title: "robots.txt", payload },
          "robots",
        );
      },
    },
    {
      name: "upsert_document",
      description:
        "Create or replace a text/markdown document served at a path (e.g. an llms.txt, an answer-first FAQ page, a buyer guide). You write the full content.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "e.g. /pages/plumbing-faq" },
          handle: { type: "string", description: "slug, e.g. plumbing-faq" },
          title: { type: "string" },
          content: { type: "string" },
        },
        required: ["path", "handle", "title", "content"],
      },
      async execute(args, ctx) {
        const payload: MachineDocumentPayload = {
          path: String(args.path),
          handle: String(args.handle),
          title: String(args.title),
          content: String(args.content),
          published: true,
        };
        return applyArtifact(
          ctx,
          {
            kind: "machine_document",
            target: payload.path,
            title: payload.title,
            payload,
          },
          `document:${payload.handle}`,
        );
      },
    },
    {
      name: "write_asset",
      description:
        "Write a raw platform file verbatim (Shopify theme asset, e.g. a snippet or template). Advanced — use when a document/schema tool doesn't fit.",
      parameters: {
        type: "object",
        properties: {
          key: { type: "string", description: "e.g. snippets/autoaeo-faq.liquid" },
          value: { type: "string" },
        },
        required: ["key", "value"],
      },
      async execute(args, ctx) {
        const payload: RawAssetPayload = {
          key: String(args.key),
          value: String(args.value),
        };
        return applyArtifact(
          ctx,
          { kind: "raw_asset", target: payload.key, title: payload.key, payload },
          `asset:${payload.key}`,
        );
      },
    },
    {
      name: "set_structured_data",
      description:
        "Attach schema.org JSON-LD to a resource (FAQPage, HowTo, Organization, Article+Author, Product, etc.). You construct the full JSON-LD object. Only mark up facts present on the visible page.",
      parameters: {
        type: "object",
        properties: {
          resourceId: {
            type: "string",
            description: "gid/id of the resource the schema describes",
          },
          key: { type: "string", description: "e.g. faq, howto, organization" },
          json: {
            type: "object",
            description: "the JSON-LD object (with @context and @type)",
          },
        },
        required: ["resourceId", "key", "json"],
      },
      async execute(args, ctx) {
        const payload: StructuredDataPayload = {
          ownerId: String(args.resourceId),
          namespace: "autoaeo",
          key: String(args.key),
          json: args.json,
        };
        return applyArtifact(
          ctx,
          {
            kind: "structured_data",
            target: `${payload.ownerId}#${payload.key}`,
            title: `schema:${payload.key}`,
            payload,
          },
          `schema:${payload.key}:${payload.ownerId}`,
        );
      },
    },
    {
      name: "edit_resource",
      description:
        "Edit fields on a resource: title, description/body HTML, SEO title/description. Use for answer-first rewrites, better meta, etc.",
      parameters: {
        type: "object",
        properties: {
          resourceType: { type: "string", enum: ["product", "page"] },
          id: { type: "string" },
          title: { type: "string" },
          descriptionHtml: { type: "string" },
          seoTitle: { type: "string" },
          seoDescription: { type: "string" },
        },
        required: ["resourceType", "id"],
      },
      async execute(args, ctx) {
        const fields: ResourceFieldPayload["fields"] = {};
        if (args.title !== undefined) fields.title = String(args.title);
        if (args.descriptionHtml !== undefined)
          fields.descriptionHtml = String(args.descriptionHtml);
        if (args.seoTitle !== undefined) fields.seoTitle = String(args.seoTitle);
        if (args.seoDescription !== undefined)
          fields.seoDescription = String(args.seoDescription);
        const payload: ResourceFieldPayload = {
          resourceType: args.resourceType as "product" | "page",
          id: String(args.id),
          fields,
        };
        return applyArtifact(
          ctx,
          {
            kind: "resource_field",
            target: payload.id,
            title: `edit:${payload.resourceType}`,
            payload,
          },
          `edit:${payload.resourceType}:${payload.id}`,
        );
      },
    },
    {
      name: "create_redirect",
      description: "Create a URL redirect (e.g. to fix a 404 or consolidate a page).",
      parameters: {
        type: "object",
        properties: {
          from: { type: "string" },
          to: { type: "string" },
        },
        required: ["from", "to"],
      },
      async execute(args, ctx) {
        const payload: RedirectPayload = {
          from: String(args.from),
          to: String(args.to),
        };
        return applyArtifact(
          ctx,
          {
            kind: "redirect",
            target: payload.from,
            title: `redirect ${payload.from}`,
            payload,
          },
          `redirect:${payload.from}`,
        );
      },
    },

    // ── Measure ──────────────────────────────────────────────────────
    {
      name: "measure_searches",
      description:
        "Run specific searches against live AI engines and see whether this site appears and who ranks. Use to sanity-check an idea. NOTE: the engine also does an authoritative before/after measure around your whole turn.",
      parameters: {
        type: "object",
        properties: {
          searches: { type: "array", items: { type: "string" } },
        },
        required: ["searches"],
      },
      async execute(args, ctx) {
        const searches = (args.searches as string[]).slice(0, 12);
        const r = await quickMeasure({
          brandName: ctx.site.name,
          primaryDomain: ctx.site.primaryDomain,
          searches,
        });
        return ok({
          appearedOn: r.appearedQueries,
          missing: searches.filter((s) => !r.appearedQueries.includes(s)),
          detail: r.outcomes.map((o) => ({
            query: o.query,
            appeared: o.appeared,
            position: o.position,
            winners: o.rankedEntities.slice(0, 5),
          })),
        });
      },
    },

    // ── Finish ───────────────────────────────────────────────────────
    {
      name: "finish",
      description:
        "Call when you've made the changes you intend for this turn (or decided nothing is worth changing). Provide a short summary of what you did and why.",
      parameters: {
        type: "object",
        properties: { summary: { type: "string" } },
        required: ["summary"],
      },
      async execute(args, ctx) {
        ctx.finished.done = true;
        ctx.finished.summary = String(args.summary);
        return "Done.";
      },
    },
  ];
}
