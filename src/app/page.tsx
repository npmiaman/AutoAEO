import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function LandingPage() {
  return (
    <main className="flex-1">
      <header className="border-b">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2">
            <div className="size-6 rounded-sm bg-foreground" />
            <span className="font-semibold tracking-tight">AutoAEO</span>
          </div>
          <nav className="flex items-center gap-2">
            <Link href="/signin">
              <Button variant="ghost" size="sm">
                Sign in
              </Button>
            </Link>
            <Link href="/signup">
              <Button size="sm">Get started</Button>
            </Link>
          </nav>
        </div>
      </header>

      <section className="mx-auto max-w-6xl px-6 py-24 md:py-32">
        <div className="max-w-3xl">
          <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
            For Shopify merchants
          </p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight md:text-6xl">
            Get cited by ChatGPT, Claude, and Perplexity.
          </h1>
          <p className="mt-6 text-lg text-muted-foreground md:text-xl">
            AutoAEO connects to your Shopify store and ships an AI-optimized
            layer in one click — schema markup, machine-readable pages,
            structured FAQs, and a complete{" "}
            <code className="rounded bg-muted px-1.5 py-0.5 text-base">
              llms.txt
            </code>
            . Humans see your beautiful store. Agents see a perfectly
            structured version designed for them.
          </p>
          <div className="mt-10 flex flex-wrap gap-3">
            <Link href="/signup">
              <Button size="lg">Connect your store</Button>
            </Link>
            <Link href="/signin">
              <Button size="lg" variant="outline">
                Sign in
              </Button>
            </Link>
          </div>
        </div>

        <div className="mt-20 grid gap-6 md:grid-cols-3">
          <FeatureCard
            title="Machine layer"
            body="Generates /llms.txt, /llms-full.txt, and a stripped machine template per page so AI crawlers ingest your store cleanly."
          />
          <FeatureCard
            title="Schema markup"
            body="Injects Organization, Product, BreadcrumbList, and FAQPage JSON-LD across your theme — the foundation AI search relies on."
          />
          <FeatureCard
            title="AEO sections"
            body="Builds question-first FAQ blocks, comparison tables, and direct-answer hero sections in the format LLMs love to quote."
          />
        </div>
      </section>

      <footer className="border-t">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6 text-sm text-muted-foreground">
          <span>AutoAEO</span>
          <span>© {new Date().getFullYear()}</span>
        </div>
      </footer>
    </main>
  );
}

function FeatureCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-lg border p-6">
      <h3 className="text-base font-semibold tracking-tight">{title}</h3>
      <p className="mt-2 text-sm text-muted-foreground">{body}</p>
    </div>
  );
}
