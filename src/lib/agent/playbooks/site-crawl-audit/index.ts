import "server-only";
import type { Playbook, ProposedChange } from "@/lib/agent/types";
import {
  fetchArticles,
  fetchCollections,
  fetchPages,
  fetchProducts,
  fetchPublishedTheme,
  fetchShopInfo,
  fetchThemeAssetText,
} from "@/lib/agent/playbooks/machine-layer/queries";
import { triageFindings, type RawFinding, type TriagedFinding } from "./triage";

// ─────────────────────────────────────────────────────────────────────
// Site Crawl Audit (Pillar 1, Technical GEO).
//
// Two phases:
//   1. Mechanical detection — fetch URLs as an AI crawler does and
//      collect raw findings (4xx, redirect chains, missing meta, JS-only,
//      robots.txt issues).
//   2. LLM triage (Gemini) — refine severity, suggest specific fixes,
//      and convert eligible 4xx findings into actionable
//      `redirect_create` proposals.
//
// LLM triage is opt-in: if GOOGLE_API_KEY isn't set, we still emit the
// raw findings but skip the enrichment.
// ─────────────────────────────────────────────────────────────────────

const AI_CRAWLER_UA =
  "Mozilla/5.0 (compatible; AutoAEO/1.0; +https://autoaeo.app/bot)";
const HOP_LIMIT = 5;
const SAMPLE_SIZE = 30;

interface UrlAuditResult {
  url: string;
  status: number;
  finalUrl: string;
  redirectHops: number;
  hasTitle: boolean;
  hasMetaDescription: boolean;
  hasH1: boolean;
  hasCanonical: boolean;
  canonicalUrl: string | null;
  htmlBytes: number;
  textBytes: number;
  appearsJsRendered: boolean;
  fetchError: string | null;
}

