import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { auth } from "@/lib/auth";
import {
  buildInstallUrl,
  isValidShopDomain,
} from "@/lib/shopify/oauth";
import { SHOPIFY_SCOPE_STRING } from "@/lib/shopify/scopes";

// Initiates the Shopify OAuth flow. The user must be signed in to AutoAEO.
// Query: ?shop=mystore.myshopify.com
export async function GET(req: NextRequest) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) {
    const signInUrl = new URL("/signin", req.url);
    signInUrl.searchParams.set("next", req.nextUrl.pathname + req.nextUrl.search);
    return NextResponse.redirect(signInUrl);
  }

  const shop = req.nextUrl.searchParams.get("shop")?.toLowerCase().trim();
  if (!isValidShopDomain(shop)) {
    return NextResponse.json(
      { error: "Invalid shop domain. Expected format: mystore.myshopify.com" },
      { status: 400 },
    );
  }

  const clientId = process.env.SHOPIFY_API_KEY;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  if (!clientId) {
    return NextResponse.json(
      { error: "SHOPIFY_API_KEY is not configured." },
      { status: 500 },
    );
  }

  const state = randomBytes(24).toString("hex");
  const installUrl = buildInstallUrl({
    shop,
    clientId,
    scopes: SHOPIFY_SCOPE_STRING,
    redirectUri: `${appUrl}/api/shopify/callback`,
    state,
  });

  // Store state + user binding in an httpOnly cookie. Verified on callback.
  const res = NextResponse.redirect(installUrl);
  res.cookies.set("shopify_oauth_state", `${state}:${session.user.id}`, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 10, // 10 minutes
  });
  return res;
}
