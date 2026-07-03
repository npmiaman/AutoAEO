import "server-only";
import type { KeywordVolume, VolumeProvider } from "./types";

// ─────────────────────────────────────────────────────────────────────
// DataForSEO — real Google Ads search volume (avg monthly searches). Cheap and
// doesn't require the merchant's own Google Ads account. Configure with
// DATAFORSEO_LOGIN + DATAFORSEO_PASSWORD. Location/language default to US/en.
// ─────────────────────────────────────────────────────────────────────

const LOCATION = Number(process.env.DATAFORSEO_LOCATION_CODE ?? 2840); // US
const LANGUAGE = process.env.DATAFORSEO_LANGUAGE_CODE ?? "en";

interface DfsResult {
  keyword?: string;
  search_volume?: number | null;
  competition?: string | null;
}

export const dataForSeoProvider: VolumeProvider = {
  name: "dataforseo",

  available() {
    return !!(process.env.DATAFORSEO_LOGIN && process.env.DATAFORSEO_PASSWORD);
  },

  async volumes(keywords: string[]): Promise<Map<string, KeywordVolume>> {
    const out = new Map<string, KeywordVolume>();
    const unique = [...new Set(keywords.map((k) => k.toLowerCase().trim()))].filter(Boolean);
    if (unique.length === 0) return out;

    const auth = Buffer.from(
      `${process.env.DATAFORSEO_LOGIN}:${process.env.DATAFORSEO_PASSWORD}`,
    ).toString("base64");

    try {
      const res = await fetch(
        "https://api.dataforseo.com/v3/keywords_data/google_ads/search_volume/live",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Basic ${auth}`,
          },
          body: JSON.stringify([
            {
              keywords: unique.slice(0, 1000),
              location_code: LOCATION,
              language_code: LANGUAGE,
            },
          ]),
        },
      );
      if (!res.ok) return out;
      const json = (await res.json()) as {
        tasks?: Array<{ result?: DfsResult[] }>;
      };
      const results = json.tasks?.[0]?.result ?? [];
      for (const r of results) {
        if (!r.keyword) continue;
        out.set(r.keyword.toLowerCase(), {
          keyword: r.keyword,
          monthlyVolume: r.search_volume ?? null,
          competition: r.competition ?? null,
          source: "dataforseo",
        });
      }
    } catch {
      /* return whatever we have */
    }
    return out;
  },
};
