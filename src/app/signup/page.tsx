"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import PixelPigeon from "@/components/PixelPigeon";
import { authClient } from "@/lib/auth-client";

export default function SignUpPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const { error } = await authClient.signUp.email({
      email,
      password,
      name,
      callbackURL: "/dashboard",
    });
    setLoading(false);
    if (error) {
      toast.error(error.message ?? "Sign up failed");
      return;
    }
    router.push("/dashboard");
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
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
          Create an account
        </h1>

        <form onSubmit={onSubmit} className="mt-9 space-y-3.5">
          <div>
            <Label htmlFor="name" className="sr-only">
              Name
            </Label>
            <Input
              id="name"
              placeholder="Name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="h-13 rounded-2xl border-transparent bg-muted/60 px-4 text-base shadow-none placeholder:text-muted-foreground/70 focus-visible:bg-background"
            />
          </div>
          <div>
            <Label htmlFor="email" className="sr-only">
              Email
            </Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              placeholder="Email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-13 rounded-2xl border-transparent bg-muted/60 px-4 text-base shadow-none placeholder:text-muted-foreground/70 focus-visible:bg-background"
            />
          </div>
          <div>
            <Label htmlFor="password" className="sr-only">
              Password
            </Label>
            <Input
              id="password"
              type="password"
              autoComplete="new-password"
              placeholder="Password (at least 8 characters)"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-13 rounded-2xl border-transparent bg-muted/60 px-4 text-base shadow-none placeholder:text-muted-foreground/70 focus-visible:bg-background"
            />
          </div>

          <p className="pt-1 text-xs leading-relaxed text-muted-foreground">
            By signing up you agree to our{" "}
            <a href="#" className="font-medium text-foreground underline underline-offset-2">
              Terms
            </a>{" "}
            and{" "}
            <a href="#" className="font-medium text-foreground underline underline-offset-2">
              Privacy Policy
            </a>
            .
          </p>

          <Button
            type="submit"
            className="h-13 w-full rounded-full text-base font-semibold"
            disabled={loading}
          >
            {loading ? "Creating account…" : "Sign up"}
          </Button>
        </form>

        <p className="mt-6 text-center text-sm text-muted-foreground">
          Already have an account?{" "}
          <Link href="/signin" className="font-semibold text-foreground hover:underline">
            Log in
          </Link>
        </p>
      </div>
    </main>
  );
}
