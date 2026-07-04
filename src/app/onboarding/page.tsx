import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { userGenericSiteId } from "@/lib/agent/loop/provision";
import { OnboardingFlow } from "./onboarding-flow";

export default async function OnboardingPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/signin?next=/onboarding");

  // Already onboarded → straight to their site, form never re-shown.
  const siteId = await userGenericSiteId(session.user.id);
  if (siteId) redirect(`/sites/${siteId}`);

  return <OnboardingFlow defaultName={session.user.name} />;
}
