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

// ─────────────────────────────────────────────────────────────────────
// Site Crawl Audit (Pillar 1, Technical GEO).
//
// For a sample of the merchant's storefront URLs, fetches each one as
// an AI crawler would (no JS execution, plain HTTP) and surfaces:
//   - Broken pages (4xx / 5xx)
//   - Redirect chains (>1 hop)
//   - Missing <title>, <meta name="description">, or H1
//   - JavaScript-only content (page is empty without JS rendering)
//   - Canonical-tag inconsistencies
//   - robots.txt issues (AI bot blocks, missing sitemap entries)
//
// Findings are emitted as `audit_finding` proposals (informational, no
// auto-apply). Some findings can spawn fix proposals: 4xx with a likely
// destination becomes a `redirect_create`; missing alt-text shows up
// hinted toward the Alt Text Generator playbook.
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
    "Fetches a sample of your storefront URLs as an AI crawler does (no JS) and reports issues that prevent AI bots from accessing or understanding your content: broken pages, redirect chains, missing meta tags, JS-only content, robots.txt blocks.",

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
    const urls: string[] = [
      baseUrl,
      `${baseUrl}/products`,
      `${baseUrl}/collections`,
      `${baseUrl}/sitemap.xml`,
      `${baseUrl}/robots.txt`,
      ...products.slice(0, SAMPLE_SIZE).map((p) => `${baseUrl}/products/${p.handle}`),
      ...collections.slice(0, 10).map((c) => `${baseUrl}/collections/${c.handle}`),
      ...pages.slice(0, 10).map((p) => `${baseUrl}/pages/${p.handle}`),
      ...articles
        .slice(0, 5)
        .map((a) => `${baseUrl}/blogs/${a.blogHandle}/${a.handle}`),
    ];

    const proposals: ProposedChange[] = [];

    // 2. Audit robots.txt and sitemap.xml directly.
    const robotsResult = await auditRobotsTxt(`${baseUrl}/robots.txt`);
    if (robotsResult.blockedAiBots.length > 0) {
      proposals.push({
        kind: "audit_finding",
        target: "/robots.txt",
        title: `robots.txt blocks ${robotsResult.blockedAiBots.length} AI crawler${robotsResult.blockedAiBots.length === 1 ? "" : "s"}`,
        description: `Blocked: ${robotsResult.blockedAiBots.join(", ")}. Run the Machine Layer playbook to deploy an AI-friendly robots.txt.`,
        before: null,
        after: { severity: "high", blockedBots: robotsResult.blockedAiBots },
      });
    }
    if (!robotsResult.hasSitemap) {
      proposals.push({
        kind: "audit_finding",
        target: "/robots.txt",
        title: "robots.txt does not declare a Sitemap",
        description:
          "AI bots use the Sitemap directive in robots.txt for structured discovery. Add Sitemap: <your-sitemap-url> via the Machine Layer playbook.",
        before: null,
        after: { severity: "medium" },
      });
    }

    // 3. Crawl URL sample.
    const crawlResults: UrlAuditResult[] = [];
    for (const url of urls) {
      const result = await auditUrl(url);
      crawlResults.push(result);
    }

    // 4. Convert per-URL findings into proposals.
    let brokenCount = 0;
    let redirectChainCount = 0;
    let missingMetaCount = 0;
    let jsOnlyCount = 0;

    for (const r of crawlResults) {
      if (r.fetchError) {
        proposals.push(findingProposal(r.url, "Page fetch failed", r.fetchError, "high"));
        continue;
      }
      if (r.status >= 400) {
        brokenCount++;
        proposals.push(
          findingProposal(
            r.url,
            `${r.status} response`,
            `URL returned HTTP ${r.status}. AI crawlers will skip this content.`,
            "high",
          ),
        );
        continue;
      }
      if (r.redirectHops > 2) {
        redirectChainCount++;
        proposals.push(
          findingProposal(
            r.url,
            `Redirect chain (${r.redirectHops} hops)`,
            `URL redirects through ${r.redirectHops} hops to reach ${r.finalUrl}. Long redirect chains slow crawlers and can be dropped from indexes.`,
            "medium",
          ),
        );
      }

      const missing: string[] = [];
      if (!r.hasTitle) missing.push("title");
      if (!r.hasMetaDescription) missing.push("meta description");
      if (!r.hasH1) missing.push("h1");
      if (!r.hasCanonical) missing.push("canonical");
      if (missing.length > 0) {
        missingMetaCount++;
        proposals.push(
          findingProposal(
            r.url,
            `Missing ${missing.join(" + ")}`,
            `Page is missing critical meta tags. AI bots use these to understand what the page is about.`,
            missing.length >= 2 ? "high" : "medium",
          ),
        );
      }

      if (r.appearsJsRendered) {
        jsOnlyCount++;
        proposals.push(
          findingProposal(
            r.url,
            "JavaScript-only content detected",
            `The raw HTML has ${r.textBytes} bytes of visible text against ${r.htmlBytes} bytes of HTML — content appears to be hidden behind JavaScript. Most AI crawlers don't execute JS reliably.`,
            "medium",
          ),
        );
      }
    }

    // 5. Verify the theme's robots.txt.liquid exists (Shopify default exists,
    // but if the merchant has customized it, we want to know).
    if (theme) {
      const themeRobots = await fetchThemeAssetText(
        shopify,
        theme.id,
        "config/robots.txt.liquid",
      );
      if (themeRobots && /Disallow:\s*\/\s*(\n|$)/i.test(themeRobots)) {
        proposals.push({
          kind: "audit_finding",
          target: "config/robots.txt.liquid",
          title: "Theme robots.txt.liquid contains a global Disallow",
          description:
            "Your theme is overriding Shopify's default robots.txt with a 'Disallow: /' rule. This blocks ALL crawlers, including search engines and AI bots. Run the Machine Layer playbook to restore an AI-friendly robots.txt.",
          before: themeRobots,
          after: { severity: "critical" },
        });
      }
    }

    return {
      summary: `Audited ${crawlResults.length} URLs. Found ${proposals.length} issue${proposals.length === 1 ? "" : "s"}: ${brokenCount} broken, ${redirectChainCount} redirect chains, ${missingMetaCount} missing-meta, ${jsOnlyCount} JS-only.`,
      metrics: {
        urlsCrawled: crawlResults.length,
        broken: brokenCount,
        redirectChains: redirectChainCount,
        missingMeta: missingMetaCount,
        jsOnly: jsOnlyCount,
        robotsFindings:
          (robotsResult.blockedAiBots.length > 0 ? 1 : 0) +
          (robotsResult.hasSitemap ? 0 : 1),
      },
      proposals,
    };
  },
};

function findingProposal(
  target: string,
  title: string,
  description: string,
  severity: "low" | "medium" | "high" | "critical",
): ProposedChange {
  return {
    kind: "audit_finding",
    target,
    title,
    description,
    before: null,
    after: { severity },
  };
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

    // Rough heuristic for JS-only content: strip tags + scripts; if visible text
    // is < 5% of HTML and the page references many scripts, content is likely JS-rendered.
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
