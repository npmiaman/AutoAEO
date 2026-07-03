import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { shop as shopTable, site as siteTable } from "@/lib/db/schema";
import { createShopifyClient } from "@/lib/shopify/client";
import { ShopifyAdapter } from "@/lib/agent/site/shopify-adapter";
import type { SiteAdapter } from "@/lib/agent/site/adapter";
import { parseSiteConfig, type SiteConfig } from "@/lib/agent/site/config";

// ─────────────────────────────────────────────────────────────────────
// Site resolution — turn a `site` row into a live SiteAdapter + config.
// The loop and the daily scan both start here. Platform-specific wiring
// (Shopify token → client → adapter) is isolated to this one place.
// ─────────────────────────────────────────────────────────────────────

export interface ResolvedSite {
  id: string;
  userId: string;
  platform: string;
  name: string;
  url: string;
  primaryDomain: string;
  business: string; // description used to generate searches
  config: SiteConfig;
  adapter: SiteAdapter;
}

export async function resolveSite(siteId: string): Promise<ResolvedSite> {
  const [s] = await db
    .select()
    .from(siteTable)
    .where(eq(siteTable.id, siteId))
    .limit(1);
  if (!s) throw new Error(`Site not found: ${siteId}`);

  const adapter = await buildAdapter(s);

  return {
    id: s.id,
    userId: s.userId,
    platform: s.platform,
    name: s.name,
    url: s.url,
    primaryDomain: s.primaryDomain,
    // A short natural-language description drives search generation. We reuse
    // the site name + domain; the loop can enrich this from goals.
    business: `${s.name} (${s.primaryDomain})`,
    config: parseSiteConfig(s.configJson),
    adapter,
  };
}

async function buildAdapter(s: typeof siteTable.$inferSelect): Promise<SiteAdapter> {
  if (s.platform === "shopify") {
    if (!s.shopId) throw new Error(`Shopify site ${s.id} has no linked shop.`);
    const [shopRow] = await db
      .select()
      .from(shopTable)
      .where(eq(shopTable.id, s.shopId))
      .limit(1);
    if (!shopRow) throw new Error(`Shop ${s.shopId} not found for site ${s.id}.`);
    return new ShopifyAdapter(
      createShopifyClient({
        shopDomain: shopRow.shopDomain,
        accessTokenEnc: shopRow.accessTokenEnc,
      }),
    );
  }
  // generic + sdk adapters arrive in Phase 5.
  throw new Error(`No adapter yet for platform: ${s.platform}`);
}
