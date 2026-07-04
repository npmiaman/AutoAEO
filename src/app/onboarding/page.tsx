import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { OnboardingFlow } from "./onboarding-flow";

// Shown to new users after signup, and as the "create new workspace" entry point
// for existing ones. Always renders the form; the /dashboard hub handles sending
// users who already have a workspace straight to it.
export default async function OnboardingPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/signin?next=/onboarding");

  return <OnboardingFlow defaultName={session.user.name} />;
}
