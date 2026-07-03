import "server-only";

// ─────────────────────────────────────────────────────────────────────
// SiteAdapter — the platform-agnostic contract that decouples playbooks
// and the autonomous loop from Shopify.
//
// Every optimization target (a Shopify store, a crawled marketing site, an
// SDK-embedded Next.js app) is reached through one of these. Playbooks read
// `SiteResource`s and emit `Artifact`s; the loop applies them and — crucially
// for autonomy — snapshots before-state so any change can be reverted when a
// measurement shows it didn't help.
//
// Implementations:
//   - ShopifyAdapter   → Admin GraphQL/REST + theme Asset API      (this repo)
//   - GenericSiteAdapter → HTTP crawl + Pigeon-hosted machine layer (Phase 5)
//   - SdkAdapter       → artifacts served by @pigeon/sdk at runtime (Phase 5)
// ─────────────────────────────────────────────────────────────────────

export type SitePlatform = "shopify" | "generic" | "sdk";

export interface SiteProfile {
  platform: SitePlatform;
  name: string;
  url: string; // public root, e.g. https://acme.com
  primaryDomain: string; // acme.com
}

export type ResourceType =
  | "product"
  | "collection"
  | "page"
  | "article"
  | "route"; // generic HTML route (non-Shopify sites)

// A readable unit of site content, normalized across platforms.
export interface SiteResource {
  type: ResourceType;
  id: string; // platform id (Shopify gid, or the URL for generic sites)
  handle: string; // slug
  url: string; // canonical public URL
  title: string;
  bodyHtml?: string;
  bodyText?: string;
  meta?: { title?: string; description?: string };
  // Platform-specific extras a playbook may use (price, images, variants…).
  data?: Record<string, unknown>;
}

// ─── Write side ──────────────────────────────────────────────────────
//
// An Artifact is a platform-agnostic description of a change. The adapter
// translates each kind into the right platform operation:
//
//   kind                shopify                        generic/sdk
//   ─────────────────   ────────────────────────────   ───────────────────────
//   machine_document    Online Store page + theme      hosted file at path
//   structured_data     metafield / theme snippet      injected JSON-LD
//   meta_tags           product.seo / theme            injected <head> tags
//   robots              config/robots.txt.liquid       hosted robots.txt
//   redirect            urlRedirect                    edge redirect rule
//   raw_asset           theme Asset API                hosted file
//   resource_field      productUpdate / image alt      (n/a for static)

export type ArtifactKind =
  | "machine_document"
  | "structured_data"
  | "meta_tags"
  | "robots"
  | "redirect"
  | "raw_asset"
  | "resource_field";

export interface Artifact {
  kind: ArtifactKind;
  target: string; // path, resource id, or asset key — kind-dependent
  title: string;
  description?: string;
  payload: unknown; // shape depends on kind (see payloads.ts helpers)
}

// Opaque before-state captured before applying an artifact. Passed back to
// `revert()` to undo. Serialized into experiment.snapshotJson.
export interface ArtifactSnapshot {
  kind: ArtifactKind;
  target: string;
  existed: boolean; // was there prior state? (delete vs restore on revert)
  before: unknown; // prior payload, or null when it didn't exist
}

export interface PublicFetchResult {
  status: number;
  url: string;
  body: string; // rendered HTML/text as a public crawler would receive it
  contentType: string | null;
}

export interface SiteAdapter {
  readonly platform: SitePlatform;

  /** Basic identity of the site (name, domains). */
  profile(): Promise<SiteProfile>;

  /**
   * Enumerate readable resources, optionally filtered by type. Used by the
   * loop to know what URLs exist (for measurement) and by playbooks for content.
   */
  listResources(types?: ResourceType[]): Promise<SiteResource[]>;

  /** Fetch a single resource by type + id, or null if gone. */
  getResource(type: ResourceType, id: string): Promise<SiteResource | null>;

  /** Capture current state of what `artifact` would change, for later revert. */
  snapshot(artifact: Artifact): Promise<ArtifactSnapshot>;

  /** Materialize the artifact on the live site. */
  apply(artifact: Artifact): Promise<void>;

  /** Undo a previously-applied artifact using its snapshot. */
  revert(snapshot: ArtifactSnapshot): Promise<void>;

  /**
   * Fetch a public URL exactly as an AI crawler / search bot would — no auth,
   * following the machine/alternate view where relevant. The measurement layer
   * uses this to verify what the site actually exposes.
   */
  fetchPublic(path: string): Promise<PublicFetchResult>;
}
