import "server-only";
import type { ShopifyClient } from "./client";

// ─────────────────────────────────────────────────────────────────────
// Thin write-side wrappers around Shopify's Asset and Pages REST APIs.
// Used by the applier to materialize approved proposals on the live store.
// ─────────────────────────────────────────────────────────────────────

function numericThemeId(themeGid: string): string {
  return themeGid.split("/").pop() ?? themeGid;
}

/**
 * Upsert a theme asset (any file: layouts, sections, snippets, templates,
 * config/robots.txt.liquid, etc.).
 */
export async function putThemeAsset(
  client: ShopifyClient,
  themeId: string,
  key: string,
  value: string,
): Promise<void> {
  const id = numericThemeId(themeId);
  const res = await client.rest(`/themes/${id}/assets.json`, {
    method: "PUT",
    body: JSON.stringify({ asset: { key, value } }),
  });
  if (!res.ok) {
    throw new Error(
      `Asset PUT ${key} on theme ${id} failed: ${res.status} ${await res.text()}`,
    );
  }
}

/**
 * Delete a theme asset. Used by rollback when the asset didn't exist before.
 * Tolerates 404 (already gone).
 */
export async function deleteThemeAsset(
  client: ShopifyClient,
  themeId: string,
  key: string,
): Promise<void> {
  const id = numericThemeId(themeId);
  const res = await client.rest(`/themes/${id}/assets.json`, {
    method: "DELETE",
    query: { "asset[key]": key },
  });
  if (!res.ok && res.status !== 404) {
    throw new Error(
      `Asset DELETE ${key} on theme ${id} failed: ${res.status} ${await res.text()}`,
    );
  }
}

// ─── Online Store Pages ──────────────────────────────────────────────

export interface NewPagePayload {
  title: string;
  handle: string;
  body_html: string;
  published?: boolean;
}

export interface CreatedPage {
  id: number;
  handle: string;
  title: string;
}

export async function createPage(
  client: ShopifyClient,
  payload: NewPagePayload,
): Promise<CreatedPage> {
  const res = await client.rest("/pages.json", {
    method: "POST",
    body: JSON.stringify({ page: payload }),
  });
  if (!res.ok) {
    throw new Error(
      `Page create '${payload.handle}' failed: ${res.status} ${await res.text()}`,
    );
  }
  const json = (await res.json()) as { page: CreatedPage };
  return json.page;
}

export async function updatePageById(
  client: ShopifyClient,
  pageId: number,
  payload: Partial<NewPagePayload>,
): Promise<void> {
  const res = await client.rest(`/pages/${pageId}.json`, {
    method: "PUT",
    body: JSON.stringify({ page: { id: pageId, ...payload } }),
  });
  if (!res.ok) {
    throw new Error(
      `Page update ${pageId} failed: ${res.status} ${await res.text()}`,
    );
  }
}

export async function deletePageById(
  client: ShopifyClient,
  pageId: number,
): Promise<void> {
  const res = await client.rest(`/pages/${pageId}.json`, { method: "DELETE" });
  if (!res.ok && res.status !== 404) {
    throw new Error(
      `Page delete ${pageId} failed: ${res.status} ${await res.text()}`,
    );
  }
}

/**
 * Find a page by handle. Returns null if not found.
 */
export async function findPageByHandle(
  client: ShopifyClient,
  handle: string,
): Promise<CreatedPage | null> {
  const res = await client.rest("/pages.json", {
    method: "GET",
    query: { handle, limit: 1 },
  });
  if (!res.ok) {
    throw new Error(`Page find '${handle}' failed: ${res.status}`);
  }
  const json = (await res.json()) as { pages: CreatedPage[] };
  return json.pages[0] ?? null;
}
