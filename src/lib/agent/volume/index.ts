import "server-only";
import type { KeywordVolume, VolumeProvider } from "./types";
import { dataForSeoProvider } from "./dataforseo";
import { estimateProvider } from "./estimate";
import { extractKeywords } from "./keywords";

export type { KeywordVolume, VolumeProvider } from "./types";
export { extractKeywords } from "./keywords";

// Prefer a real keyword-data API; fall back to the labeled LLM estimate.
export function volumeProvider(): VolumeProvider | null {
  if (dataForSeoProvider.available()) return dataForSeoProvider;
  if (estimateProvider.available()) return estimateProvider;
  return null;
}

export interface QueryVolume {
  keyword: string;
  monthlyVolume: number | null;
  source: string;
}

/**
 * For a set of conversational queries, extract each one's head keyword and look
 * up its monthly search volume. Returns a map keyed by the original query.
 */
export async function fetchQueryVolumes(
  queries: string[],
): Promise<Map<string, QueryVolume>> {
  const out = new Map<string, QueryVolume>();
  const provider = volumeProvider();
  if (!provider || queries.length === 0) return out;

  const keywordByQuery = await extractKeywords(queries);
  const keywords = [...new Set([...keywordByQuery.values()])];
  let volumes = await provider.volumes(keywords);

  // If the preferred provider returned nothing usable (e.g. DataForSEO account
  // not yet verified, or an outage), fall back to the labeled estimate so
  // demand ranking still works instead of showing "no data".
  const gotData = [...volumes.values()].some((v) => v.monthlyVolume != null);
  if (!gotData && provider !== estimateProvider && estimateProvider.available()) {
    volumes = await estimateProvider.volumes(keywords);
  }

  for (const q of queries) {
    const keyword = keywordByQuery.get(q) ?? q;
    const v: KeywordVolume | undefined = volumes.get(keyword.toLowerCase());
    out.set(q, {
      keyword,
      monthlyVolume: v?.monthlyVolume ?? null,
      source: v?.source ?? provider.name,
    });
  }
  return out;
}
