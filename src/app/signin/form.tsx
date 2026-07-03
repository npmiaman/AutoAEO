"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import PixelPigeon from "@/components/PixelPigeon";
import { authClient } from "@/lib/auth-client";

export function SignInForm() {
  const router = useRouter();
  const next = useSearchParams().get("next") ?? "/dashboard";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const { error } = await authClient.signIn.email({
      email,
      password,
      callbackURL: next,
    });
    setLoading(false);
    if (error) {
      toast.error(error.message ?? "Sign in failed");
      return;
    }
    router.push(next);
    router.refresh();
  }

  return (
    <main className="flex flex-1 flex-col px-6 py-8">
      <Link
        href="/"
        className="inline-flex items-center gap-3 self-start hover:opacity-80"
      >
        <PixelPigeon size={44} />
        <span className="text-xl font-semibold tracking-tight">
          <span className="text-muted-foreground">[</span>P
          <span className="text-muted-foreground">]</span>igeon
        </span>
      </Link>

      <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center pb-16">
        <div className="mb-8 text-center">
          <h1 className="font-heading text-4xl tracking-tight">Welcome back</h1>
          <p className="mt-2 text-muted-foreground">
            Sign in to your Pigeon account.
          </p>
        </div>

        <Card>
          <CardContent className="pt-6">
            <form onSubmit={onSubmit} className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="h-11 rounded-xl"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="h-11 rounded-xl"
                />
              </div>
              <Button
                type="submit"
                className="h-11 w-full rounded-xl"
                disabled={loading}
              >
                {loading ? "Signing in…" : "Sign in"}
              </Button>
            </form>
          </CardContent>
        </Card>

        <p className="mt-6 text-center text-sm text-muted-foreground">
          New here?{" "}
          <Link href="/signup" className="font-medium text-foreground hover:underline">
            Create an account
          </Link>
        </p>
      </div>
    </main>
  );
}
