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

// Monthly search demand behind a query's head keyword (see agent/volume).
export interface QueryDemand {
  keyword: string;
  monthlyVolume: number | null;
  source: string;
}

export interface CompetitiveMap {
  totalSearches: number;
  ourAppearances: number;
  rankings: QueryRanking[]; // who ranks where, per query
  // Factual sets — which queries each competitor ranks on (NO percentage score).
  // `domain` is resolved from cited sources; `logoUrl` is extracted from their
  // site during competitor analysis (see resolveCompetitorLogos).
  competitors: Array<{
    name: string;
    ranksOn: string[];
    domain?: string;
    logoUrl?: string;
  }>;
  strongCompetitors: string[]; // recurring winners (context for focus signals)
  focus: FocusSignals;
  // Search demand keyed by query — attached after the map is built. Focus
  // lists are re-sorted by volume so high-demand gaps come first.
  demand: Record<string, QueryDemand>;
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

// Resolve a competitor's domain (for logo display). If the name itself is a
// domain, use it; otherwise match it against the cited source hosts on the
// searches it ranked for.
function resolveDomain(name: string, outcomes: SearchOutcome[]): string | undefined {
  const asDomain = name.trim().toLowerCase().match(/([a-z0-9-]+\.)+[a-z]{2,}/);
  if (asDomain) return asDomain[0];
  const token = normalizeName(name);
  if (!token) return undefined;
  for (const o of outcomes) {
    if (!o.rankedEntities.includes(name)) continue;
    for (const url of o.citations) {
      const host = hostOf(url);
      const hn = normalizeName(host);
      if (
        host &&
        (hn.includes(token) ||
          token.includes(hn.replace(/(com|io|co|net|org)$/, "")))
      )
        return host;
    }
  }
  return undefined;
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
    .map(([name, qs]) => ({
      name,
      ranksOn: [...qs],
      domain: resolveDomain(name, scored),
    }))
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
    demand: {},
    basis: [],
  };
}

/** Attach search demand and re-sort focus lists by volume (highest first). */
export function applyDemand(
  map: CompetitiveMap,
  demand: Record<string, QueryDemand>,
): void {
  map.demand = demand;
  const vol = (q: string) => demand[q]?.monthlyVolume ?? -1;
  const byVol = (a: string, b: string) => vol(b) - vol(a);
  map.focus.quickWins.sort(byVol);
  map.focus.ourGaps.sort(byVol);
  map.focus.ourWins.sort(byVol);
}

// ─── "Why do they rank?" — fetch a cited page and decode it ───────────

