"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { createCliToken } from "@/lib/cli-token";

// Mint a one-time CLI token for the logged-in user, pasted into `pigeon login`.
export async function createCliTokenAction(): Promise<string> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/signin?next=/profile");
  return createCliToken(session.user.id, "web");
}
