import "server-only";
import { generateText } from "./llm";
import type { SearchOutcome } from "./ranking";

// ─────────────────────────────────────────────────────────────────────
// Competitive map — NOT a score. For every query AI ran, we record where WE
// stand and who ranks where (us + every competitor, in order). From that map
// we surface FOCUS SIGNALS — the whitespace and quick wins to attack — and,
// for the leaders, decode WHY they get cited so we know how to beat them.
// ─────────────────────────────────────────────────────────────────────

export interface RankedPlayer {
  name: string;
  position: number; // 1-based, as the AI presented them
  isUs: boolean;
}

// Where everyone stands on a single query.
export interface QueryRanking {
  query: string;
  ourPosition: number | null; // where WE stand (null = absent)
  ranked: RankedPlayer[]; // everyone named, in order
}

export interface FocusSignals {
  // Absent searches where NO strong competitor appears — fastest to win.
  quickWins: string[];
  // Searches we already win (defend + strengthen).
  ourWins: string[];
  // Absent searches dominated by 3+ strong competitors — hard, deprioritize.
  entrenched: string[];
  // All absent searches (the full gap).
  ourGaps: string[];
}

export interface CompetitorBasis {
  name: string;
  url: string | null;
  ranksOn: string[];
  factors: string[]; // WHY they get cited (evidence-based)
  howToBeat: string[]; // concrete moves to out-rank them
}

export interface CompetitiveMap {
  totalSearches: number;
  ourAppearances: number;
  rankings: QueryRanking[]; // who ranks where, per query
  // Factual sets — which queries each competitor ranks on (NO percentage score).
  competitors: Array<{ name: string; ranksOn: string[] }>;
  strongCompetitors: string[]; // recurring winners (context for focus signals)
  focus: FocusSignals;
  basis: CompetitorBasis[]; // per-leader ranking-factor analysis (optional)
}

function normalizeName(s: string): string {
  return s.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}
function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return "";
  }
}
function isSelf(name: string, ourName: string, ourDomain: string): boolean {
  const n = normalizeName(name);
  return (
    n === normalizeName(ourName) || n === normalizeName(ourDomain.split(".")[0])
  );
}

export function buildCompetitiveMap(
  outcomes: SearchOutcome[],
  ourName: string,
  ourDomain: string,
): CompetitiveMap {
  const scored = outcomes.filter((o) => !o.error);
  const total = scored.length;

  // Per-query ranking map (us + competitors, in order).
  const rankings: QueryRanking[] = scored.map((o) => ({
    query: o.query,
    ourPosition: o.position,
    ranked: o.rankedEntities.map((name, idx) => ({
      name,
      position: idx + 1,
      isUs: isSelf(name, ourName, ourDomain),
    })),
  }));

  // Which queries each competitor ranks on (factual sets, no scores).
  const compQueries = new Map<string, Set<string>>();
  for (const o of scored) {
    for (const name of o.rankedEntities) {
      if (isSelf(name, ourName, ourDomain)) continue;
      const key = name.trim();
      if (!key) continue;
      (compQueries.get(key) ?? compQueries.set(key, new Set()).get(key)!).add(
        o.query,
      );
    }
  }
  const competitors = [...compQueries.entries()]
    .map(([name, qs]) => ({ name, ranksOn: [...qs] }))
    .sort((a, b) => b.ranksOn.length - a.ranksOn.length);

  // "Strong" = recurring winners; used only to classify search difficulty.
  const strongThreshold = Math.max(2, Math.ceil(total * 0.15));
  const strongSet = new Set(
    competitors.filter((c) => c.ranksOn.length >= strongThreshold).map((c) => c.name),
  );

  const ourWins: string[] = [];
  const ourGaps: string[] = [];
  const quickWins: string[] = [];
  const entrenched: string[] = [];
  for (const o of scored) {
    if (o.appeared) {
      ourWins.push(o.query);
      continue;
    }
    ourGaps.push(o.query);
    const strongPresent = o.rankedEntities.filter((e) => strongSet.has(e));
    if (strongPresent.length === 0) quickWins.push(o.query);
    else if (strongPresent.length >= 3) entrenched.push(o.query);
  }

  return {
    totalSearches: total,
    ourAppearances: ourWins.length,
    rankings,
    competitors,
    strongCompetitors: [...strongSet],
    focus: { quickWins, ourWins, entrenched, ourGaps },
    basis: [],
  };
}

// ─── "Why do they rank?" — fetch a cited page and decode it ───────────

async function fetchPageText(url: string): Promise<string | null> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 12_000);
    const res = await fetch(url, {
      headers: { "User-Agent": "AutoAEO-Bot/1.0 (+https://autoaeo.com/bot)" },
      redirect: "follow",
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

function citationForCompetitor(
  name: string,
  outcomes: SearchOutcome[],
): string | null {
  const token = normalizeName(name);
  for (const o of outcomes) {
    if (!o.rankedEntities.includes(name)) continue;
    for (const url of o.citations) {
      const host = normalizeName(hostOf(url));
      if (host && (host.includes(token) || token.includes(host.replace(/com$|io$|co$/, ""))))
        return url;
    }
  }
  return null;
}

export async function analyzeCompetitorBasis(args: {
  name: string;
  ranksOn: string[];
  outcomes: SearchOutcome[];
}): Promise<CompetitorBasis> {
  const url = citationForCompetitor(args.name, args.outcomes);
  const html = url ? await fetchPageText(url) : null;
  const pageText = html
    ? html
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 5000)
    : "";
  const hasSchema = html ? /application\/ld\+json/i.test(html) : false;
  const hasFaqSchema = html ? /"FAQPage"|"@type"\s*:\s*"Question"/i.test(html) : false;

  const prompt = `A competitor "${args.name}" gets cited by AI assistants for: ${args.ranksOn
    .slice(0, 4)
    .join("; ")}.

${url ? `Their cited page: ${url}` : "No cited page URL was resolvable."}
Detected on page: JSON-LD schema=${hasSchema}, FAQ schema=${hasFaqSchema}.
${pageText ? `Page content (excerpt):\n"""${pageText}"""` : "(page content unavailable)"}

Explain, evidence-based (not generic):
1. WHY this page/brand gets cited — ranking factors actually present.
2. HOW to out-rank them — concrete moves.

Return ONLY JSON: {"factors": ["..."], "howToBeat": ["..."]}`;

  try {
    const raw = await generateText(prompt, { temperature: 0.3 });
    const parsed = JSON.parse(
      raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1),
    ) as { factors?: string[]; howToBeat?: string[] };
    return {
      name: args.name,
      url,
      ranksOn: args.ranksOn.slice(0, 4),
      factors: parsed.factors ?? [],
      howToBeat: parsed.howToBeat ?? [],
    };
  } catch {
    return { name: args.name, url, ranksOn: args.ranksOn.slice(0, 4), factors: [], howToBeat: [] };
  }
}
