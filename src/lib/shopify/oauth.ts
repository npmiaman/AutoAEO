import { createHmac, timingSafeEqual } from "node:crypto";

// Validates a Shopify shop domain. Allows *.myshopify.com only.
const SHOP_DOMAIN_RE = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i;

export function isValidShopDomain(shop: string | null | undefined): shop is string {
  return !!shop && SHOP_DOMAIN_RE.test(shop);
}

export function buildInstallUrl(opts: {
  shop: string;
  clientId: string;
  scopes: string;
  redirectUri: string;
  state: string;
}): string {
  const params = new URLSearchParams({
    client_id: opts.clientId,
    scope: opts.scopes,
    redirect_uri: opts.redirectUri,
    state: opts.state,
    "grant_options[]": "", // empty = offline access token (default, what we want)
  });
  return `https://${opts.shop}/admin/oauth/authorize?${params.toString()}`;
}

// Verify Shopify HMAC on the OAuth callback request.
// Shopify signs all query params except `hmac` and `signature`.
export function verifyShopifyHmac(
  searchParams: URLSearchParams,
  clientSecret: string,
): boolean {
  const provided = searchParams.get("hmac");
  if (!provided) return false;

  const params = new URLSearchParams(searchParams);
  params.delete("hmac");
  params.delete("signature");

  // Shopify's HMAC is computed over alphabetically-sorted key=value& joined params.
  const sorted = Array.from(params.entries()).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  const message = sorted.map(([k, v]) => `${k}=${v}`).join("&");

  const computed = createHmac("sha256", clientSecret)
    .update(message)
    .digest("hex");

  try {
    return timingSafeEqual(
      Buffer.from(computed, "hex"),
      Buffer.from(provided, "hex"),
    );
  } catch {
    return false;
  }
}

export interface ShopifyTokenResponse {
  access_token: string;
  scope: string;
}

export async function exchangeCodeForToken(opts: {
  shop: string;
  code: string;
  clientId: string;
  clientSecret: string;
}): Promise<ShopifyTokenResponse> {
  const res = await fetch(`https://${opts.shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      client_id: opts.clientId,
      client_secret: opts.clientSecret,
      code: opts.code,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Shopify token exchange failed: ${res.status} ${body}`);
  }
  return (await res.json()) as ShopifyTokenResponse;
}
