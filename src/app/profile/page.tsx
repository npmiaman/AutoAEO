import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { userWorkspaces } from "@/lib/agent/loop/provision";
import { Card, CardContent } from "@/components/ui/card";

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="truncate text-sm font-medium">{value}</span>
    </div>
  );
}

export default async function ProfilePage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/signin?next=/profile");

  const workspaces = await userWorkspaces(session.user.id);

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div>
        <h1 className="font-heading text-3xl tracking-tight">Profile</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Your account and workspaces.
        </p>
      </div>

      <Card>
        <CardContent className="divide-y py-2">
          <Field label="Name" value={session.user.name} />
          <Field label="Email" value={session.user.email} />
          <Field label="Workspaces" value={String(workspaces.length)} />
        </CardContent>
      </Card>
    </div>
  );
}
