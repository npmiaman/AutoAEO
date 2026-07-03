// ─────────────────────────────────────────────────────────────────────
// Typed payload shapes for each Artifact.kind. Kept adapter-agnostic so a
// playbook builds one Artifact and any SiteAdapter knows how to apply it.
// ─────────────────────────────────────────────────────────────────────

// kind: "machine_document" — a full text document served at a public path
// (llms.txt, llms-full.txt, a machine-readable page). On Shopify this becomes
// an Online Store page; on generic/sdk sites, a hosted file.
export interface MachineDocumentPayload {
  path: string; // e.g. "/pages/llms.txt" or "/llms.txt"
  handle: string; // slug used by the platform (Shopify page handle)
  title: string;
  content: string; // raw text/markdown
  published?: boolean;
}

// kind: "raw_asset" — a platform file written verbatim (Shopify theme asset).
export interface RawAssetPayload {
  key: string; // e.g. "layout/machine.liquid"
  value: string;
}

// kind: "robots" — robots directives. On Shopify this is config/robots.txt.liquid.
export interface RobotsPayload {
  key: string; // "config/robots.txt.liquid" on Shopify
  value: string;
}

// kind: "structured_data" — JSON-LD bound to a resource (schema.org).
export interface StructuredDataPayload {
  ownerId: string; // resource gid the schema describes
  namespace: string; // e.g. "autoaeo"
  key: string; // e.g. "schema"
  json: unknown; // the JSON-LD object
}

// kind: "meta_tags" / "resource_field" — mutate fields on a resource.
export interface ResourceFieldPayload {
  resourceType: "product" | "page";
  id: string; // gid (product) or numeric id (page)
  fields?: {
    title?: string;
    descriptionHtml?: string;
    seoTitle?: string;
    seoDescription?: string;
  };
  // For product image alt-text edits.
  imageAlt?: { imageId: string; altText: string };
}

// kind: "redirect" — a URL redirect (e.g. fixing a 404).
export interface RedirectPayload {
  from: string;
  to: string;
}
