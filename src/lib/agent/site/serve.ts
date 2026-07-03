import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { site as siteTable, siteArtifact } from "@/lib/db/schema";
import type {
  MachineDocumentPayload,
  ResourceFieldPayload,
  StructuredDataPayload,
} from "./payloads";

// ─────────────────────────────────────────────────────────────────────
// Serve — aggregate a site's active artifacts into the shape the @autoaeo/sdk
// and CLI consume. The SDK looks up the current request path in `byPath` to
// inject meta tags + JSON-LD, and serves `llmsTxt` at /llms.txt.
// ─────────────────────────────────────────────────────────────────────

export interface RouteArtifacts {
  title?: string;
  description?: string;
  jsonLd: unknown[]; // schema.org objects to inject as <script type=ld+json>
}

export interface ServedArtifacts {
  site: { name: string; primaryDomain: string };
  llmsTxt: string | null;
  documents: Array<{ path: string; title: string; content: string }>;
  byPath: Record<string, RouteArtifacts>;
  updatedAt: number;
}

function pathOf(idOrUrl: string): string {
  try {
    return new URL(idOrUrl).pathname;
  } catch {
    return idOrUrl.startsWith("/") ? idOrUrl : `/${idOrUrl}`;
  }
}

export async function serveArtifactsBySiteId(
  siteId: string,
): Promise<ServedArtifacts | null> {
  const [s] = await db
    .select()
    .from(siteTable)
    .where(eq(siteTable.id, siteId))
    .limit(1);
  if (!s) return null;
  return build(s.name, s.primaryDomain, siteId);
}

export async function serveArtifactsByApiKey(
  apiKey: string,
): Promise<ServedArtifacts | null> {
  const [s] = await db
    .select()
    .from(siteTable)
    .where(eq(siteTable.apiKey, apiKey))
    .limit(1);
  if (!s) return null;
  return build(s.name, s.primaryDomain, s.id);
}

async function build(
  name: string,
  primaryDomain: string,
  siteId: string,
): Promise<ServedArtifacts> {
  const rows = await db
    .select()
    .from(siteArtifact)
    .where(
      and(eq(siteArtifact.siteId, siteId), eq(siteArtifact.active, true)),
    );

  const byPath: Record<string, RouteArtifacts> = {};
  const documents: ServedArtifacts["documents"] = [];
  let llmsTxt: string | null = null;
  let updatedAt = 0;

  const ensure = (path: string): RouteArtifacts =>
    (byPath[path] ??= { jsonLd: [] });

  for (const row of rows) {
    updatedAt = Math.max(updatedAt, row.updatedAt?.getTime?.() ?? 0);
    const payload = JSON.parse(row.payloadJson);
    switch (row.kind) {
      case "machine_document": {
        const p = payload as MachineDocumentPayload;
        documents.push({ path: p.path, title: p.title, content: p.content });
        if (p.path.includes("llms.txt") || p.handle.includes("llms"))
          llmsTxt = p.content;
        break;
      }
      case "structured_data": {
        const p = payload as StructuredDataPayload;
        ensure(pathOf(p.ownerId)).jsonLd.push(p.json);
        break;
      }
      case "meta_tags":
      case "resource_field": {
        const p = payload as ResourceFieldPayload;
        const route = ensure(pathOf(p.id));
        if (p.fields?.seoTitle ?? p.fields?.title)
          route.title = p.fields.seoTitle ?? p.fields.title;
        if (p.fields?.seoDescription)
          route.description = p.fields.seoDescription;
        break;
      }
      default:
        break; // robots / raw_asset / redirect are platform-write concepts
    }
  }

  return {
    site: { name, primaryDomain },
    llmsTxt,
    documents,
    byPath,
    updatedAt,
  };
}
