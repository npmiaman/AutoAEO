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

// ─── Products ───────────────────────────────────────────────────────

/**
 * Update a product's title, descriptionHtml, or seo fields via GraphQL.
 * `productId` should be the GraphQL global ID (gid://shopify/Product/...).
 */
export async function updateProduct(
  client: ShopifyClient,
  productId: string,
  fields: {
    title?: string;
    descriptionHtml?: string;
    seoTitle?: string;
    seoDescription?: string;
  },
): Promise<void> {
  const input: Record<string, unknown> = { id: productId };
  if (fields.title !== undefined) input.title = fields.title;
  if (fields.descriptionHtml !== undefined)
    input.descriptionHtml = fields.descriptionHtml;
  if (fields.seoTitle !== undefined || fields.seoDescription !== undefined) {
    input.seo = {
      title: fields.seoTitle,
      description: fields.seoDescription,
    };
  }

  const data = await client.graphql<{
    productUpdate: { userErrors: Array<{ field: string[]; message: string }> };
  }>(
    /* GraphQL */ `
      mutation Pigeon_UpdateProduct($input: ProductInput!) {
        productUpdate(input: $input) {
          userErrors { field message }
        }
      }
    `,
    { input },
  );
  const errs = data.productUpdate.userErrors;
  if (errs.length > 0) {
    throw new Error(
      `Product update failed: ${errs.map((e) => `${e.field?.join(".")}: ${e.message}`).join("; ")}`,
    );
  }
}

/**
 * Update a product image's alt text. Uses the productImageUpdate mutation.
 */
export async function updateImageAltText(
  client: ShopifyClient,
  productId: string,
  imageId: string,
  altText: string,
): Promise<void> {
  // Strip the 'gid://shopify/...' prefix if present — REST endpoint expects numeric IDs.
  const numericProductId = productId.split("/").pop();
  const numericImageId = imageId.split("/").pop();
  const res = await client.rest(
    `/products/${numericProductId}/images/${numericImageId}.json`,
    {
      method: "PUT",
      body: JSON.stringify({
        image: { id: Number(numericImageId), alt: altText },
      }),
    },
  );
  if (!res.ok) {
    throw new Error(
      `Image alt update failed (product ${numericProductId}, image ${numericImageId}): ${res.status} ${await res.text()}`,
    );
  }
}

// ─── Metafields ─────────────────────────────────────────────────────

export interface MetafieldInput {
  ownerId: string; // GraphQL global ID of the owner (Page, Product, Shop, etc.)
  namespace: string;
  key: string;
  type: string; // e.g. "json", "single_line_text_field", "multi_line_text_field"
  value: string;
}

/**
 * Set a metafield on any resource. Used by FAQ Generator (pigeon.faq json
 * on Page) and for misc structured data we want bound to specific entities.
 */
export async function setMetafield(
  client: ShopifyClient,
  input: MetafieldInput,
): Promise<void> {
  const data = await client.graphql<{
    metafieldsSet: {
      userErrors: Array<{ field: string[]; message: string }>;
    };
  }>(
    /* GraphQL */ `
      mutation Pigeon_SetMetafield($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          userErrors { field message }
        }
      }
    `,
    {
      metafields: [
        {
          ownerId: input.ownerId,
          namespace: input.namespace,
          key: input.key,
          type: input.type,
          value: input.value,
        },
      ],
    },
  );
  const errs = data.metafieldsSet.userErrors;
  if (errs.length > 0) {
    throw new Error(
      `Metafield set failed: ${errs.map((e) => `${e.field?.join(".")}: ${e.message}`).join("; ")}`,
    );
  }
}

// ─── URL Redirects ──────────────────────────────────────────────────

export async function createUrlRedirect(
  client: ShopifyClient,
  fromPath: string,
  toPath: string,
): Promise<{ id: number }> {
  const res = await client.rest("/redirects.json", {
    method: "POST",
    body: JSON.stringify({
      redirect: { path: fromPath, target: toPath },
    }),
  });
  if (!res.ok) {
    throw new Error(
      `Redirect create '${fromPath}' → '${toPath}' failed: ${res.status} ${await res.text()}`,
    );
  }
  const json = (await res.json()) as { redirect: { id: number } };
  return json.redirect;
}

export async function deleteUrlRedirect(
  client: ShopifyClient,
  redirectId: number,
): Promise<void> {
  const res = await client.rest(`/redirects/${redirectId}.json`, {
    method: "DELETE",
  });
  if (!res.ok && res.status !== 404) {
    throw new Error(`Redirect delete ${redirectId} failed: ${res.status}`);
  }
}
