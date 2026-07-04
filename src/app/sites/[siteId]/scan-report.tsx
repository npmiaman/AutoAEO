import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import type { CompetitiveMap } from "@/lib/agent/measurement/competitors";
import type { Diagnosis } from "@/lib/agent/measurement/diagnosis";
import { CompetitorChart, type ChartBar } from "./competitor-chart";
import { TopOpportunities, type Opportunity } from "./top-opportunities";
import { RefreshLogoButton } from "./refresh-logo-button";
import { refreshLogo } from "./actions";

export interface ScanDetail {
  competitors: CompetitiveMap;
  diagnosis: Diagnosis;
  engines?: string[];
}

function demandTag(c: CompetitiveMap, q: string): string | null {
  const d = c.demand?.[q];
  if (!d || d.monthlyVolume == null) return null;
  return `~${d.monthlyVolume}/mo${d.source === "llm-estimate" ? " est" : ""}`;
}

function demandNum(c: CompetitiveMap, q: string): number {
  return c.demand?.[q]?.monthlyVolume ?? 0;
}

// A stat tile — the right form for a single magnitude/headline (no chart).
function Stat({
  label,
  value,
  sub,
  meter,
}: {
  label: string;
  value: React.ReactNode;
  sub?: string;
  meter?: number; // 0..1
}) {
  return (
    <Card>
      <CardContent className="py-5">
        <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </div>
        <div className="mt-1 font-heading text-3xl leading-none tracking-tight">
          {value}
        </div>
        {sub && <div className="mt-1 text-xs text-muted-foreground">{sub}</div>}
        {meter != null && (
          <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-foreground"
              style={{ width: `${Math.max(3, Math.round(meter * 100))}%` }}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="font-heading text-lg tracking-tight">{children}</h2>
  );
}

export function ScanReport({
  detail,
  siteId,
  appeared,
  total,
  ranAt,
  ourName,
  ourDomain,
}: {
  detail: ScanDetail;
  siteId: string;
  appeared: number;
  total: number;
  ranAt: Date | null;
  ourName: string;
  ourDomain: string;
}) {
  const c = detail.competitors;
  const dx = detail.diagnosis;
  const pct = total ? Math.round((appeared / total) * 100) : 0;
  const gaps = c.focus.ourGaps;
  // Openings with no strong rival, ranked by search demand so the top few are
  // genuinely where we have the most opportunity to win.
  const opportunities: Opportunity[] = [...c.focus.quickWins]
    .sort((a, b) => demandNum(c, b) - demandNum(c, a))
    .map((q) => ({ query: q, demand: demandTag(c, q) }));

  // Our own bar uses our extracted+verified logo; fall back to a plain favicon
  // only until the "get my logo" re-fetch lands one.
  const ourLogoUrl =
    c.ourLogoUrl ??
    `https://www.google.com/s2/favicons?domain=${ourDomain}&sz=128`;

  // Chart data: top competitors + your own bar, ordered by presence count.
  const bars: ChartBar[] = [
    ...c.competitors.slice(0, 6).map((comp) => ({
      name: comp.name,
      count: comp.ranksOn.length,
      logoUrl: comp.logoUrl,
      isUs: false,
    })),
    {
      name: ourName,
      count: appeared,
      logoUrl: ourLogoUrl,
      isUs: true,
    },
  ].sort((a, b) => b.count - a.count);
  const maxCompCount = Math.max(1, ...bars.map((b) => b.count));

  return (
    <div className="space-y-6">
      {/* ── KPI row — the at-a-glance headline ──────────────────── */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat
          label="AI visibility"
          value={`${appeared}/${total}`}
          sub={`you show up on ${pct}% of searches`}
          meter={total ? appeared / total : 0}
        />
        <Stat
          label="Opportunities"
          value={opportunities.length}
          sub="openings with no strong rival"
        />
        <Stat
          label="Missing"
          value={gaps.length}
          sub="searches you don't appear on"
        />
        <Stat
          label="Competitors"
          value={c.competitors.length}
          sub="brands ranking on your searches"
        />
      </div>

      {/* ── Who's winning + Where to focus — side by side in one row ─ */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardContent className="space-y-5 py-5">
            <SectionTitle>Who&rsquo;s winning your searches</SectionTitle>
            {c.competitors.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No recurring competitors surfaced.
              </p>
            ) : (
              <>
                <CompetitorChart bars={bars} maxCount={maxCompCount} />
                {!c.ourLogoUrl && (
                  <form action={refreshLogo.bind(null, siteId)}>
                    <RefreshLogoButton />
                  </form>
                )}
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-3 py-5">
            <SectionTitle>Where to focus first</SectionTitle>
            {opportunities.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No open searches — you&rsquo;re up against established
                competitors everywhere. See &ldquo;What to fix&rdquo; below.
              </p>
            ) : (
              <TopOpportunities items={opportunities} topN={5} />
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── What to fix ─────────────────────────────────────────── */}
      {dx.recommendations.length > 0 && (
        <Card>
          <CardContent className="space-y-3 py-5">
            <SectionTitle>What to fix next</SectionTitle>
            <div className="space-y-2">
              {dx.recommendations.slice(0, 4).map((rec, i) => (
                <div
                  key={i}
                  className="flex items-start gap-3 rounded-lg border p-3"
                >
                  <Badge
                    variant="secondary"
                    className="mt-0.5 shrink-0 text-[10px]"
                  >
                    {rec.kind === "win_missing" ? "win new" : "strengthen"}
                  </Badge>
                  <div>
                    <div className="text-sm font-medium">{rec.action}</div>
                    {rec.rationale && (
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {rec.rationale}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Full breakdown — tucked away so the page isn't a wall ── */}
      <details className="group rounded-xl border">
        <summary className="flex cursor-pointer list-none items-center justify-between px-5 py-4 text-sm font-medium">
          <span>
            Every search — where you stand ({total})
          </span>
          <span className="text-muted-foreground transition-transform group-open:rotate-180">
            ▾
          </span>
        </summary>
        <div className="space-y-2.5 border-t px-5 py-4">
          {c.rankings.map((r) => (
            <div key={r.query} className="text-sm">
              <div className="flex items-center gap-2">
                {r.ourPosition ? (
                  <Badge className="shrink-0 text-[10px]">
                    You #{r.ourPosition}
                  </Badge>
                ) : (
                  <Badge
                    variant="outline"
                    className="shrink-0 text-[10px] text-muted-foreground"
                  >
                    Not shown
                  </Badge>
                )}
                <span className="truncate">{r.query}</span>
              </div>
              {r.ranked.filter((p) => !p.isUs).length > 0 && (
                <div className="mt-0.5 truncate pl-1 text-xs text-muted-foreground">
                  {r.ranked
                    .filter((p) => !p.isUs)
                    .slice(0, 4)
                    .map((p) => p.name)
                    .join(" · ")}
                </div>
              )}
            </div>
          ))}
        </div>
      </details>

      {ranAt && (
        <p className="text-right text-xs text-muted-foreground">
          Scanned {ranAt.toLocaleDateString()} · engines:{" "}
          {detail.engines?.join(", ") ?? "openai"}
        </p>
      )}
    </div>
  );
}
