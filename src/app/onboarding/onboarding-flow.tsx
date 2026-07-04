"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import PixelPigeon from "@/components/PixelPigeon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { completeOnboarding } from "./actions";

const LOADING_MESSAGES = [
  "Setting everything up for you…",
  "Reaching your website…",
  "Reading through your pages…",
  "Mapping who ranks in AI search…",
  "Finding where you can win…",
  "Almost ready…",
];

function LoadingScreen() {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(
      () => setI((n) => (n + 1) % LOADING_MESSAGES.length),
      2600,
    );
    return () => clearInterval(t);
  }, []);
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-6 bg-background px-6 text-center">
      <PixelPigeon size={72} />
      <p
        key={i}
        className="animate-in fade-in font-heading text-xl tracking-tight text-foreground duration-500"
      >
        {LOADING_MESSAGES[i]}
      </p>
      <p className="text-sm text-muted-foreground">
        This takes a minute — hang tight while Pigeon analyses your site.
      </p>
    </div>
  );
}

const fieldBase =
  "rounded-xl border-transparent bg-muted/60 px-4 text-sm shadow-none placeholder:text-muted-foreground/70 focus-visible:bg-background";
const fieldClass = `h-11 ${fieldBase}`;
const textareaClass = `${fieldBase} block min-h-32 w-full resize-y py-3 leading-relaxed`;

export function OnboardingFlow({ defaultName }: { defaultName?: string }) {
  const router = useRouter();
  const [phase, setPhase] = useState<"form" | "loading">("form");
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [description, setDescription] = useState("");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPhase("loading");
    const res = await completeOnboarding({
      url,
      name: name.trim(),
      description: description.trim(),
    });
    if (!res.ok) {
      setPhase("form");
      toast.error(res.error);
      return;
    }
    router.push(`/sites/${res.siteId}`);
  }

  if (phase === "loading") return <LoadingScreen />;

  return (
    <main className="flex flex-1 flex-col py-8">
      <Link
        href="/dashboard"
        className="inline-flex items-center gap-3 self-start hover:opacity-80"
      >
        <PixelPigeon size={32} />
        <span className="text-lg font-semibold tracking-tight">
          <span className="text-muted-foreground">[</span>P
          <span className="text-muted-foreground">]</span>igeon
        </span>
      </Link>

      <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center pb-16">
        <h1 className="text-3xl font-bold tracking-tight">
          Tell us about your business
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {defaultName ? `Welcome, ${defaultName}. ` : ""}
          Pigeon uses this to measure where you show up in AI search.
        </p>

        <form onSubmit={onSubmit} className="mt-8 space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="name">Business name</Label>
            <Input
              id="name"
              required
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Acme Studio"
              className={fieldClass}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="url">Website</Label>
            <Input
              id="url"
              required
              inputMode="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="yourbusiness.com"
              className={fieldClass}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="description">What does your business do?</Label>
            <textarea
              id="description"
              required
              rows={4}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. a marketplace to hire vetted creative freelancers for design, video and photography"
              className={textareaClass}
            />
            <p className="text-xs text-muted-foreground">
              The clearer this is, the better the searches we test you on.
            </p>
          </div>

          <Button
            type="submit"
            className="h-11 w-full rounded-full text-sm font-semibold"
          >
            Analyse my site
          </Button>
        </form>
      </div>
    </main>
  );
}
