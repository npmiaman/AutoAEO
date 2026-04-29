import type { ShopifyClient } from "@/lib/shopify/client";

export interface ShopInfo {
  name: string;
  description: string | null;
  url: string;
  primaryDomain: string;
}

export interface ProductSummary {
  id: string;
  handle: string;
  title: string;
  description: string;
  vendor: string;
  productType: string;
  tags: string[];
  status: string;
  totalInventory: number | null;
  priceRangeFrom: string | null;
  priceRangeTo: string | null;
  currencyCode: string | null;
  featuredImage: string | null;
  onlineStoreUrl: string | null;
}

export interface CollectionSummary {
  id: string;
  handle: string;
  title: string;
  description: string;
  productsCount: number | null;
  onlineStoreUrl: string | null;
}

export interface PageSummary {
  id: string;
  handle: string;
  title: string;
  bodySummary: string;
  onlineStoreUrl: string | null;
}

export interface ArticleSummary {
  id: string;
  handle: string;
  title: string;
  blogHandle: string;
  summary: string;
  publishedAt: string | null;
}

export interface PublishedTheme {
  id: string;
  name: string;
  role: string;
}

// ─── Shop info ────────────────────────────────────────────────────────

export async function fetchShopInfo(client: ShopifyClient): Promise<ShopInfo> {
  const data = await client.graphql<{
    shop: {
      name: string;
      description: string | null;
      url: string;
      primaryDomain: { url: string; host: string };
    };
  }>(/* GraphQL */ `
    query AutoAEO_ShopInfo {
      shop {
        name
        description
        url
        primaryDomain { url host }
      }
    }
  `);
  return {
    name: data.shop.name,
    description: data.shop.description,
    url: data.shop.url,
    primaryDomain: data.shop.primaryDomain.host,
  };
}

// ─── Products ─────────────────────────────────────────────────────────

export async function fetchProducts(
  client: ShopifyClient,
  limit = 50,
): Promise<ProductSummary[]> {
  const data = await client.graphql<{
    products: {
      edges: Array<{
        node: {
          id: string;
          handle: string;
          title: string;
          description: string;
          vendor: string;
          productType: string;
          tags: string[];
          status: string;
          totalInventory: number | null;
          onlineStoreUrl: string | null;
          featuredImage: { url: string } | null;
          priceRangeV2: {
            minVariantPrice: { amount: string; currencyCode: string };
            maxVariantPrice: { amount: string; currencyCode: string };
          };
        };
      }>;
    };
  }>(
    /* GraphQL */ `
      query AutoAEO_Products($first: Int!) {
        products(first: $first, query: "status:active", sortKey: UPDATED_AT, reverse: true) {
          edges {
            node {
              id
              handle
              title
              description
              vendor
              productType
              tags
              status
              totalInventory
              onlineStoreUrl
              featuredImage { url }
              priceRangeV2 {
                minVariantPrice { amount currencyCode }
                maxVariantPrice { amount currencyCode }
              }
            }
          }
        }
      }
    `,
    { first: limit },
  );

  return data.products.edges.map(({ node: n }) => ({
    id: n.id,
    handle: n.handle,
    title: n.title,
    description: n.description ?? "",
    vendor: n.vendor,
    productType: n.productType,
    tags: n.tags,
    status: n.status,
    totalInventory: n.totalInventory,
    priceRangeFrom: n.priceRangeV2.minVariantPrice.amount ?? null,
    priceRangeTo: n.priceRangeV2.maxVariantPrice.amount ?? null,
    currencyCode: n.priceRangeV2.minVariantPrice.currencyCode ?? null,
    featuredImage: n.featuredImage?.url ?? null,
    onlineStoreUrl: n.onlineStoreUrl,
  }));
}

// ─── Collections ──────────────────────────────────────────────────────

