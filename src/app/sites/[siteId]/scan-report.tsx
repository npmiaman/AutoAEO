import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import type { CompetitiveMap } from "@/lib/agent/measurement/competitors";
import type { Diagnosis } from "@/lib/agent/measurement/diagnosis";

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
  appeared,
  total,
  ranAt,
}: {
  detail: ScanDetail;
  appeared: number;
  total: number;
  ranAt: Date | null;
}) {
  const c = detail.competitors;
  const dx = detail.diagnosis;
  const pct = total ? Math.round((appeared / total) * 100) : 0;
  const gaps = c.focus.ourGaps;
  const quickWins = c.focus.quickWins;
  const topCompetitors = c.competitors.slice(0, 6);

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
          label="Quick wins"
          value={quickWins.length}
          sub="winnable — no strong rival"
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

      {/* ── Two columns: quick wins + who's winning ─────────────── */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardContent className="space-y-3 py-5">
            <SectionTitle>Quick wins to grab first</SectionTitle>
            {quickWins.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No open searches — you&rsquo;re up against strong competitors
                everywhere. See &ldquo;What to fix&rdquo; below.
              </p>
            ) : (
              <ul className="space-y-2">
                {quickWins.slice(0, 6).map((q) => (
                  <li
                    key={q}
                    className="flex items-center justify-between gap-3 text-sm"
                  >
                    <span className="truncate">{q}</span>
                    {demandTag(c, q) && (
                      <Badge variant="secondary" className="shrink-0 text-[10px]">
                        {demandTag(c, q)}
                      </Badge>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-3 py-5">
            <SectionTitle>Who&rsquo;s winning</SectionTitle>
            {topCompetitors.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No recurring competitors surfaced.
              </p>
            ) : (
              <ul className="space-y-2">
                {topCompetitors.map((comp) => (
                  <li
                    key={comp.name}
                    className="flex items-center justify-between gap-3 text-sm"
                  >
                    <span className="truncate">{comp.name}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      on {comp.ranksOn.length} search
                      {comp.ranksOn.length === 1 ? "" : "es"}
                    </span>
                  </li>
                ))}
              </ul>
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
