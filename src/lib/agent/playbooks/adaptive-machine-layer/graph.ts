import "server-only";
import { Annotation, StateGraph, START, END } from "@langchain/langgraph";
import type { ShopifyClient } from "@/lib/shopify/client";
import {
  fetchArticles,
  fetchCollections,
  fetchPages,
  fetchProducts,
  fetchPublishedTheme,
  fetchShopInfo,
  type ArticleSummary,
  type CollectionSummary,
  type PageSummary,
  type ProductSummary,
  type PublishedTheme,
  type ShopInfo,
} from "@/lib/agent/playbooks/machine-layer/queries";
import {
  upsertProductEmbeddings,
  type ProductEmbeddingInput,
} from "@/lib/agent/vector-store";
import { profileStore, type StoreProfile } from "./profile";
import { generateProductSummaries } from "./content";

// ─────────────────────────────────────────────────────────────────────
// Adaptive Machine Layer agent — LangGraph state machine.
//
//   START
//     │
//     ▼
//   fetchStore  ─── parallel-ish reads of products, collections, pages,
//     │              articles, theme, shop
//     ▼
//   embedProducts ─── embed each product into the libsql vector index
//     │              (RAG context for downstream summary generation)
//     ▼
//   profileStore ─── single Gemini call → StoreProfile (vertical, voice…)
//     │
//     ▼
//   summarize    ─── batched Gemini call with vector-retrieved exemplars
//     │              → AEO-formatted one-liner per product
//     ▼
//   END (state contains profile + summaries; orchestrator builds proposals)
//
// LangSmith picks up tracing automatically when LANGCHAIN_TRACING_V2=true.
// ─────────────────────────────────────────────────────────────────────

const StateAnnotation = Annotation.Root({
  shopId: Annotation<string>,
  shopify: Annotation<ShopifyClient>,
  shop: Annotation<ShopInfo>,
  products: Annotation<ProductSummary[]>,
  collections: Annotation<CollectionSummary[]>,
  pages: Annotation<PageSummary[]>,
  articles: Annotation<ArticleSummary[]>,
  theme: Annotation<PublishedTheme | null>,
  aboutContent: Annotation<string | null>,
  embeddingsStored: Annotation<number>,
  profile: Annotation<StoreProfile | null>,
  summaries: Annotation<Map<string, string>>,
});

export type AgentState = typeof StateAnnotation.State;

// ─── Nodes ───────────────────────────────────────────────────────────

async function fetchStoreNode(
  state: AgentState,
): Promise<Partial<AgentState>> {
  const { shopify } = state;
  const [shop, products, collections, pages, articles, theme] =
    await Promise.all([
      fetchShopInfo(shopify),
      fetchProducts(shopify, 100),
      fetchCollections(shopify, 50),
      fetchPages(shopify, 100),
      fetchArticles(shopify, 25),
      fetchPublishedTheme(shopify),
    ]);

  const aboutPage = pages.find(
    (p) => /^about/i.test(p.handle) || /about/i.test(p.title),
  );

  return {
    shop,
    products,
    collections,
    pages,
    articles,
    theme,
    aboutContent: aboutPage?.bodySummary ?? null,
  };
}

async function embedProductsNode(
  state: AgentState,
): Promise<Partial<AgentState>> {
  const { shopId, products } = state;
  if (products.length === 0) return { embeddingsStored: 0 };

  const inputs: ProductEmbeddingInput[] = products.map((p) => {
    const desc = (p.description || "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    const meta: string[] = [];
    if (p.productType) meta.push(`Type: ${p.productType}`);
    if (p.vendor) meta.push(`Vendor: ${p.vendor}`);
    if (p.tags.length) meta.push(`Tags: ${p.tags.slice(0, 8).join(", ")}`);
    const content = [meta.join(" · "), desc].filter(Boolean).join("\n\n");
    return { handle: p.handle, title: p.title, content };
  });

  const stored = await upsertProductEmbeddings(shopId, inputs);
  return { embeddingsStored: stored };
}

async function profileNode(
  state: AgentState,
): Promise<Partial<AgentState>> {
  const profile = await profileStore({
    shop: state.shop,
    sampleProducts: state.products,
    aboutPageContent: state.aboutContent,
  });
  return { profile };
}

async function summarizeNode(
  state: AgentState,
): Promise<Partial<AgentState>> {
  if (!state.profile) return { summaries: new Map() };
  const summaries = await generateProductSummaries({
    profile: state.profile,
    products: state.products,
    shopId: state.shopId,
  });
  return { summaries };
}

// ─── Graph compilation ───────────────────────────────────────────────

let _compiled: ReturnType<ReturnType<typeof buildGraph>["compile"]> | null = null;

function buildGraph() {
  return new StateGraph(StateAnnotation)
    .addNode("fetchStore", fetchStoreNode)
    .addNode("embedProducts", embedProductsNode)
    .addNode("profileStore", profileNode)
    .addNode("summarize", summarizeNode)
    .addEdge(START, "fetchStore")
    .addEdge("fetchStore", "embedProducts")
    .addEdge("embedProducts", "profileStore")
    .addEdge("profileStore", "summarize")
    .addEdge("summarize", END);
}

export function getCompiledGraph() {
  if (_compiled) return _compiled;
  _compiled = buildGraph().compile();
  return _compiled;
}

export interface RunResult {
  shop: ShopInfo;
  products: ProductSummary[];
  collections: CollectionSummary[];
  pages: PageSummary[];
  articles: ArticleSummary[];
  theme: PublishedTheme | null;
  profile: StoreProfile | null;
  summaries: Map<string, string>;
  embeddingsStored: number;
}

export async function runAdaptiveAgent(args: {
  shopId: string;
  shopify: ShopifyClient;
}): Promise<RunResult> {
  const graph = getCompiledGraph();
  const finalState = await graph.invoke(
    {
      shopId: args.shopId,
      shopify: args.shopify,
    },
    {
      configurable: { thread_id: `adaptive-${args.shopId}-${Date.now()}` },
      runName: "AdaptiveMachineLayer",
      tags: ["pigeon", "adaptive-machine-layer"],
      metadata: { shopId: args.shopId },
    },
  );

  return {
    shop: finalState.shop,
    products: finalState.products,
    collections: finalState.collections,
    pages: finalState.pages,
    articles: finalState.articles,
    theme: finalState.theme,
    profile: finalState.profile,
    summaries: finalState.summaries ?? new Map(),
    embeddingsStored: finalState.embeddingsStored ?? 0,
  };
}
