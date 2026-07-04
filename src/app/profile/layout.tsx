import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { userWorkspaces } from "@/lib/agent/loop/provision";
import { DashboardShell } from "@/components/dashboard-shell";

export default async function ProfileLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/signin?next=/profile");

  const workspaces = await userWorkspaces(session.user.id);
  return (
    <DashboardShell user={session.user} workspaces={workspaces}>
      {children}
    </DashboardShell>
  );
}
