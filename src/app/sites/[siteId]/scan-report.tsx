import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

  return (
    <div className="space-y-6">
      {/* Headline */}
      <Card>
        <CardContent className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-6">
          <span className="font-heading text-4xl tracking-tight">
            {appeared}/{total}
          </span>
          <span className="text-muted-foreground">
            AI searches you show up on ({pct}%)
          </span>
          {ranAt && (
            <span className="ml-auto text-xs text-muted-foreground">
              scanned {ranAt.toLocaleDateString()} · engines:{" "}
              {detail.engines?.join(", ") ?? "openai"}
            </span>
          )}
        </CardContent>
      </Card>

      {/* Quick-win whitespace */}
      {c.focus.quickWins.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Quick wins — no strong competitor here yet
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {c.focus.quickWins.map((q) => (
              <div
                key={q}
                className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm"
              >
                <span>{q}</span>
                {demandTag(c, q) && (
                  <Badge variant="secondary" className="shrink-0 text-[10px]">
                    {demandTag(c, q)}
                  </Badge>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Ranking map */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Where you stand — who ranks on each search
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2.5">
          {c.rankings.map((r) => (
            <div key={r.query} className="text-sm">
              <div className="flex items-center gap-2">
                {r.ourPosition ? (
                  <Badge className="shrink-0 text-[10px]">You #{r.ourPosition}</Badge>
                ) : (
                  <Badge variant="outline" className="shrink-0 text-[10px] text-muted-foreground">
                    Not shown
                  </Badge>
                )}
                <span>{r.query}</span>
              </div>
              {r.ranked.filter((p) => !p.isUs).length > 0 && (
                <div className="mt-1 pl-1 text-xs text-muted-foreground">
                  {r.ranked
                    .filter((p) => !p.isUs)
                    .slice(0, 5)
                    .map((p) => p.name)
                    .join(" · ")}
                </div>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Diagnosis */}
      {(dx.whatsMissing.length > 0 || dx.recommendations.length > 0) && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">What to fix</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {dx.whatsMissing.length > 0 && (
              <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                {dx.whatsMissing.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            )}
            {dx.recommendations.map((rec, i) => (
              <div key={i} className="rounded-lg border p-3">
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="text-[10px]">
                    {rec.kind === "win_missing" ? "win new" : "strengthen"}
                  </Badge>
                  <span className="text-sm font-medium">{rec.action}</span>
                </div>
                {rec.rationale && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {rec.rationale}
                  </p>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
