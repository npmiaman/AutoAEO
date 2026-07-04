import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { userGenericSiteId } from "@/lib/agent/loop/provision";

// One website per user, so there's no "your websites" list. /dashboard is just
// a router: to your site if you have one, otherwise into onboarding.
export default async function DashboardPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/signin?next=/dashboard");

  const siteId = await userGenericSiteId(session.user.id);
  redirect(siteId ? `/sites/${siteId}` : "/onboarding");
}
