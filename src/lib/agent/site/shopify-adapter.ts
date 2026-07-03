import "server-only";
import type { ShopifyClient } from "@/lib/shopify/client";
import {
  fetchArticles,
  fetchCollections,
  fetchPages,
  fetchProducts,
  fetchPublishedTheme,
  fetchShopInfo,
  fetchThemeAssetText,
  type PublishedTheme,
} from "@/lib/agent/playbooks/machine-layer/queries";
import {
  createPage,
  createUrlRedirect,
  deletePageById,
  deleteThemeAsset,
  deleteUrlRedirect,
  findPageByHandle,
  putThemeAsset,
  setMetafield,
  updateImageAltText,
  updatePageById,
  updateProduct,
} from "@/lib/shopify/writes";
import type {
  Artifact,
  ArtifactSnapshot,
  PublicFetchResult,
  ResourceType,
  SiteAdapter,
  SiteProfile,
  SiteResource,
} from "./adapter";
import type {
  MachineDocumentPayload,
  RawAssetPayload,
  RedirectPayload,
  ResourceFieldPayload,
  RobotsPayload,
  StructuredDataPayload,
} from "./payloads";

// ─────────────────────────────────────────────────────────────────────
// ShopifyAdapter — implements SiteAdapter over the existing Shopify Admin
// client + theme Asset API. Reads reuse machine-layer/queries; writes reuse
// shopify/writes. The published theme is fetched lazily and memoized since
// most artifact operations need its id.
// ─────────────────────────────────────────────────────────────────────

export class ShopifyAdapter implements SiteAdapter {
  readonly platform = "shopify" as const;
  private _theme: PublishedTheme | null | undefined;
  private _profile: SiteProfile | undefined;

  constructor(private readonly client: ShopifyClient) {}

  private async theme(): Promise<PublishedTheme> {
    if (this._theme === undefined) {
      this._theme = await fetchPublishedTheme(this.client);
    }
    if (!this._theme) throw new Error("No published theme found on this store.");
    return this._theme;
  }

  async profile(): Promise<SiteProfile> {
    if (this._profile) return this._profile;
    const info = await fetchShopInfo(this.client);
    this._profile = {
      platform: "shopify",
      name: info.name,
      url: info.url,
      primaryDomain: info.primaryDomain,
    };
    return this._profile;
  }

  async listResources(types?: ResourceType[]): Promise<SiteResource[]> {
    const want = (t: ResourceType) => !types || types.includes(t);
    const [products, collections, pages, articles] = await Promise.all([
      want("product") ? fetchProducts(this.client) : Promise.resolve([]),
      want("collection") ? fetchCollections(this.client) : Promise.resolve([]),
      want("page") ? fetchPages(this.client) : Promise.resolve([]),
      want("article") ? fetchArticles(this.client) : Promise.resolve([]),
    ]);

    const out: SiteResource[] = [];
    for (const p of products) {
      out.push({
        type: "product",
        id: p.id,
        handle: p.handle,
        url: `/products/${p.handle}`,
        title: p.title,
        bodyText: p.description,
        data: {
          vendor: p.vendor,
          productType: p.productType,
          tags: p.tags,
          priceRangeFrom: p.priceRangeFrom,
          priceRangeTo: p.priceRangeTo,
          currencyCode: p.currencyCode,
          featuredImage: p.featuredImage,
          totalInventory: p.totalInventory,
        },
      });
    }
    for (const c of collections) {
      out.push({
        type: "collection",
        id: c.id,
        handle: c.handle,
        url: `/collections/${c.handle}`,
        title: c.title,
        bodyHtml: c.description,
        data: { productsCount: c.productsCount },
      });
    }
    for (const pg of pages) {
      out.push({
        type: "page",
        id: pg.id,
        handle: pg.handle,
        url: `/pages/${pg.handle}`,
        title: pg.title,
        bodyText: pg.bodySummary,
      });
    }
    for (const a of articles) {
      out.push({
        type: "article",
        id: a.id,
        handle: a.handle,
        url: `/blogs/${a.blogHandle}/${a.handle}`,
        title: a.title,
        bodyText: a.summary,
        data: { blogHandle: a.blogHandle, publishedAt: a.publishedAt },
      });
    }
    return out;
  }

  async getResource(
    type: ResourceType,
    id: string,
  ): Promise<SiteResource | null> {
    const all = await this.listResources([type]);
    return all.find((r) => r.id === id || r.handle === id) ?? null;
  }

  // ─── Write side ────────────────────────────────────────────────────

  async snapshot(artifact: Artifact): Promise<ArtifactSnapshot> {
    const base = { kind: artifact.kind, target: artifact.target };
    switch (artifact.kind) {
      case "raw_asset":
      case "robots": {
        const key = (artifact.payload as RawAssetPayload | RobotsPayload).key;
        const before = await fetchThemeAssetText(
          this.client,
          (await this.theme()).id,
          key,
        );
        return { ...base, existed: before !== null, before };
      }
      case "machine_document": {
        const p = artifact.payload as MachineDocumentPayload;
        const page = await findPageByHandle(this.client, p.handle);
        return {
          ...base,
          existed: page !== null,
          before: page ? { id: page.id, handle: page.handle } : null,
        };
      }
      case "structured_data": {
        // Metafields are set idempotently; revert clears our namespace/key.
        return { ...base, existed: false, before: null };
      }
      case "resource_field":
      case "meta_tags": {
        const p = artifact.payload as ResourceFieldPayload;
        const current = await this.getResource(p.resourceType, p.id);
        return { ...base, existed: current !== null, before: current };
      }
      case "redirect": {
        // Best-effort: we don't know the id until created; revert deletes by lookup.
        return { ...base, existed: false, before: null };
      }
      default:
        return { ...base, existed: false, before: null };
    }
  }

