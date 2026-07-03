"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { provisionGenericSite } from "@/lib/agent/loop/provision";

export async function addWebsite(formData: FormData): Promise<void> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/signin?next=/dashboard");

  const raw = String(formData.get("url") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  if (!raw) redirect("/dashboard");

  const url = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;

  let siteId: string;
  try {
    const res = await provisionGenericSite({
      userId: session.user.id,
      url,
      description,
    });
    siteId = res.siteId;
  } catch {
    redirect("/dashboard?error=could-not-reach-site");
  }
  redirect(`/sites/${siteId}`);
}
