"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import {
  provisionGenericSite,
  userGenericSiteId,
} from "@/lib/agent/loop/provision";
import { verifySiteReachable } from "@/lib/agent/site/crawl";
import { startScan } from "@/lib/agent/measurement/batch-scan";

export type OnboardingResult =
  | { ok: true; siteId: string }
  | { ok: false; error: string };

// Provision the user's ONE website and run its first (live) scan. Called from
// the onboarding loading screen. Idempotent: if the user already has a site we
// return it untouched — their existing data is never overwritten.
export async function completeOnboarding(input: {
  url: string;
  name: string;
  description: string;
}): Promise<OnboardingResult> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/signin");

  // One website per user — never clobber an existing one.
  const existing = await userGenericSiteId(session.user.id);
  if (existing) return { ok: true, siteId: existing };

  const raw = input.url.trim();
  if (!raw) return { ok: false, error: "Enter your website address." };
  const url = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    new URL(url);
  } catch {
    return { ok: false, error: "That doesn't look like a valid web address." };
  }

  // Verify it's a real, reachable website before we commit anything.
  if (!(await verifySiteReachable(url))) {
    return {
      ok: false,
      error: "We couldn't reach that website. Check the address and try again.",
    };
  }

  let siteId: string;
  try {
    const res = await provisionGenericSite({
      userId: session.user.id,
      url,
      name: input.name,
      description: input.description,
    });
    siteId = res.siteId;
  } catch {
    return {
      ok: false,
      error: "Something went wrong reading your site. Please try again.",
    };
  }

  // First scan runs live so the dashboard is populated when we land on it.
  try {
    await startScan(siteId);
  } catch {
    // Scan can be retried from the dashboard; still hand them their site.
  }

  return { ok: true, siteId };
}