async function fetchPageText(url: string): Promise<string | null> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 12_000);
    const res = await fetch(url, {
      headers: { "User-Agent": "Pigeon-Bot/1.0 (+https://pigeon.com/bot)" },
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

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Batched "why they rank" — fetches each top competitor's cited page (concurrent
 * HTTP), then decodes ALL of them in a single LLM call returning a JSON array.
 * Was one LLM call per competitor.
 */
export async function analyzeCompetitorsBasis(args: {
  competitors: Array<{ name: string; ranksOn: string[] }>;
  outcomes: SearchOutcome[];
}): Promise<CompetitorBasis[]> {
  if (args.competitors.length === 0) return [];

  // 1. Gather page context per competitor (HTTP fetches — concurrent).
  const ctx = await Promise.all(
    args.competitors.map(async (c) => {
      const url = citationForCompetitor(c.name, args.outcomes);
      const html = url ? await fetchPageText(url) : null;
      return {
        name: c.name,
        ranksOn: c.ranksOn.slice(0, 4),
        url,
        pageText: html ? stripHtml(html).slice(0, 2500) : "",
        hasSchema: html ? /application\/ld\+json/i.test(html) : false,
        hasFaqSchema: html ? /"FAQPage"|"@type"\s*:\s*"Question"/i.test(html) : false,
      };
    }),
  );

  const empty = (): CompetitorBasis[] =>
    ctx.map((c) => ({
      name: c.name,
      url: c.url,
      ranksOn: c.ranksOn,
      factors: [],
      howToBeat: [],
    }));

  // 2. One LLM call for all competitors.
  const blocks = ctx
    .map(
      (c, i) => `[${i}] Competitor "${c.name}" — cited for: ${c.ranksOn.join("; ")}
${c.url ? `Cited page: ${c.url}` : "No cited page resolvable."}
Detected: JSON-LD=${c.hasSchema}, FAQ schema=${c.hasFaqSchema}.
${c.pageText ? `Excerpt: """${c.pageText}"""` : "(no page content)"}`,
    )
    .join("\n\n");

  const prompt = `You are a GEO/SEO strategist. For EACH competitor below, explain — evidence-based, not generic — WHY it gets cited by AI assistants (ranking factors actually present) and HOW to out-rank it (concrete moves).

${blocks}

Return ONLY a JSON array, one object per competitor keyed by its [index]:
[{"i": <index>, "factors": ["..."], "howToBeat": ["..."]}]`;

  try {
    const raw = await generateText(prompt, { temperature: 0.3 });
    const parsed = JSON.parse(
      raw.slice(raw.indexOf("["), raw.lastIndexOf("]") + 1),
    ) as Array<{ i?: number; factors?: string[]; howToBeat?: string[] }>;
    const byIndex = new Map<number, { factors: string[]; howToBeat: string[] }>();
    for (const p of parsed) {
      if (typeof p.i !== "number") continue;
      byIndex.set(p.i, { factors: p.factors ?? [], howToBeat: p.howToBeat ?? [] });
    }
    return ctx.map((c, i) => ({
      name: c.name,
      url: c.url,
      ranksOn: c.ranksOn,
      factors: byIndex.get(i)?.factors ?? [],
      howToBeat: byIndex.get(i)?.howToBeat ?? [],
    }));
  } catch {
    return empty();
  }
}

// ─── Logo extraction — part of competitor analysis ───────────────────
//
// For the top competitors, fetch their site and extract the actual brand logo
// (apple-touch-icon → <link rel="icon"> → favicon service fallback). Stored as
// logoUrl so the dashboard displays a real logo, not a guessed favicon.

async function fetchHtml(url: string): Promise<string | null> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(url, {
      headers: { "User-Agent": "Pigeon-Bot/1.0 (+https://pigeon.com/bot)" },
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

function absolutize(href: string, base: string): string {
  try {
    return new URL(href, base).toString();
  } catch {
    return href;
  }
}

async function resolveLogo(domain: string): Promise<string> {
  const base = `https://${domain}/`;
  const html = await fetchHtml(base);
  if (html) {
    const links = [...html.matchAll(/<link\b[^>]*>/gi)].map((m) => m[0]);
    const hrefOf = (tag: string) => tag.match(/href=["']([^"']+)["']/i)?.[1];
    // Prefer apple-touch-icon (a square brand logo), then any rel="icon".
    const apple = links.find(
      (t) => /rel=["'][^"']*apple-touch-icon/i.test(t) && hrefOf(t),
    );
    if (apple) return absolutize(hrefOf(apple)!, base);
    const icon = links.find(
      (t) => /rel=["'][^"']*\bicon\b/i.test(t) && hrefOf(t),
    );
    if (icon) return absolutize(hrefOf(icon)!, base);
  }
  // Reliable fallback — always returns an image.
  return `https://www.google.com/s2/favicons?domain=${domain}&sz=128`;
}

/** Extract logos for the top `count` competitors (mutates the map in place). */
export async function resolveCompetitorLogos(
  map: CompetitiveMap,
  count = 8,
): Promise<void> {
  const targets = map.competitors.slice(0, count).filter((c) => c.domain);
  await Promise.all(
    targets.map(async (c) => {
      c.logoUrl = await resolveLogo(c.domain!);
    }),
  );
}
