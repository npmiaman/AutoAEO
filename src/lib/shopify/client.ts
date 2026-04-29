import { decrypt } from "@/lib/crypto";

const API_VERSION = "2025-01";

export interface ShopifyClient {
  shopDomain: string;
  graphql<T = unknown>(
    query: string,
    variables?: Record<string, unknown>,
  ): Promise<T>;
  rest(
    path: string,
    init?: RequestInit & { query?: Record<string, string | number> },
  ): Promise<Response>;
}

export function createShopifyClient(args: {
  shopDomain: string;
  accessTokenEnc: string;
}): ShopifyClient {
  const token = decrypt(args.accessTokenEnc);
  const base = `https://${args.shopDomain}/admin/api/${API_VERSION}`;

  return {
    shopDomain: args.shopDomain,

    async graphql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
      const res = await fetch(`${base}/graphql.json`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": token,
        },
        body: JSON.stringify({ query, variables }),
      });
      if (!res.ok) {
        throw new Error(`Shopify GraphQL ${res.status}: ${await res.text()}`);
      }
      const json = (await res.json()) as { data?: T; errors?: unknown };
      if (json.errors) {
        throw new Error(
          `Shopify GraphQL errors: ${JSON.stringify(json.errors)}`,
        );
      }
      return json.data as T;
    },

    async rest(path, init) {
      const url = new URL(`${base}${path.startsWith("/") ? path : `/${path}`}`);
      if (init?.query) {
        for (const [k, v] of Object.entries(init.query)) {
          url.searchParams.set(k, String(v));
        }
      }
      const res = await fetch(url.toString(), {
        ...init,
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": token,
          ...(init?.headers ?? {}),
        },
      });
      return res;
    },
  };
}
