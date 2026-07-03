import { NextRequest, NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { shop as shopTable } from "@/lib/db/schema";
import { encrypt } from "@/lib/crypto";
import {
  exchangeCodeForToken,
  isValidShopDomain,
  verifyShopifyHmac,
} from "@/lib/shopify/oauth";

// Shopify redirects here after the merchant approves the app.
// Query params: code, hmac, host, shop, state, timestamp
export async function GET(req: NextRequest) {
  const url = req.nextUrl;
  const params = url.searchParams;

  const shop = params.get("shop")?.toLowerCase().trim();
  const code = params.get("code");
  const state = params.get("state");

  if (!isValidShopDomain(shop) || !code || !state) {
    return NextResponse.json(
      { error: "Missing or invalid OAuth parameters" },
      { status: 400 },
    );
  }

  const clientId = process.env.SHOPIFY_API_KEY;
  const clientSecret = process.env.SHOPIFY_API_SECRET;
  if (!clientId || !clientSecret) {
    return NextResponse.json(
      { error: "Shopify app credentials are not configured." },
      { status: 500 },
    );
  }

  // 1. Verify HMAC signature on the callback URL.
  if (!verifyShopifyHmac(params, clientSecret)) {
    return NextResponse.json(
      { error: "HMAC verification failed" },
      { status: 400 },
    );
  }

  // 2. Verify state cookie matches and extract the AutoAEO user id.
  const cookie = req.cookies.get("shopify_oauth_state")?.value;
  if (!cookie) {
    return NextResponse.json(
      { error: "OAuth state cookie missing or expired. Please try again." },
      { status: 400 },
    );
  }
  const [cookieState, userId] = cookie.split(":");
  if (cookieState !== state || !userId) {
    return NextResponse.json({ error: "OAuth state mismatch" }, { status: 400 });
  }

  // 3. Exchange the authorization code for an access token.
  const tokenRes = await exchangeCodeForToken({
    shop,
    code,
    clientId,
    clientSecret,
  });

  // 4. Persist the shop with encrypted token.
  const accessTokenEnc = encrypt(tokenRes.access_token);

  const existing = await db
    .select()
    .from(shopTable)
    .where(eq(shopTable.shopDomain, shop))
    .limit(1);

  let shopId: string;
  if (existing[0]) {
    shopId = existing[0].id;
    await db
      .update(shopTable)
      .set({
        accessTokenEnc,
        scope: tokenRes.scope,
        userId,
      })
      .where(eq(shopTable.id, shopId));
  } else {
    shopId = nanoid();
    await db.insert(shopTable).values({
      id: shopId,
      userId,
      shopDomain: shop,
      accessTokenEnc,
      scope: tokenRes.scope,
    });
  }

  // 5. Provision a `site` for the autonomous loop (idempotent). Best-effort —
  //    a provisioning hiccup shouldn't block the merchant finishing install.
  try {
    const { ensureSiteForShop } = await import("@/lib/agent/loop/provision");
    await ensureSiteForShop(shopId);
  } catch (err) {
    console.error("Site provisioning failed (non-fatal):", err);
  }

  // 6. Clear the state cookie and redirect into the app.
  const dest = new URL(`/shops/${shopId}/audit`, req.url);
  const res = NextResponse.redirect(dest);
  res.cookies.delete("shopify_oauth_state");
  return res;
}
