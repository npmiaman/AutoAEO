import { NextResponse } from "next/server";
import { serveArtifactsByApiKey } from "@/lib/agent/site/serve";

// ─────────────────────────────────────────────────────────────────────
// Artifact delivery for the @pigeon/sdk + CLI. Authenticated by the site's
// API key (Authorization: Bearer <key> or ?key=). Returns the aggregated
// artifacts the SDK injects (meta, JSON-LD) and serves (llms.txt).
//
// CORS is permissive because the CLI and edge middleware may call from
// anywhere; the API key scopes access to a single site.
// ─────────────────────────────────────────────────────────────────────

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
};

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const apiKey = bearer || url.searchParams.get("key") || "";
  if (!apiKey) {
    return NextResponse.json(
      { error: "Missing API key" },
      { status: 401, headers: CORS },
    );
  }

  const served = await serveArtifactsByApiKey(apiKey);
  if (!served) {
    return NextResponse.json(
      { error: "Invalid API key" },
      { status: 403, headers: CORS },
    );
  }

  return NextResponse.json(served, {
    headers: {
      ...CORS,
      // Cache at the edge; artifacts change at most daily.
      "Cache-Control": "public, s-maxage=300, stale-while-revalidate=3600",
    },
  });
}
