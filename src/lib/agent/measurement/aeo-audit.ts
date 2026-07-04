import "server-only";

// ─────────────────────────────────────────────────────────────────────
// Technical AEO/GEO audit — the automatable checks from the playbook's Phase 0
// (foundation) and Phases 1–2 (entity + structured data), run straight from a
// URL. Everything here is verifiable from robots.txt + the homepage HTML, so it
// runs on every scan and grounds the diagnosis in the site's real technical
// state (e.g. "GPTBot blocked → unblock before any content work").
//
// Manual-only playbook items (self-promo listicle risk, Reddit presence, the
// weekly cross-engine prompt cadence) are covered by the strategy brief, not
// here — they can't be judged reliably from one fetch.
// ─────────────────────────────────────────────────────────────────────

export type AuditStatus = "pass" | "warn" | "fail";

export interface AuditCheck {
  id: string;
  phase: number; // playbook phase this maps to
  label: string;
  status: AuditStatus;
  detail: string; // what we found
  fix?: string; // what to do when not passing
}

export interface AeoAudit {
  url: string;
  checks: AuditCheck[];
  passed: number; // # of non-fail checks (pass or warn)
  total: number;
}

const UA = "Pigeon-Bot/1.0 (+https://pigeon.com/bot)";
const TIMEOUT_MS = 10_000;

// AI crawlers that matter for citation. Blocking any of these is a hard fail.
const AI_CRAWLERS = [
  "GPTBot",
  "OAI-SearchBot",
  "ChatGPT-User",
  "PerplexityBot",
  "ClaudeBot",
  "Google-Extended",
  "CCBot",
];

async function get(
  url: string,
): Promise<{ status: number; text: string } | null> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "text/html,text/plain,*/*" },
      redirect: "follow",
      signal: ctrl.signal,
    });
    clearTimeout(t);
    return { status: res.status, text: await res.text() };
  } catch {
    return null;
  }
}

// ── robots.txt: which AI crawlers are blocked from the root ──────────────
function blockedCrawlers(robots: string): string[] {
  // Parse into user-agent groups → their Disallow rules.
  const groups: Array<{ agents: string[]; disallows: string[] }> = [];
  let cur: { agents: string[]; disallows: string[] } | null = null;
  let lastWasAgent = false;
  for (const rawLine of robots.split("\n")) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const [field, ...rest] = line.split(":");
    const key = field.trim().toLowerCase();
    const val = rest.join(":").trim();
    if (key === "user-agent") {
      if (!cur || !lastWasAgent) {
        cur = { agents: [], disallows: [] };
        groups.push(cur);
      }
      cur.agents.push(val.toLowerCase());
      lastWasAgent = true;
    } else if (key === "disallow" && cur) {
      cur.disallows.push(val);
      lastWasAgent = false;
    } else {
      lastWasAgent = false;
    }
  }

  const groupFor = (bot: string) => {
    const b = bot.toLowerCase();
    return (
      groups.find((g) => g.agents.includes(b)) ??
      groups.find((g) => g.agents.includes("*"))
    );
  };
  // Blocked when the applicable group disallows the whole site ("/" or "").
  return AI_CRAWLERS.filter((bot) => {
    const g = groupFor(bot);
    return !!g && g.disallows.some((d) => d === "/" || d === "");
  });
}

// ── strip a page to its visible text, to judge server-side rendering ─────
function visibleText(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ── JSON-LD extraction ───────────────────────────────────────────────────
interface SchemaFacts {
  types: Set<string>;
  hasOrgId: boolean; // Organization/LocalBusiness with an @id
  sameAs: number; // # of external corroboration links
  authorName: string | null; // named Person author
}

function typeList(t: unknown): string[] {
  if (typeof t === "string") return [t];
  if (Array.isArray(t)) return t.filter((x): x is string => typeof x === "string");
  return [];
}

function extractSchema(html: string): SchemaFacts {
  const facts: SchemaFacts = {
    types: new Set(),
    hasOrgId: false,
    sameAs: 0,
    authorName: null,
  };
  const blocks = [
    ...html.matchAll(
      /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
    ),
  ];
  const walk = (node: unknown) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== "object") return;
    const o = node as Record<string, unknown>;
    const types = typeList(o["@type"]);
    types.forEach((t) => facts.types.add(t));
    if (
      types.some((t) => /organization|localbusiness/i.test(t)) &&
      typeof o["@id"] === "string"
    ) {
      facts.hasOrgId = true;
    }
    if (Array.isArray(o.sameAs))
      facts.sameAs = Math.max(facts.sameAs, o.sameAs.length);
    const author = o.author as Record<string, unknown> | undefined;
    if (author && typeof author.name === "string" && author.name.trim())
      facts.authorName ??= author.name.trim();
    // recurse into @graph / nested nodes
    if (Array.isArray(o["@graph"])) walk(o["@graph"]);
    for (const v of Object.values(o)) if (v && typeof v === "object") walk(v);
  };
  for (const m of blocks) {
    try {
      walk(JSON.parse(m[1].trim()));
    } catch {
      /* skip malformed block */
    }
  }
  return facts;
}

