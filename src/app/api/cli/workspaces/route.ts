import { NextResponse } from "next/server";
import { authCliToken } from "@/lib/cli-token";
import { userWorkspaces } from "@/lib/agent/loop/provision";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
};

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

// List the account's workspaces for `pigeon link`.
export async function GET(req: Request) {
  const userId = await authCliToken(req);
  if (!userId)
    return NextResponse.json(
      { error: "Invalid or missing CLI token" },
      { status: 401, headers: CORS },
    );

  const workspaces = await userWorkspaces(userId);
  return NextResponse.json({ workspaces }, { headers: CORS });
}
