import "server-only";
import type { SiteResource } from "./adapter";

// ─────────────────────────────────────────────────────────────────────
// Lightweight crawler for generic (non-Shopify) sites. Discovers URLs via
// sitemap.xml (falling back to homepage links), fetches each, and extracts a
// normalized SiteResource (title, meta description, headings, text). Bounded
// and dependency-free — enough for the agent to understand a marketing site
// or landing page without a headless browser.
// ─────────────────────────────────────────────────────────────────────

const UA = "Pigeon-Bot/1.0 (+https://pigeon.com/bot)";
const MAX_PAGES = Number(process.env.CRAWL_MAX_PAGES ?? 25);
const FETCH_TIMEOUT_MS = 12_000;

async function fetchPage(
  url: string,
): Promise<{ text: string; finalUrl: string } | null> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml,application/xml" },
      redirect: "follow",
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!res.ok) return null;
    return { text: await res.text(), finalUrl: res.url || url };
  } catch {
    return null;
  }
}

async function fetchText(url: string): Promise<string | null> {
  return (await fetchPage(url))?.text ?? null;
}

function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return url;
  }
}

// Compare hosts ignoring the leading `www.` so a site that canonicalizes to
// www.example.com doesn't get its own links filtered out.
function sameSite(a: string, b: string): boolean {
  const host = (u: string) => {
    try {
      return new URL(u).host.replace(/^www\./, "");
    } catch {
      return u;
    }
  };
  return host(a) === host(b);
}

async function discoverUrls(root: string): Promise<string[]> {
  // Resolve the canonical origin by following the homepage's redirects first
  // (handles non-www → www and http → https), so link filtering uses the real
  // origin the site serves.
  const home = await fetchPage(root);
  const origin = originOf(home?.finalUrl ?? root);
  const found = new Set<string>();

  // 1. sitemap.xml (and a sitemap index → child sitemaps, one level).
  const sitemap = await fetchText(`${origin}/sitemap.xml`);
  if (sitemap) {
    const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim());
    const childSitemaps = locs.filter((u) => isXmlUrl(u));
    const pageLocs = locs.filter((u) => !isXmlUrl(u));
    pageLocs.forEach((u) => found.add(u));
    for (const sm of childSitemaps.slice(0, 5)) {
      const child = await fetchText(sm);
      if (child)
        for (const m of child.matchAll(/<loc>([^<]+)<\/loc>/g)) {
          const loc = m[1].trim();
          if (!isXmlUrl(loc)) found.add(loc); // skip further sitemap nesting
        }
      if (found.size >= MAX_PAGES) break;
    }
  }

  // 2. Fallback / supplement: same-site links from the homepage.
  found.add(origin + "/");
  if (home?.text) {
    for (const m of home.text.matchAll(/href=["']([^"'#]+)["']/g)) {
      let href = m[1];
      if (href.startsWith("/")) href = origin + href;
      if (sameSite(href, origin)) found.add(href.split("?")[0]);
      if (found.size >= MAX_PAGES * 3) break;
    }
  }

  return [...found]
    .filter((u) => sameSite(u, origin) && !isXmlUrl(u))
    .slice(0, MAX_PAGES);
}

// True if the URL points at an XML sitemap (ignoring any query string).
function isXmlUrl(u: string): boolean {
  try {
    return new URL(u).pathname.toLowerCase().endsWith(".xml");
  } catch {
    return u.toLowerCase().includes(".xml");
  }
}

function stripTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extract(url: string, html: string): SiteResource {
  const title =
    html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim() ??
    html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]?.replace(/<[^>]+>/g, "").trim() ??
    url;
  const description =
    html
      .match(/<meta[^>]+name=["']description["'][^>]*>/i)?.[0]
      ?.match(/content=["']([^"']*)["']/i)?.[1]
      ?.trim() ?? undefined;
  const path = (() => {
    try {
      return new URL(url).pathname;
    } catch {
      return url;
    }
  })();
  const handle = path === "/" ? "home" : path.replace(/^\/|\/$/g, "").replace(/\//g, "-");

  return {
    type: "route",
    id: url,
    handle,
    url: path,
    title,
    bodyText: stripTags(html).slice(0, 4000),
    meta: { title, description },
  };
}

export async function crawlSite(root: string): Promise<SiteResource[]> {
  const urls = await discoverUrls(root);
  const out: SiteResource[] = [];
  // Small concurrency to be polite.
  const CONCURRENCY = 4;
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, urls.length) }, () =>
      (async () => {
        while (cursor < urls.length) {
          const url = urls[cursor++];
          const html = await fetchText(url);
          if (html) out.push(extract(url, html));
        }
      })(),
    ),
  );
  return out;
}

export async function fetchSiteProfile(root: string): Promise<{
  name: string;
  url: string;
  primaryDomain: string;
}> {
  const origin = originOf(root);
  const primaryDomain = new URL(origin).host.replace(/^www\./, "");
  const home = await fetchText(root);
  const name =
    home?.match(/<meta[^>]+property=["']og:site_name["'][^>]*>/i)?.[0]?.match(
      /content=["']([^"']*)["']/i,
    )?.[1] ??
    home?.match(/<title[^>]*>([^<|—-]*)/i)?.[1]?.trim() ??
    primaryDomain;
  return { name: name.trim() || primaryDomain, url: origin, primaryDomain };
}
