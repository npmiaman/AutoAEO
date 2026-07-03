import "server-only";
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/lib/db";
import { shop as shopTable, site as siteTable } from "@/lib/db/schema";
import { createShopifyClient } from "@/lib/shopify/client";
import { ShopifyAdapter } from "@/lib/agent/site/shopify-adapter";
import { fetchSiteProfile } from "@/lib/agent/site/crawl";
import { DEFAULT_SITE_CONFIG } from "@/lib/agent/site/config";

// ─────────────────────────────────────────────────────────────────────
// Site provisioning. A `site` is the loop's unit of work. For Shopify we
// derive one from a connected `shop`: fetch the real storefront domain via
// the adapter, then upsert a site row. Called after OAuth install (and safe
// to call repeatedly — it's idempotent per shop).
// ─────────────────────────────────────────────────────────────────────

export async function ensureSiteForShop(shopId: string): Promise<string> {
  const existing = await db
    .select({ id: siteTable.id })
    .from(siteTable)
    .where(
      and(eq(siteTable.platform, "shopify"), eq(siteTable.shopId, shopId)),
    )
    .limit(1);
  if (existing[0]) return existing[0].id;

  const [shopRow] = await db
    .select()
    .from(shopTable)
    .where(eq(shopTable.id, shopId))
    .limit(1);
  if (!shopRow) throw new Error(`Shop not found: ${shopId}`);

  const adapter = new ShopifyAdapter(
    createShopifyClient({
      shopDomain: shopRow.shopDomain,
      accessTokenEnc: shopRow.accessTokenEnc,
    }),
  );
  const profile = await adapter.profile();

  const id = nanoid();
  await db.insert(siteTable).values({
    id,
    userId: shopRow.userId,
    platform: "shopify",
    name: profile.name || shopRow.name || shopRow.shopDomain,
    url: profile.url,
    primaryDomain: profile.primaryDomain,
    shopId: shopRow.id,
    configJson: JSON.stringify(DEFAULT_SITE_CONFIG),
  });
  return id;
}

/**
 * Provision a generic (non-Shopify) site from a URL. Returns the site id and
 * the API key the @autoaeo/sdk / CLI will authenticate with. Idempotent per
 * (user, domain).
 */
export async function provisionGenericSite(args: {
  userId: string;
  url: string;
}): Promise<{ siteId: string; apiKey: string }> {
  const profile = await fetchSiteProfile(args.url);

  const existing = await db
    .select({ id: siteTable.id, apiKey: siteTable.apiKey })
    .from(siteTable)
    .where(
      and(
        eq(siteTable.userId, args.userId),
        eq(siteTable.primaryDomain, profile.primaryDomain),
      ),
    )
    .limit(1);
  if (existing[0]?.apiKey) {
    return { siteId: existing[0].id, apiKey: existing[0].apiKey };
  }

  const id = nanoid();
  const apiKey = `aeo_${nanoid(32)}`;
  await db.insert(siteTable).values({
    id,
    userId: args.userId,
    platform: "generic",
    name: profile.name,
    url: profile.url,
    primaryDomain: profile.primaryDomain,
    apiKey,
    configJson: JSON.stringify(DEFAULT_SITE_CONFIG),
  });
  return { siteId: id, apiKey };
}

/** All sites whose loop is due to run (not paused). */
export async function activeSites(): Promise<
  Array<{ id: string; name: string; primaryDomain: string }>
> {
  const rows = await db
    .select({
      id: siteTable.id,
      name: siteTable.name,
      primaryDomain: siteTable.primaryDomain,
      configJson: siteTable.configJson,
    })
    .from(siteTable);
  return rows
    .filter((r) => {
      try {
        return r.configJson ? !JSON.parse(r.configJson).paused : true;
      } catch {
        return true;
      }
    })
    .map(({ id, name, primaryDomain }) => ({ id, name, primaryDomain }));
}
