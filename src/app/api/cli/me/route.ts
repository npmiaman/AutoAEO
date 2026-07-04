import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { user as userTable } from "@/lib/db/schema";
import { authCliToken } from "@/lib/cli-token";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
};

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

// Validate a CLI token → the account it belongs to. Used by `pigeon login`.
export async function GET(req: Request) {
  const userId = await authCliToken(req);
  if (!userId)
    return NextResponse.json(
      { error: "Invalid or missing CLI token" },
      { status: 401, headers: CORS },
    );

  const [u] = await db
    .select({ name: userTable.name, email: userTable.email })
    .from(userTable)
    .where(eq(userTable.id, userId))
    .limit(1);
  return NextResponse.json({ user: u ?? null }, { headers: CORS });
}