export const siteCrawlAuditPlaybook: Playbook = {
  id: "site-crawl-audit",
  name: "Site Crawl Audit",
  description:
    "Fetches a sample of your storefront URLs as an AI crawler (no JS) and reports issues that prevent AI bots from accessing or understanding your content. Gemini then triages findings — refining severity, writing fix instructions, and converting eligible 404s into actionable redirect proposals.",

  async run({ shopify }) {
    const [shop, products, collections, pages, articles, theme] =
      await Promise.all([
        fetchShopInfo(shopify),
        fetchProducts(shopify, 50),
        fetchCollections(shopify, 25),
        fetchPages(shopify, 25),
        fetchArticles(shopify, 10),
        fetchPublishedTheme(shopify),
      ]);

    // 1. Build the URL sample.
    const baseUrl = shop.url.replace(/\/$/, "");
    const productPaths = products.slice(0, SAMPLE_SIZE).map((p) => `/products/${p.handle}`);
    const collectionPaths = collections.slice(0, 10).map((c) => `/collections/${c.handle}`);
    const pagePaths = pages.slice(0, 10).map((p) => `/pages/${p.handle}`);
    const articlePaths = articles
      .slice(0, 5)
      .map((a) => `/blogs/${a.blogHandle}/${a.handle}`);

    const livePaths = [...productPaths, ...collectionPaths, ...pagePaths, ...articlePaths];

    const urls: string[] = [
      baseUrl,
      `${baseUrl}/products`,
      `${baseUrl}/collections`,
      `${baseUrl}/sitemap.xml`,
      `${baseUrl}/robots.txt`,
      ...livePaths.map((p) => `${baseUrl}${p}`),
    ];

    // 2. Audit robots.txt + theme robots.
    const rawFindings: RawFinding[] = [];

    const robotsResult = await auditRobotsTxt(`${baseUrl}/robots.txt`);
    if (robotsResult.blockedAiBots.length > 0) {
      rawFindings.push({
        id: `f-${rawFindings.length + 1}`,
        category: "robots_blocked",
        url: "/robots.txt",
        initialSeverity: "high",
        details: `robots.txt Disallow:/ for: ${robotsResult.blockedAiBots.join(", ")}`,
      });
    }
    if (!robotsResult.hasSitemap) {
      rawFindings.push({
        id: `f-${rawFindings.length + 1}`,
        category: "robots_no_sitemap",
        url: "/robots.txt",
        initialSeverity: "medium",
        details: "robots.txt has no Sitemap directive.",
      });
    }
    if (theme) {
      const themeRobots = await fetchThemeAssetText(
        shopify,
        theme.id,
        "config/robots.txt.liquid",
      );
      if (themeRobots && /Disallow:\s*\/\s*(\n|$)/i.test(themeRobots)) {
        rawFindings.push({
          id: `f-${rawFindings.length + 1}`,
          category: "theme_robots_disallow",
          url: "config/robots.txt.liquid",
          initialSeverity: "critical",
          details:
            "Theme robots.txt.liquid contains a global Disallow:/ rule. This blocks all crawlers.",
        });
      }
    }

    // 3. Crawl URL sample.
    const crawlResults: UrlAuditResult[] = [];
    for (const url of urls) {
      const result = await auditUrl(url);
      crawlResults.push(result);
    }

    // 4. Convert per-URL crawl results into raw findings.
    for (const r of crawlResults) {
      if (r.fetchError) {
        rawFindings.push({
          id: `f-${rawFindings.length + 1}`,
          category: "fetch_error",
          url: r.url,
          initialSeverity: "high",
          details: `Fetch failed: ${r.fetchError}`,
        });
        continue;
      }
      if (r.status >= 400) {
        rawFindings.push({
          id: `f-${rawFindings.length + 1}`,
          category: r.status >= 500 ? "broken_5xx" : "broken_4xx",
          url: r.url,
          initialSeverity: r.status >= 500 ? "critical" : "high",
          details: `HTTP ${r.status} after ${r.redirectHops} redirect(s).`,
        });
        continue;
      }
      if (r.redirectHops > 2) {
        rawFindings.push({
          id: `f-${rawFindings.length + 1}`,
          category: "redirect_chain",
          url: r.url,
          initialSeverity: "medium",
          details: `${r.redirectHops} redirect hops to reach ${r.finalUrl}.`,
        });
      }
      const missing: string[] = [];
      if (!r.hasTitle) missing.push("title");
      if (!r.hasMetaDescription) missing.push("meta description");
      if (!r.hasH1) missing.push("h1");
      if (!r.hasCanonical) missing.push("canonical");
      if (missing.length > 0) {
        rawFindings.push({
          id: `f-${rawFindings.length + 1}`,
          category: "missing_meta",
          url: r.url,
          initialSeverity: missing.length >= 2 ? "high" : "medium",
          details: `Missing: ${missing.join(", ")}.`,
        });
      }
      if (r.appearsJsRendered) {
        rawFindings.push({
          id: `f-${rawFindings.length + 1}`,
          category: "js_only",
          url: r.url,
          initialSeverity: "medium",
          details: `Visible text ${r.textBytes}/${r.htmlBytes} bytes; JS-only render likely.`,
        });
      }
    }

    // 5. LLM triage (when configured).
    let triaged: TriagedFinding[] = [];
    if (
      rawFindings.length > 0 &&
      (process.env.GOOGLE_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY)
    ) {
      try {
        triaged = await triageFindings({
          shopName: shop.name,
          shopUrl: shop.url,
          findings: rawFindings,
          liveUrls: livePaths,
        });
      } catch (err) {
        // Triage failure is non-fatal — fall back to raw findings.
        console.error("[site-crawl-audit] triage failed:", err);
        triaged = [];
      }
    }
    const triagedById = new Map(triaged.map((t) => [t.id, t]));

    // 6. Convert findings into proposals — using triage where available.
    const proposals: ProposedChange[] = [];
    let redirectsSuggested = 0;

    for (const f of rawFindings) {
      const t = triagedById.get(f.id);
      if (t && t.fix.type === "redirect") {
        // Auto-applicable fix.
        proposals.push({
          kind: "redirect_create",
          target: pathOf(f.url),
          title: `301 redirect: ${pathOf(f.url)} → ${t.fix.toPath}`,
          description: `${t.explanation}\n\nWhy this redirect: ${t.fix.rationale}`,
          before: null,
          after: { toPath: t.fix.toPath, sourceFinding: f },
        });
        redirectsSuggested++;
        continue;
      }

      const description = t
        ? `${t.explanation}${t.fix.type === "manual" ? `\n\nFix: ${t.fix.instructions}` : ""}`
        : f.details;

      proposals.push({
        kind: "audit_finding",
        target: f.url,
        title: titleFor(f),
        description,
        before: null,
        after: {
          severity: t?.severity ?? f.initialSeverity,
          category: f.category,
          rawDetails: f.details,
          fix: t?.fix ?? { type: "none", rationale: "Not enough context" },
        },
      });
    }

    // 7. Build summary.
    const counts = {
      broken: rawFindings.filter((f) =>
        f.category === "broken_4xx" || f.category === "broken_5xx",
      ).length,
      redirectChains: rawFindings.filter((f) => f.category === "redirect_chain").length,
      missingMeta: rawFindings.filter((f) => f.category === "missing_meta").length,
      jsOnly: rawFindings.filter((f) => f.category === "js_only").length,
      robots: rawFindings.filter(
        (f) =>
          f.category === "robots_blocked" ||
          f.category === "robots_no_sitemap" ||
          f.category === "theme_robots_disallow",
      ).length,
    };

    return {
      summary: `Audited ${crawlResults.length} URLs. ${rawFindings.length} finding${rawFindings.length === 1 ? "" : "s"} (${counts.broken} broken, ${counts.redirectChains} redirect chains, ${counts.missingMeta} missing-meta, ${counts.jsOnly} JS-only, ${counts.robots} robots).${redirectsSuggested > 0 ? ` ${redirectsSuggested} actionable redirect proposal${redirectsSuggested === 1 ? "" : "s"}.` : ""} ${triaged.length > 0 ? "Triaged by Gemini." : "(Set GOOGLE_API_KEY for LLM triage.)"}`,
      metrics: {
        urlsCrawled: crawlResults.length,
        findings: rawFindings.length,
        triaged: triaged.length,
        autoFixesProposed: redirectsSuggested,
        ...counts,
      },
      proposals,
    };
  },
};

