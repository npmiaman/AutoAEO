import type { ReactNode } from "react";

type Props = { contactEmail: string };

export default function Faqs({ contactEmail }: Props) {
  const faqs: { q: string; a: ReactNode }[] = [
    {
      q: "What does Pigeon actually do?",
      a: "Pigeon runs the real questions your buyers ask AI assistants (ChatGPT, Perplexity, Gemini) and shows exactly where you show up, where you don't, and who's winning the searches you're missing. Then it fixes what's missing on your site — schema, answer-first content, meta — re-measures those same searches, and keeps only the changes that actually move your visibility.",
    },
    {
      q: "What's AEO / GEO, and how is it different from SEO?",
      a: "SEO gets your page to rank in the blue links. AEO (answer engine optimization) / GEO (generative engine optimization) is about being the site an AI assistant names and cites when it answers a question directly. They sit on top of each other — AI engines mostly pull from search, so Pigeon works both: the technical and content fundamentals that help you rank, plus the structure that gets you quoted.",
    },
    {
      q: "How is this different from an SEO audit tool?",
      a: "Audit tools give you a checklist and a score, then leave the work to you. Pigeon is an autonomous agent — it measures against real AI answers, makes the changes itself, and proves each one worked by re-measuring. It also remembers every attempt, so it never repeats a dead end or redoes a win.",
    },
    {
      q: "Does it work on my site, or only Shopify?",
      a: "Both. Connect a Shopify store via OAuth and Pigeon writes to it directly (with one-click rollback). For any other site — a custom landing page, a startup, a hand-coded site — drop in the @autoaeo SDK (runtime) or run the build-time CLI, and the same agent delivers its fixes.",
    },
    {
      q: "Will it change my live site without asking?",
      a: "Every change is snapshotted and reversible. On the autonomous setting, Pigeon applies a change, re-measures the exact searches it targeted, and automatically reverts anything that doesn't improve your visibility — so nothing survives that didn't earn its place. You can also run it approval-first.",
    },
    {
      q: "How do I get started?",
      a: (
        <>
          Run a free scan on your site to see where you stand today. Questions?{" "}
          <a href={`mailto:${contactEmail}?subject=Pigeon`}>Get in touch</a>.
        </>
      ),
    },
  ];

  return (
    <section className="faq-sec" id="faq">
      <span className="feat-tag">FAQ</span>
      <h2 className="faq-title">Common questions</h2>
      <div className="faq-list">
        {faqs.map(({ q, a }) => (
          <details key={q} className="faq-item">
            <summary>{q}</summary>
            <p className="faq-a">{a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