export async function runAeoAudit(root: string): Promise<AeoAudit> {
  const url = /^https?:\/\//i.test(root) ? root : `https://${root}`;
  let origin = url;
  try {
    origin = new URL(url).origin;
  } catch {
    /* keep url */
  }

  const [robots, home] = await Promise.all([
    get(`${origin}/robots.txt`),
    get(url),
  ]);
  const checks: AuditCheck[] = [];

  // Phase 0.1 — AI crawler access
  if (robots && robots.status < 400 && robots.text.trim()) {
    const blocked = blockedCrawlers(robots.text);
    checks.push(
      blocked.length
        ? {
            id: "crawler-access",
            phase: 0,
            label: "AI crawler access",
            status: "fail",
            detail: `robots.txt blocks: ${blocked.join(", ")}`,
            fix: "Remove the Disallow rules for these agents (and check any CDN/WAF, e.g. Cloudflare AI-bot blocking). A single blocked crawler makes you invisible to that engine.",
          }
        : {
            id: "crawler-access",
            phase: 0,
            label: "AI crawler access",
            status: "pass",
            detail: "No AI crawler is blocked in robots.txt.",
          },
    );
  } else {
    checks.push({
      id: "crawler-access",
      phase: 0,
      label: "AI crawler access",
      status: "pass",
      detail: "No robots.txt found — crawlers are allowed by default.",
      fix: "Also confirm your CDN/WAF (e.g. Cloudflare) isn't blocking AI bots — that can't be seen from robots.txt.",
    });
  }

  // Phase 0.2 — server-side rendering
  if (home && home.status < 400) {
    const text = visibleText(home.text);
    const hasHeadings = /<h[12][\s>]/i.test(home.text);
    const emptyRoot =
      /<(div|main)[^>]+id=["'](root|app|__next)["'][^>]*>\s*<\/(div|main)>/i.test(
        home.text,
      );
    const thin = text.length < 500 || emptyRoot;
    checks.push({
      id: "ssr-render",
      phase: 0,
      label: "Server-side rendered content",
      status: thin ? "fail" : hasHeadings ? "pass" : "warn",
      detail: thin
        ? `Only ~${text.length} chars of text in raw HTML${emptyRoot ? " (empty app root)" : ""} — content looks client-rendered.`
        : `~${text.length} chars of real content in raw HTML.`,
      fix: thin
        ? "AI crawlers don't run JavaScript. Server-render or pre-render your key content so it's in view-source."
        : undefined,
    });
  } else {
    checks.push({
      id: "ssr-render",
      phase: 0,
      label: "Server-side rendered content",
      status: "warn",
      detail: "Couldn't fetch the homepage to check rendering.",
    });
  }

  // Phases 1 & 2 — entity + structured data (only when we have the HTML)
  if (home && home.status < 400) {
    const s = extractSchema(home.text);
    const has = (re: RegExp) => [...s.types].some((t) => re.test(t));

    checks.push({
      id: "org-schema",
      phase: 1,
      label: "Organization identity (schema @id)",
      status: s.hasOrgId ? "pass" : has(/organization|localbusiness/i) ? "warn" : "fail",
      detail: s.hasOrgId
        ? "Organization schema with a stable @id is present."
        : has(/organization|localbusiness/i)
          ? "Organization schema present but has no @id to reference site-wide."
          : "No Organization/Person schema found.",
      fix: s.hasOrgId
        ? undefined
        : "Add Organization (or Person) schema with one consistent @id referenced site-wide, plus sameAs to your verified profiles.",
    });

    checks.push({
      id: "corroboration",
      phase: 1,
      label: "Entity corroboration (sameAs)",
      status: s.sameAs >= 3 ? "pass" : s.sameAs > 0 ? "warn" : "fail",
      detail: `${s.sameAs} sameAs link(s) to external profiles.`,
      fix:
        s.sameAs >= 3
          ? undefined
          : "Add sameAs links to LinkedIn, Crunchbase, G2/Clutch, Wikidata etc., and link your Entity Home out to those mentions (and back).",
    });

    checks.push({
      id: "named-author",
      phase: 1,
      label: "Named author",
      status: s.authorName ? "pass" : "warn",
      detail: s.authorName
        ? `Named author in schema: ${s.authorName}.`
        : "No named author found in page schema.",
      fix: s.authorName
        ? undefined
        : "Put a real, credentialed author (name + bio + Author/Person schema) on content — named authors earn citations at a multiple of anonymous ones.",
    });

    checks.push({
      id: "answer-schema",
      phase: 2,
      label: "FAQ / HowTo / Article schema",
      status: has(/faqpage|howto/i) ? "pass" : has(/article|blogposting/i) ? "warn" : "fail",
      detail: (() => {
        const found = ["FAQPage", "HowTo", "Article", "BlogPosting"].filter((t) =>
          has(new RegExp(t, "i")),
        );
        return found.length ? `Found: ${found.join(", ")}.` : "No FAQPage/HowTo/Article schema found.";
      })(),
      fix: has(/faqpage|howto/i)
        ? undefined
        : "Add FAQPage schema to FAQs answered on the visible page (highest-impact type); layer HowTo + Article/Author where relevant. 3+ types compound.",
    });
  }

  const passed = checks.filter((c) => c.status !== "fail").length;
  return { url, checks, passed, total: checks.length };
}

/** One-line-per-check summary for injecting into the diagnosis prompt. */
export function auditSummary(a: AeoAudit): string {
  return a.checks
    .map((c) => `- [${c.status.toUpperCase()}] ${c.label}: ${c.detail}`)
    .join("\n");
}
