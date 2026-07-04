"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Check, ChevronsUpDown, Plus, User as UserIcon } from "lucide-react";
import PixelPigeon from "@/components/PixelPigeon";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { authClient } from "@/lib/auth-client";

interface User {
  name: string;
  email: string;
}

export interface Workspace {
  id: string;
  name: string;
  primaryDomain: string;
}

export function DashboardShell({
  user,
  workspaces = [],
  children,
}: {
  user: User;
  workspaces?: Workspace[];
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();

  const currentId = pathname.match(/^\/sites\/([^/]+)/)?.[1];
  const current = workspaces.find((w) => w.id === currentId) ?? workspaces[0];

  async function onSignOut() {
    await authClient.signOut();
    router.push("/");
    router.refresh();
  }

  return (
    <div className="flex min-h-screen flex-1 flex-col">
      <header className="border-b">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-3">
          <Link href="/dashboard" className="flex items-center gap-2">
            <PixelPigeon size={36} />
            <span className="font-heading text-3xl font-semibold leading-none tracking-tight">
              [P]
            </span>
          </Link>

          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button variant="ghost" size="sm" className="gap-2">
                  <span className="flex size-7 items-center justify-center rounded-md bg-muted text-xs font-medium">
                    {(current?.name ?? user.name)?.[0]?.toUpperCase() ?? "?"}
                  </span>
                  <span className="hidden max-w-[180px] truncate text-sm font-medium md:inline">
                    {current?.name ?? "Workspace"}
                  </span>
                  <ChevronsUpDown className="size-3.5 text-muted-foreground" />
                </Button>
              }
            />
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuLabel>
                <div className="text-sm font-medium">{user.name}</div>
                <div className="truncate text-xs text-muted-foreground">
                  {user.email}
                </div>
              </DropdownMenuLabel>

              <DropdownMenuSeparator />
              <DropdownMenuItem render={<Link href="/profile" />}>
                <UserIcon className="size-4 text-muted-foreground" />
                Profile
              </DropdownMenuItem>

              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Switch workspace
              </DropdownMenuLabel>
              {workspaces.map((w) => (
                <DropdownMenuItem
                  key={w.id}
                  render={<Link href={`/sites/${w.id}`} />}
                >
                  <Check
                    className={
                      "size-4 " +
                      (w.id === current?.id
                        ? "text-foreground"
                        : "text-transparent")
                    }
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">{w.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {w.primaryDomain}
                    </span>
                  </span>
                </DropdownMenuItem>
              ))}
              <DropdownMenuItem render={<Link href="/onboarding" />}>
                <Plus className="size-4 text-muted-foreground" />
                Create new workspace
              </DropdownMenuItem>

              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={onSignOut}>Sign out</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-10">{children}</main>
    </div>
  );
}