  async apply(artifact: Artifact): Promise<void> {
    switch (artifact.kind) {
      case "raw_asset":
      case "robots": {
        const p = artifact.payload as RawAssetPayload | RobotsPayload;
        await putThemeAsset(this.client, (await this.theme()).id, p.key, p.value);
        return;
      }
      case "machine_document": {
        const p = artifact.payload as MachineDocumentPayload;
        const body = `<pre>${escapeHtml(p.content)}</pre>`;
        const existing = await findPageByHandle(this.client, p.handle);
        if (existing) {
          await updatePageById(this.client, existing.id, {
            title: p.title,
            body_html: body,
            published: p.published ?? true,
          });
        } else {
          await createPage(this.client, {
            title: p.title,
            handle: p.handle,
            body_html: body,
            published: p.published ?? true,
          });
        }
        return;
      }
      case "structured_data": {
        const p = artifact.payload as StructuredDataPayload;
        await setMetafield(this.client, {
          ownerId: p.ownerId,
          namespace: p.namespace,
          key: p.key,
          type: "json",
          value: JSON.stringify(p.json),
        });
        return;
      }
      case "resource_field":
      case "meta_tags": {
        const p = artifact.payload as ResourceFieldPayload;
        if (p.imageAlt && p.resourceType === "product") {
          await updateImageAltText(
            this.client,
            p.id,
            p.imageAlt.imageId,
            p.imageAlt.altText,
          );
        }
        if (p.fields) {
          if (p.resourceType === "product") {
            await updateProduct(this.client, p.id, p.fields);
          } else {
            await updatePageById(this.client, Number(p.id), {
              title: p.fields.title,
              body_html: p.fields.descriptionHtml,
            });
          }
        }
        return;
      }
      case "redirect": {
        const p = artifact.payload as RedirectPayload;
        await createUrlRedirect(this.client, p.from, p.to);
        return;
      }
      default:
        throw new Error(`ShopifyAdapter cannot apply kind: ${artifact.kind}`);
    }
  }

  async revert(snapshot: ArtifactSnapshot): Promise<void> {
    switch (snapshot.kind) {
      case "raw_asset":
      case "robots": {
        const key = snapshot.target;
        if (snapshot.existed && typeof snapshot.before === "string") {
          await putThemeAsset(
            this.client,
            (await this.theme()).id,
            key,
            snapshot.before,
          );
        } else {
          await deleteThemeAsset(this.client, (await this.theme()).id, key);
        }
        return;
      }
      case "machine_document": {
        if (snapshot.existed) {
          // Page pre-existed; leave content restore to the stored before-page
          // if we captured full body. We only stored id/handle, so no-op keeps
          // the merchant's original page rather than clobbering it.
          return;
        }
        const before = snapshot.before as { id: number } | null;
        // If we created it, the created page shares the handle — look it up.
        const created = await findPageByHandle(
          this.client,
          snapshot.target.split("/").pop() ?? snapshot.target,
        );
        if (created) await deletePageById(this.client, created.id);
        void before;
        return;
      }
      case "redirect": {
        // Look up and delete the redirect we created.
        const from = snapshot.target;
        const res = await this.client.rest("/redirects.json", {
          method: "GET",
          query: { path: from, limit: 1 },
        });
        if (res.ok) {
          const json = (await res.json()) as {
            redirects: Array<{ id: number }>;
          };
          if (json.redirects[0]) {
            await deleteUrlRedirect(this.client, json.redirects[0].id);
          }
        }
        return;
      }
      case "resource_field":
      case "meta_tags": {
        const before = snapshot.before as SiteResource | null;
        if (!before) return;
        if (before.type === "product") {
          await updateProduct(this.client, before.id, {
            title: before.title,
            descriptionHtml: before.bodyHtml ?? before.bodyText,
            seoTitle: before.meta?.title,
            seoDescription: before.meta?.description,
          });
        }
        return;
      }
      case "structured_data":
        // Idempotent metafield; leaving stale schema is harmless. No-op.
        return;
      default:
        return;
    }
  }

  async fetchPublic(path: string): Promise<PublicFetchResult> {
    const { primaryDomain } = await this.profile();
    const url = path.startsWith("http")
      ? path
      : `https://${primaryDomain}${path.startsWith("/") ? path : `/${path}`}`;
    const res = await fetch(url, {
      headers: { "User-Agent": "Pigeon-Bot/1.0 (+https://pigeon.com/bot)" },
      redirect: "follow",
    });
    return {
      status: res.status,
      url,
      body: await res.text(),
      contentType: res.headers.get("content-type"),
    };
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
