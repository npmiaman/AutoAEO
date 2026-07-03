import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function LandingPage() {
  return (
    <main className="flex-1">
      <header className="border-b">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2">
            <span className="text-lg" aria-hidden>🐦</span>
            <span className="font-semibold tracking-tight">Pigeon</span>
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
            The autonomous AEO + SEO agent
          </p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight md:text-6xl">
            Get your site recommended by AI.
          </h1>
          <p className="mt-6 text-lg text-muted-foreground md:text-xl">
            AI assistants now answer buying questions directly and point people
            to a handful of sites. Pigeon finds every search where you&rsquo;re
            invisible to ChatGPT, Perplexity, and Gemini, fixes what&rsquo;s
            missing, and proves it worked — on Shopify or any site.
          </p>
          <div className="mt-10 flex flex-wrap gap-3">
            <Link href="/signup">
              <Button size="lg">Run a free scan</Button>
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
            title="See where you stand"
            body="Runs the real questions your buyers ask AI assistants and shows which searches you appear on, where you rank, and who's winning the rest."
          />
          <FeatureCard
            title="It fixes it itself"
            body="An autonomous agent writes the schema, answer-first content, and meta — grounded in a real AEO/SEO playbook — then re-measures and keeps only what worked."
          />
          <FeatureCard
            title="Win the right gaps"
            body="Surfaces the high-demand whitespace where no strong competitor shows up, so your first wins are fast and worth it."
          />
        </div>
      </section>

      <footer className="border-t">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6 text-sm text-muted-foreground">
          <span>🐦 Pigeon</span>
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