function pathOf(urlOrPath: string): string {
  try {
    if (urlOrPath.startsWith("/")) return urlOrPath;
    return new URL(urlOrPath).pathname || "/";
  } catch {
    return urlOrPath;
  }
}

function titleFor(f: RawFinding): string {
  switch (f.category) {
    case "broken_4xx":
      return `Broken page (${f.url})`;
    case "broken_5xx":
      return `Server error (${f.url})`;
    case "redirect_chain":
      return `Redirect chain (${f.url})`;
    case "missing_meta":
      return `Missing meta tags (${f.url})`;
    case "js_only":
      return `JavaScript-only content (${f.url})`;
    case "robots_blocked":
      return `robots.txt blocks AI crawlers`;
    case "robots_no_sitemap":
      return `robots.txt missing Sitemap directive`;
    case "theme_robots_disallow":
      return `Theme robots.txt has global Disallow`;
    case "fetch_error":
      return `Fetch error (${f.url})`;
  }
}

// ─── HTTP helpers ────────────────────────────────────────────────────

async function auditUrl(url: string): Promise<UrlAuditResult> {
  const initial: UrlAuditResult = {
    url,
    status: 0,
    finalUrl: url,
    redirectHops: 0,
    hasTitle: false,
    hasMetaDescription: false,
    hasH1: false,
    hasCanonical: false,
    canonicalUrl: null,
    htmlBytes: 0,
    textBytes: 0,
    appearsJsRendered: false,
    fetchError: null,
  };

  let currentUrl = url;
  let hops = 0;
  let finalRes: Response | null = null;

  try {
    while (hops < HOP_LIMIT) {
      const res = await fetch(currentUrl, {
        method: "GET",
        redirect: "manual",
        headers: { "User-Agent": AI_CRAWLER_UA, Accept: "text/html,*/*" },
      });

      if (res.status >= 300 && res.status < 400) {
        const next = res.headers.get("location");
        if (!next) {
          finalRes = res;
          break;
        }
        currentUrl = new URL(next, currentUrl).toString();
        hops++;
        continue;
      }

      finalRes = res;
      break;
    }

    if (!finalRes) {
      initial.fetchError = "redirect loop or limit exceeded";
      initial.redirectHops = hops;
      return initial;
    }

    initial.status = finalRes.status;
    initial.finalUrl = currentUrl;
    initial.redirectHops = hops;

    if (finalRes.status >= 400) return initial;

    const html = await finalRes.text();
    initial.htmlBytes = html.length;
    initial.hasTitle = /<title[^>]*>[^<]+<\/title>/i.test(html);
    initial.hasMetaDescription = /<meta[^>]+name=["']description["'][^>]*content=["'][^"']+["']/i.test(html);
    initial.hasH1 = /<h1[^>]*>[\s\S]+?<\/h1>/i.test(html);
    const canonicalMatch = html.match(
      /<link[^>]+rel=["']canonical["'][^>]*href=["']([^"']+)["']/i,
    );
    initial.hasCanonical = !!canonicalMatch;
    initial.canonicalUrl = canonicalMatch?.[1] ?? null;

    const visibleText = html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    initial.textBytes = visibleText.length;
    const scriptCount = (html.match(/<script\b/gi) ?? []).length;
    initial.appearsJsRendered =
      html.length > 5_000 &&
      visibleText.length / html.length < 0.05 &&
      scriptCount > 5;

    return initial;
  } catch (err) {
    initial.fetchError = err instanceof Error ? err.message : String(err);
    return initial;
  }
}

interface RobotsAudit {
  blockedAiBots: string[];
  hasSitemap: boolean;
  raw: string | null;
}

const KNOWN_AI_BOTS = [
  "GPTBot",
  "ChatGPT-User",
  "OAI-SearchBot",
  "ClaudeBot",
  "anthropic-ai",
  "PerplexityBot",
  "Google-Extended",
  "Applebot-Extended",
  "CCBot",
  "Bytespider",
];

async function auditRobotsTxt(url: string): Promise<RobotsAudit> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": AI_CRAWLER_UA },
    });
    if (!res.ok)
      return { blockedAiBots: [], hasSitemap: false, raw: null };
    const text = await res.text();
    const blocked: string[] = [];
    const lines = text.split(/\r?\n/);
    let currentUa: string | null = null;
    for (const raw of lines) {
      const line = raw.trim();
      if (line.toLowerCase().startsWith("user-agent:")) {
        currentUa = line.slice(11).trim();
      } else if (
        currentUa &&
        line.toLowerCase().startsWith("disallow:")
      ) {
        const path = line.slice(9).trim();
        if (path === "/" && KNOWN_AI_BOTS.includes(currentUa)) {
          blocked.push(currentUa);
        }
      }
    }
    const hasSitemap = /^\s*sitemap:/im.test(text);
    return {
      blockedAiBots: Array.from(new Set(blocked)),
      hasSitemap,
      raw: text,
    };
  } catch {
    return { blockedAiBots: [], hasSitemap: false, raw: null };
  }
}
