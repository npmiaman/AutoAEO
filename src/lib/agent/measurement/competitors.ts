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

// Canonical key that merges the same brand written different ways
// ("Upwork" and "upwork.com" → "upwork").
export function canonKey(name: string): { key: string; isDomain: boolean } {
  const low = name.trim().toLowerCase().replace(/^https?:\/\//, "").split("/")[0].split("?")[0];
  const dm = low.match(/^([a-z0-9-]+)\.[a-z0-9.-]*[a-z]{2,}$/);
  if (dm) return { key: dm[1], isDomain: true };
  return { key: low.replace(/[^a-z0-9]/g, ""), isDomain: false };
}

function toDomain(name: string): string {
  return name.trim().toLowerCase().replace(/^https?:\/\//, "").split("/")[0].split("?")[0].replace(/^www\./, "");
}

// Best-effort domain from cited sources, for logos.
function domainFromCitations(name: string, outcomes: SearchOutcome[]): string | undefined {
  const token = normalizeName(name);
  if (!token) return undefined;
  for (const o of outcomes) {
    if (!o.rankedEntities.includes(name)) continue;
    for (const url of o.citations) {
      const host = hostOf(url);
      const hn = normalizeName(host);
      if (host && (hn.includes(token) || token.includes(hn.replace(/(com|io|co|net|org)$/, ""))))
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

  // Aggregate competitors by canonical key — merges "Upwork" + "upwork.com".
  type Agg = { key: string; display: string; brand?: string; domainCand?: string; queries: Set<string> };
  const agg = new Map<string, Agg>();
  for (const o of scored) {
    for (const name of o.rankedEntities) {
      if (isSelf(name, ourName, ourDomain)) continue;
      const { key, isDomain } = canonKey(name);
      if (!key) continue;
      let a = agg.get(key);
      if (!a) {
        a = { key, display: name, queries: new Set() };
        agg.set(key, a);
      }
      a.queries.add(o.query);
      if (isDomain) {
        a.domainCand ??= toDomain(name);
        if (!a.brand) a.display = name;
      } else {
        a.brand = name;
        a.display = name; // prefer a clean brand name for display
      }
    }
  }

  const competitors = [...agg.values()]
    .map((a) => ({
      name: a.display,
      ranksOn: [...a.queries],
      domain:
        a.domainCand ??
        domainFromCitations(a.brand ?? a.display, scored) ??
        `${a.key}.com`, // fallback so a logo always resolves
    }))
    .sort((x, y) => y.ranksOn.length - x.ranksOn.length);

  const displayByKey = new Map([...agg.values()].map((a) => [a.key, a.display]));

  // Per-query ranking map, deduped by canonical key.
  const rankings: QueryRanking[] = scored.map((o) => {
    const seen = new Set<string>();
    const ranked: { name: string; position: number; isUs: boolean }[] = [];
    o.rankedEntities.forEach((name, idx) => {
      const self = isSelf(name, ourName, ourDomain);
      const key = self ? "__self__" : canonKey(name).key;
      if (!key || seen.has(key)) return;
      seen.add(key);
      ranked.push({
        name: self ? name : displayByKey.get(key) ?? name,
        position: idx + 1,
        isUs: self,
      });
    });
    return { query: o.query, ourPosition: o.position, ranked };
  });

  const ourWins = scored.filter((o) => o.appeared).map((o) => o.query);
  const ourGaps = scored.filter((o) => !o.appeared).map((o) => o.query);

  return {
    totalSearches: total,
    ourAppearances: ourWins.length,
    rankings,
    competitors,
    strongCompetitors: [], // filled by applyStrength (LLM-judged authority)
    focus: { quickWins: [], ourWins, entrenched: [], ourGaps },
    demand: {},
    basis: [],
  };
}

// ─── "Strong" = established/authoritative brand, judged by an LLM ─────
//
// NOT frequency. Upwork is a strong competitor whether it appeared once or 40
// times; a one-off obscure site is weak regardless. The LLM classifies each
// surfaced brand by real-world recognizability/authority.

export async function classifyStrongCompetitors(
  competitors: Array<{ name: string }>,
  business?: string,
): Promise<string[]> {
  if (competitors.length === 0) return [];
  const list = competitors
    .slice(0, 40)
    .map((c, i) => `${i + 1}. ${c.name}`)
    .join("\n");

  const prompt = `Below are brands/sites that AI assistants surface for ${business ?? "this market"}. Classify each as ESTABLISHED — a well-known, authoritative brand or major platform that would be hard to displace — or MINOR (obscure, thin, low-authority, or a one-off). Judge by real-world recognizability and authority, NOT by how often it appears.

${list}

Return ONLY a JSON array of the EXACT names you judge ESTABLISHED:
["Name A","Name B"]`;

  try {
    const raw = await generateText(prompt, { temperature: 0 });
    const names = JSON.parse(
      raw.slice(raw.indexOf("["), raw.lastIndexOf("]") + 1),
    ) as string[];
    return names.map((n) => canonKey(String(n)).key).filter(Boolean);
  } catch {
    return [];
  }
}

/** Recompute focus signals (quick-wins vs entrenched) from the LLM strong set. */
export function applyStrength(map: CompetitiveMap, strongKeys: string[]): void {
  const strong = new Set(strongKeys);
  map.strongCompetitors = map.competitors
    .filter((c) => strong.has(canonKey(c.name).key))
    .map((c) => c.name);

  const quickWins: string[] = [];
  const entrenched: string[] = [];
  for (const r of map.rankings) {
    if (r.ourPosition) continue; // we appear here — not a gap
    const strongPresent = r.ranked
      .filter((p) => !p.isUs)
      .map((p) => canonKey(p.name).key)
      .filter((k) => strong.has(k));
    if (strongPresent.length === 0) quickWins.push(r.query);
    else if (strongPresent.length >= 2) entrenched.push(r.query);
  }
  map.focus.quickWins = quickWins;
  map.focus.entrenched = entrenched;
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

// Verify a URL actually returns a real image (not a 404 page, HTML error, or a
// 1x1 tracking pixel). This is the "check if the logo was retrieved correctly".
async function isValidImage(url: string): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 6000);
    const res = await fetch(url, {
      headers: { "User-Agent": "Pigeon-Bot/1.0 (+https://pigeon.com/bot)" },
      redirect: "follow",
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!res.ok) return false;
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.toLowerCase().startsWith("image")) return false;
    const buf = await res.arrayBuffer();
    return buf.byteLength > 100; // reject empty / 1x1 placeholders
  } catch {
    return false;
  }
}

// Ordered candidate sources for a domain's logo.
async function logoCandidates(domain: string): Promise<string[]> {
  const base = `https://${domain}/`;
  const out: string[] = [];
  const html = await fetchHtml(base);
  if (html) {
    const links = [...html.matchAll(/<link\b[^>]*>/gi)].map((m) => m[0]);
    const hrefOf = (tag: string) => tag.match(/href=["']([^"']+)["']/i)?.[1];
    const apple = links.find((t) => /rel=["'][^"']*apple-touch-icon/i.test(t) && hrefOf(t));
    if (apple) out.push(absolutize(hrefOf(apple)!, base));
    for (const t of links.filter((t) => /rel=["'][^"']*\bicon\b/i.test(t) && hrefOf(t))) {
      out.push(absolutize(hrefOf(t)!, base));
    }
    const og = html.match(/<meta[^>]+property=["']og:image["'][^>]*>/i)?.[0];
    const ogHref = og?.match(/content=["']([^"']+)["']/i)?.[1];
    if (ogHref) out.push(absolutize(ogHref, base));
  }
  out.push(`https://${domain}/apple-touch-icon.png`);
  out.push(`https://${domain}/favicon.ico`);
  out.push(`https://logo.clearbit.com/${domain}`);
  out.push(`https://www.google.com/s2/favicons?domain=${domain}&sz=128`);
  return [...new Set(out)];
}

/**
 * Resolve a verified logo: try each candidate source and KEEP GOING until one
 * actually returns a valid image. Returns null only if every source failed.
 */
async function resolveLogo(domain: string): Promise<string | null> {
  for (const url of await logoCandidates(domain)) {
    if (await isValidImage(url)) return url;
  }
  return null;
}

/**
 * Extract + verify logos for the top `count` competitors. Retries the whole
 * candidate chain per competitor (up to `attempts` passes) until each gets a
 * verified logo, so transient fetch failures don't leave a competitor blank.
 */
export async function resolveCompetitorLogos(
  map: CompetitiveMap,
  count = 8,
  attempts = 2,
): Promise<void> {
  const targets = map.competitors.slice(0, count).filter((c) => c.domain);
  await Promise.all(
    targets.map(async (c) => {
      for (let pass = 0; pass < attempts && !c.logoUrl; pass++) {
        c.logoUrl = (await resolveLogo(c.domain!)) ?? undefined;
      }
    }),
  );
}
