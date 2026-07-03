import "server-only";
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/lib/db";
import { siteArtifact } from "@/lib/db/schema";
import type {
  Artifact,
  ArtifactSnapshot,
  PublicFetchResult,
  ResourceType,
  SiteAdapter,
  SiteProfile,
  SiteResource,
} from "./adapter";
import { crawlSite } from "./crawl";

// ─────────────────────────────────────────────────────────────────────
// GenericSiteAdapter — for any non-Shopify site (marketing sites, custom
// landing pages, startups). Reads by crawling; writes to the `site_artifact`
// store because we don't own the site. The @autoaeo/sdk (runtime) and CLI
// (build time) fetch those artifacts and inject them into the real site.
//
// apply/snapshot/revert operate on the store, so the loop's keep/rollback
// safety harness works identically to Shopify — a "reverted" change simply
// means the artifact stops being served.
// ─────────────────────────────────────────────────────────────────────

export class GenericSiteAdapter implements SiteAdapter {
  readonly platform = "generic" as const;
  private _resources: SiteResource[] | null = null;

  constructor(
    private readonly opts: {
      siteId: string;
      name: string;
      url: string; // origin, e.g. https://acme.com
      primaryDomain: string;
    },
  ) {}

  async profile(): Promise<SiteProfile> {
    return {
      platform: "generic",
      name: this.opts.name,
      url: this.opts.url,
      primaryDomain: this.opts.primaryDomain,
    };
  }

  async listResources(types?: ResourceType[]): Promise<SiteResource[]> {
    if (!this._resources) this._resources = await crawlSite(this.opts.url);
    if (!types) return this._resources;
    return this._resources.filter((r) => types.includes(r.type));
  }

  async getResource(_type: ResourceType, id: string): Promise<SiteResource | null> {
    const all = await this.listResources();
    return all.find((r) => r.id === id || r.handle === id || r.url === id) ?? null;
  }

  // ─── Write side (artifact store) ───────────────────────────────────

  async snapshot(artifact: Artifact): Promise<ArtifactSnapshot> {
    const [row] = await db
      .select({ payloadJson: siteArtifact.payloadJson })
      .from(siteArtifact)
      .where(
        and(
          eq(siteArtifact.siteId, this.opts.siteId),
          eq(siteArtifact.kind, artifact.kind),
          eq(siteArtifact.target, artifact.target),
          eq(siteArtifact.active, true),
        ),
      )
      .limit(1);
    return {
      kind: artifact.kind,
      target: artifact.target,
      existed: !!row,
      before: row ? JSON.parse(row.payloadJson) : null,
    };
  }

  async apply(artifact: Artifact): Promise<void> {
    await this.upsert(artifact.kind, artifact.target, artifact.payload);
  }

  async revert(snapshot: ArtifactSnapshot): Promise<void> {
    if (snapshot.existed) {
      await this.upsert(snapshot.kind, snapshot.target, snapshot.before);
    } else {
      await db
        .delete(siteArtifact)
        .where(
          and(
            eq(siteArtifact.siteId, this.opts.siteId),
            eq(siteArtifact.kind, snapshot.kind),
            eq(siteArtifact.target, snapshot.target),
          ),
        );
    }
  }

  private async upsert(
    kind: string,
    target: string,
    payload: unknown,
  ): Promise<void> {
    await db
      .delete(siteArtifact)
      .where(
        and(
          eq(siteArtifact.siteId, this.opts.siteId),
          eq(siteArtifact.kind, kind),
          eq(siteArtifact.target, target),
        ),
      );
    await db.insert(siteArtifact).values({
      id: nanoid(),
      siteId: this.opts.siteId,
      kind,
      target,
      payloadJson: JSON.stringify(payload),
      active: true,
    });
  }

  async fetchPublic(path: string): Promise<PublicFetchResult> {
    const url = path.startsWith("http")
      ? path
      : `${this.opts.url}${path.startsWith("/") ? path : `/${path}`}`;
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "AutoAEO-Bot/1.0 (+https://autoaeo.com/bot)" },
        redirect: "follow",
      });
      return {
        status: res.status,
        url,
        body: await res.text(),
        contentType: res.headers.get("content-type"),
      };
    } catch (err) {
      return {
        status: 0,
        url,
        body: err instanceof Error ? err.message : String(err),
        contentType: null,
      };
    }
  }
}