export async function fetchCollections(
  client: ShopifyClient,
  limit = 30,
): Promise<CollectionSummary[]> {
  const data = await client.graphql<{
    collections: {
      edges: Array<{
        node: {
          id: string;
          handle: string;
          title: string;
          description: string;
          onlineStoreUrl: string | null;
          productsCount: { count: number } | null;
        };
      }>;
    };
  }>(
    /* GraphQL */ `
      query AutoAEO_Collections($first: Int!) {
        collections(first: $first, sortKey: UPDATED_AT, reverse: true) {
          edges {
            node {
              id
              handle
              title
              description
              onlineStoreUrl
              productsCount { count }
            }
          }
        }
      }
    `,
    { first: limit },
  );

  return data.collections.edges.map(({ node: n }) => ({
    id: n.id,
    handle: n.handle,
    title: n.title,
    description: n.description ?? "",
    productsCount: n.productsCount?.count ?? null,
    onlineStoreUrl: n.onlineStoreUrl,
  }));
}

// ─── Online Store Pages ───────────────────────────────────────────────

export async function fetchPages(
  client: ShopifyClient,
  limit = 50,
): Promise<PageSummary[]> {
  // Pages still live on REST; the GraphQL surface is uneven across versions.
  const res = await client.rest("/pages.json", {
    method: "GET",
    query: { limit, fields: "id,handle,title,body_summary,published_at" },
  });
  if (!res.ok) {
    throw new Error(`Pages fetch failed: ${res.status}`);
  }
  const json = (await res.json()) as {
    pages: Array<{
      id: number;
      handle: string;
      title: string;
      body_summary: string | null;
    }>;
  };
  return json.pages.map((p) => ({
    id: String(p.id),
    handle: p.handle,
    title: p.title,
    bodySummary: p.body_summary ?? "",
    onlineStoreUrl: null,
  }));
}

// ─── Blog articles ────────────────────────────────────────────────────

export async function fetchArticles(
  client: ShopifyClient,
  limit = 25,
): Promise<ArticleSummary[]> {
  const data = await client.graphql<{
    articles: {
      edges: Array<{
        node: {
          id: string;
          handle: string;
          title: string;
          summary: string | null;
          publishedAt: string | null;
          blog: { handle: string };
        };
      }>;
    };
  }>(
    /* GraphQL */ `
      query AutoAEO_Articles($first: Int!) {
        articles(first: $first, sortKey: PUBLISHED_AT, reverse: true) {
          edges {
            node {
              id
              handle
              title
              summary
              publishedAt
              blog { handle }
            }
          }
        }
      }
    `,
    { first: limit },
  );
  return data.articles.edges.map(({ node: n }) => ({
    id: n.id,
    handle: n.handle,
    title: n.title,
    blogHandle: n.blog.handle,
    summary: n.summary ?? "",
    publishedAt: n.publishedAt,
  }));
}

// ─── Published theme ──────────────────────────────────────────────────

export async function fetchPublishedTheme(
  client: ShopifyClient,
): Promise<PublishedTheme | null> {
  const data = await client.graphql<{
    themes: {
      edges: Array<{
        node: { id: string; name: string; role: string };
      }>;
    };
  }>(/* GraphQL */ `
    query AutoAEO_PublishedTheme {
      themes(first: 20) {
        edges { node { id name role } }
      }
    }
  `);
  const main =
    data.themes.edges.find((e) => e.node.role === "MAIN")?.node ??
    data.themes.edges[0]?.node;
  return main ?? null;
}

// ─── Read a single theme asset (for diff against existing) ────────────

export async function fetchThemeAssetText(
  client: ShopifyClient,
  themeId: string,
  key: string,
): Promise<string | null> {
  // themeId from GraphQL is gid://shopify/OnlineStoreTheme/12345 — strip to numeric for REST.
  const numericId = themeId.split("/").pop();
  const res = await client.rest(`/themes/${numericId}/assets.json`, {
    method: "GET",
    query: { "asset[key]": key },
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`Asset fetch ${key} failed: ${res.status}`);
  }
  const json = (await res.json()) as {
    asset?: { value?: string; attachment?: string };
  };
  return json.asset?.value ?? null;
}
