// @autoaeo/sdk — framework-agnostic core.
//
// Fetches the artifacts AutoAEO's agent generated for your site and hands them
// to your app to inject: schema.org JSON-LD, better meta tags, and an llms.txt.
// The agent does the thinking (what to add, measured against real AI-search
// visibility); this SDK just applies the result at runtime or build time.

export interface RouteArtifacts {
  title?: string;
  description?: string;
  jsonLd: unknown[];
}

export interface ServedArtifacts {
  site: { name: string; primaryDomain: string };
  llmsTxt: string | null;
  documents: Array<{ path: string; title: string; content: string }>;
  byPath: Record<string, RouteArtifacts>;
  updatedAt: number;
}

export interface AutoAEOOptions {
  apiKey: string;
  /** AutoAEO API base. Defaults to the hosted service. */
  baseUrl?: string;
  /** In-memory cache TTL for artifacts (ms). Default 5 min. */
  ttlMs?: number;
}

export interface AutoAEOClient {
  getArtifacts(): Promise<ServedArtifacts | null>;
  getRoute(path: string): Promise<RouteArtifacts | null>;
  getLlmsTxt(): Promise<string | null>;
}

const DEFAULT_BASE = "https://app.autoaeo.com";

export function createAutoAEO(opts: AutoAEOOptions): AutoAEOClient {
  const base = (opts.baseUrl ?? DEFAULT_BASE).replace(/\/$/, "");
  const ttl = opts.ttlMs ?? 5 * 60_000;

  let cache: { at: number; data: ServedArtifacts | null } | null = null;

  async function getArtifacts(): Promise<ServedArtifacts | null> {
    const now = Date.now();
    if (cache && now - cache.at < ttl) return cache.data;
    try {
      const res = await fetch(`${base}/api/sdk/artifacts`, {
        headers: { Authorization: `Bearer ${opts.apiKey}` },
      });
      const data = res.ok ? ((await res.json()) as ServedArtifacts) : null;
      cache = { at: now, data };
      return data;
    } catch {
      // Never break the host site on a network hiccup — serve stale or nothing.
      return cache?.data ?? null;
    }
  }

  function normalize(path: string): string {
    const p = path.split("?")[0];
    return p.length > 1 ? p.replace(/\/$/, "") : p;
  }

  return {
    getArtifacts,
    async getRoute(path) {
      const a = await getArtifacts();
      if (!a) return null;
      return a.byPath[normalize(path)] ?? a.byPath[path] ?? null;
    },
    async getLlmsTxt() {
      return (await getArtifacts())?.llmsTxt ?? null;
    },
  };
}

/** Render a route's JSON-LD as ready-to-inject <script> tags (string). */
export function renderJsonLd(route: RouteArtifacts | null): string {
  if (!route?.jsonLd?.length) return "";
  return route.jsonLd
    .map(
      (obj) =>
        `<script type="application/ld+json">${JSON.stringify(obj)}</script>`,
    )
    .join("\n");
}
