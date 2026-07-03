import "server-only";
import { generateText } from "./llm";
import type { SearchOutcome } from "./ranking";

// ─────────────────────────────────────────────────────────────────────
// Competitive intelligence. From one scan we already know who appeared on
// each search. This turns that into strategy:
//   • Share of Voice  — who wins most, and on which searches.
//   • Whitespace      — searches where NO strong competitor appears (only
//                       weak/thin players): the easiest wins to double down on.
//   • Ranking basis   — for the leaders, fetch a cited page and decode WHY it
//                       gets cited (schema, answer-first, depth), so we know
//                       what to replicate and beat.
// ─────────────────────────────────────────────────────────────────────

export interface CompetitorStanding {
  name: string;
  appearances: number;
  shareOfVoice: number; // appearances / total searches (0..1)
  searches: string[]; // where they appear
  avgPosition: number | null;
}

export interface WhitespaceSearch {
  query: string;
  strength: "open" | "moderate" | "contested";
  strongIncumbents: string[]; // recurring competitors present (empty = open)
}

export interface CompetitorBasis {
  name: string;
  url: string | null; // the cited page we analyzed
  rankedFor: string[]; // sample searches they win
  factors: string[]; // WHY they get cited (evidence-based)
  howToBeat: string[]; // concrete moves to out-rank them
}

export interface CompetitiveReport {
  totalSearches: number;
  leaderboard: CompetitorStanding[];
  strongCompetitors: string[]; // recurring winners
  whitespace: WhitespaceSearch[]; // "open" searches — double down here first
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

/** Is this ranked entity actually us? (so we exclude ourselves.) */
function isSelf(name: string, ourName: string, ourDomain: string): boolean {
  const n = normalizeName(name);
  return (
    n === normalizeName(ourName) ||
    n === normalizeName(ourDomain.split(".")[0])
  );
}

export function buildCompetitiveReport(
  outcomes: SearchOutcome[],
  ourName: string,
  ourDomain: string,
): CompetitiveReport {
  const scored = outcomes.filter((o) => !o.error);
  const total = scored.length;

  // Tally appearances + positions per competitor.
  const tally = new Map<
    string,
    { appearances: number; searches: Set<string>; positions: number[] }
  >();
  for (const o of scored) {
    o.rankedEntities.forEach((name, idx) => {
      if (isSelf(name, ourName, ourDomain)) return;
      const key = name.trim();
      if (!key) return;
      const t = tally.get(key) ?? {
        appearances: 0,
        searches: new Set<string>(),
        positions: [],
      };
      t.appearances += 1;
      t.searches.add(o.query);
      t.positions.push(idx + 1);
      tally.set(key, t);
    });
  }

  const leaderboard: CompetitorStanding[] = [...tally.entries()]
    .map(([name, t]) => ({
      name,
      appearances: t.appearances,
      shareOfVoice: total ? t.appearances / total : 0,
      searches: [...t.searches],
      avgPosition: t.positions.length
        ? t.positions.reduce((a, b) => a + b, 0) / t.positions.length
        : null,
    }))
    .sort((a, b) => b.appearances - a.appearances);

  // "Strong" = recurring winners (appear on several searches). Threshold scales
  // with the search-set size but is at least 2.
  const strongThreshold = Math.max(2, Math.ceil(total * 0.15));
  const strongSet = new Set(
    leaderboard.filter((c) => c.appearances >= strongThreshold).map((c) => c.name),
  );

  // Classify each search by how contested it is.
  const whitespace: WhitespaceSearch[] = scored.map((o) => {
    const strongPresent = o.rankedEntities.filter((e) => strongSet.has(e));
    const strength: WhitespaceSearch["strength"] =
      strongPresent.length === 0
        ? "open"
        : strongPresent.length >= 3
          ? "contested"
          : "moderate";
    return { query: o.query, strength, strongIncumbents: strongPresent };
  });

  return {
    totalSearches: total,
    leaderboard,
    strongCompetitors: [...strongSet],
    whitespace: whitespace
      .filter((w) => w.strength === "open")
      .concat(whitespace.filter((w) => w.strength !== "open")),
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

/** Find the cited URL that belongs to a competitor, across searches they won. */
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
  competitor: CompetitorStanding;
  outcomes: SearchOutcome[];
}): Promise<CompetitorBasis> {
  const { competitor, outcomes } = args;
  const url = citationForCompetitor(competitor.name, outcomes);
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

  const prompt = `A competitor "${competitor.name}" gets cited by AI assistants for searches like: ${competitor.searches
    .slice(0, 4)
    .join("; ")}.

${url ? `Their cited page: ${url}` : "No cited page URL was resolvable."}
Detected on page: JSON-LD schema=${hasSchema}, FAQ schema=${hasFaqSchema}.
${pageText ? `Page content (excerpt):\n"""${pageText}"""` : "(page content unavailable)"}

Explain, specifically and evidence-based (not generic):
1. WHY this page/brand gets cited — the ranking factors actually present (content structure, schema, entities, authority, freshness).
2. HOW to out-rank them — concrete moves for a competitor to beat them on these searches.

Return ONLY JSON: {"factors": ["..."], "howToBeat": ["..."]}`;

  try {
    const raw = await generateText(prompt, { temperature: 0.3 });
    const parsed = JSON.parse(
      raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1),
    ) as { factors?: string[]; howToBeat?: string[] };
    return {
      name: competitor.name,
      url,
      rankedFor: competitor.searches.slice(0, 4),
      factors: parsed.factors ?? [],
      howToBeat: parsed.howToBeat ?? [],
    };
  } catch {
    return {
      name: competitor.name,
      url,
      rankedFor: competitor.searches.slice(0, 4),
      factors: [],
      howToBeat: [],
    };
  }
}
