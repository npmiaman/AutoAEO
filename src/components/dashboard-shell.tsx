"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
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

interface ShopOption {
  id: string;
  shopDomain: string;
}

export function DashboardShell({
  user,
  shops,
  children,
}: {
  user: User;
  shops: ShopOption[];
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();

  async function onSignOut() {
    await authClient.signOut();
    router.push("/");
    router.refresh();
  }

  return (
    <div className="flex min-h-screen flex-1 flex-col">
      <header className="border-b">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-3">
          <div className="flex items-center gap-6">
            <Link href="/dashboard" className="flex items-center gap-2">
              <span className="text-base" aria-hidden>🐦</span>
              <span className="text-sm font-semibold tracking-tight">
                Pigeon
              </span>
            </Link>
            <nav className="hidden items-center gap-1 md:flex">
              <NavLink href="/dashboard" active={pathname === "/dashboard"}>
                Stores
              </NavLink>
              <NavLink href="/connect" active={pathname === "/connect"}>
                Connect
              </NavLink>
            </nav>
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button variant="ghost" size="sm" className="gap-2">
                  <span className="hidden text-sm md:inline">{user.email}</span>
                  <span className="flex size-7 items-center justify-center rounded-full bg-muted text-xs font-medium">
                    {user.name?.[0]?.toUpperCase() ?? "?"}
                  </span>
                </Button>
              }
            />
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>
                <div className="text-sm font-medium">{user.name}</div>
                <div className="text-xs text-muted-foreground">{user.email}</div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              {shops.length > 0 && (
                <>
                  <DropdownMenuLabel className="text-xs uppercase tracking-wide text-muted-foreground">
                    Connected stores
                  </DropdownMenuLabel>
                  {shops.map((s) => (
                    <DropdownMenuItem
                      key={s.id}
                      render={<Link href={`/shops/${s.id}/audit`} />}
                    >
                      {s.shopDomain}
                    </DropdownMenuItem>
                  ))}
                  <DropdownMenuSeparator />
                </>
              )}
              <DropdownMenuItem render={<Link href="/connect" />}>
                Connect another store
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

function NavLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
        active
          ? "bg-muted font-medium text-foreground"
          : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
    </Link>
  );
}
