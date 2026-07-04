import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

// ─────────────────────────────────────────────────────────────
// better-auth tables (user / session / account / verification)
// Schema follows better-auth's expected shape.
// ─────────────────────────────────────────────────────────────

export const user = sqliteTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("emailVerified", { mode: "boolean" })
    .notNull()
    .default(false),
  image: text("image"),
  createdAt: integer("createdAt", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer("updatedAt", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export const session = sqliteTable("session", {
  id: text("id").primaryKey(),
  expiresAt: integer("expiresAt", { mode: "timestamp" }).notNull(),
  token: text("token").notNull().unique(),
  createdAt: integer("createdAt", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updatedAt", { mode: "timestamp" }).notNull(),
  ipAddress: text("ipAddress"),
  userAgent: text("userAgent"),
  userId: text("userId")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
});

export const account = sqliteTable("account", {
  id: text("id").primaryKey(),
  accountId: text("accountId").notNull(),
  providerId: text("providerId").notNull(),
  userId: text("userId")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("accessToken"),
  refreshToken: text("refreshToken"),
  idToken: text("idToken"),
  accessTokenExpiresAt: integer("accessTokenExpiresAt", { mode: "timestamp" }),
  refreshTokenExpiresAt: integer("refreshTokenExpiresAt", {
    mode: "timestamp",
  }),
  scope: text("scope"),
  password: text("password"),
  createdAt: integer("createdAt", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updatedAt", { mode: "timestamp" }).notNull(),
});

export const verification = sqliteTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: integer("expiresAt", { mode: "timestamp" }).notNull(),
  createdAt: integer("createdAt", { mode: "timestamp" }).default(
    sql`(unixepoch())`,
  ),
  updatedAt: integer("updatedAt", { mode: "timestamp" }).default(
    sql`(unixepoch())`,
  ),
});

// ─────────────────────────────────────────────────────────────
// Pigeon domain tables
// ─────────────────────────────────────────────────────────────

// A connected Shopify shop owned by a user. Tokens encrypted at rest.
export const shop = sqliteTable("shop", {
  id: text("id").primaryKey(),
  userId: text("userId")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  shopDomain: text("shopDomain").notNull().unique(), // e.g. mystore.myshopify.com
  name: text("name"),
  email: text("email"),
  // Encrypted offline access token from Shopify OAuth.
  accessTokenEnc: text("accessTokenEnc").notNull(),
  scope: text("scope").notNull(),
  installedAt: integer("installedAt", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  lastSyncedAt: integer("lastSyncedAt", { mode: "timestamp" }),
});

// One run of an agent playbook against a shop (audit / plan / apply).
export const agentRun = sqliteTable("agent_run", {
  id: text("id").primaryKey(),
  shopId: text("shopId")
    .notNull()
    .references(() => shop.id, { onDelete: "cascade" }),
  playbook: text("playbook").notNull(), // 'audit' | 'machine-layer' | 'schema' | 'meta-rewrite' | ...
  status: text("status").notNull(), // 'queued' | 'running' | 'awaiting_approval' | 'applying' | 'succeeded' | 'failed' | 'cancelled'
  summary: text("summary"), // short human description
  metricsJson: text("metricsJson"), // arbitrary JSON: scores, counts, before/after
  errorMessage: text("errorMessage"),
  startedAt: integer("startedAt", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  completedAt: integer("completedAt", { mode: "timestamp" }),
});

// ─────────────────────────────────────────────────────────────
// Pigeon v2 — platform-agnostic sites + autonomous loop + memory
//
// `shop` above stays the Shopify-specific record (OAuth token, domain).
// `site` generalizes it: one row per optimizable site regardless of
// platform (shopify | generic-crawl | sdk-embedded). A Shopify `site`
// points back at its `shop` via shopId; generic/sdk sites have none.
// ─────────────────────────────────────────────────────────────

export const site = sqliteTable("site", {
  id: text("id").primaryKey(),
  userId: text("userId")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  platform: text("platform").notNull(), // 'shopify' | 'generic' | 'sdk'
  name: text("name").notNull(),
  url: text("url").notNull(), // public storefront / site root
  primaryDomain: text("primaryDomain").notNull(),
  // For platform === 'shopify': the backing shop row (token, theme access).
  shopId: text("shopId").references(() => shop.id, { onDelete: "cascade" }),
  // For platform === 'sdk'/'generic': API key the SDK/CLI authenticates with.
  apiKey: text("apiKey").unique(),
  // Autonomy + loop configuration. See site/config.ts for the shape.
  //   { autonomy: 'full'|'safe'|'manual', autoRollback: bool,
  //     minImprovement: number, cadenceMinutes: number, paused: bool }
  configJson: text("configJson"),
  createdAt: integer("createdAt", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  lastLoopAt: integer("lastLoopAt", { mode: "timestamp" }),
});

// Artifacts the agent produced for a non-Shopify (generic/sdk) site. Since we
// can't write to a site we don't own, changes are stored here and served to the
// @pigeon/sdk or CLI, which injects them at runtime / build time. One active
// row per (site, kind, target); snapshot/revert toggle `active` + prior payload.
export const siteArtifact = sqliteTable("site_artifact", {
  id: text("id").primaryKey(),
  siteId: text("siteId")
    .notNull()
    .references(() => site.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(), // ArtifactKind
  target: text("target").notNull(), // path / route / resource id
  payloadJson: text("payloadJson").notNull(),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("createdAt", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer("updatedAt", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

// A test the improvement planner proposes: a hypothesis + action + a KPI tied
// to specific searches. The periodic evaluator re-measures the KPI searches,
// compares baseline vs latest appearances, and marks tests won/dropped so the
// loop doubles down on whatever produced the most signal. No scores — KPIs are
// counts of which target searches we now appear on.
export const improvementTest = sqliteTable("improvement_test", {
  id: text("id").primaryKey(),
  siteId: text("siteId")
    .notNull()
    .references(() => site.id, { onDelete: "cascade" }),
  focusArea: text("focusArea").notNull(),
  hypothesis: text("hypothesis").notNull(),
  action: text("action").notNull(),
  kpiMetric: text("kpiMetric").notNull(), // human description of the KPI
  kpiQueriesJson: text("kpiQueriesJson").notNull(), // string[] — searches to re-measure
  kpiTarget: integer("kpiTarget").notNull(), // appear on >= N of them
  windowDays: integer("windowDays").notNull(),
  status: text("status").notNull().default("proposed"), // proposed|running|won|dropped
  baselineHits: integer("baselineHits"), // # target searches we appeared on at start
  baselineAppearedJson: text("baselineAppearedJson"),
  latestHits: integer("latestHits"),
  latestAppearedJson: text("latestAppearedJson"),
  createdAt: integer("createdAt", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  evaluatedAt: integer("evaluatedAt", { mode: "timestamp" }),
});

// A standing optimization objective for a site. The loop turns goals into
// experiments and measures progress against them.
export const goal = sqliteTable("goal", {
  id: text("id").primaryKey(),
  siteId: text("siteId")
    .notNull()
    .references(() => site.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(), // 'aeo' | 'seo'
  description: text("description").notNull(), // human statement of the goal
  // AEO: buyer questions we want the site cited for.
  targetQueriesJson: text("targetQueriesJson"), // string[]
  // SEO: keywords/topics we want to rank/appear for.
  targetKeywordsJson: text("targetKeywordsJson"), // string[]
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("createdAt", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

// One attempt by the autonomous loop: a hypothesis, the change it made, the
// before/after scores, and the verdict. This is the agent's episodic memory —
// consulted before every action so it never repeats a dead end.
export const experiment = sqliteTable("experiment", {
  id: text("id").primaryKey(),
  siteId: text("siteId")
    .notNull()
    .references(() => site.id, { onDelete: "cascade" }),
  goalId: text("goalId").references(() => goal.id, { onDelete: "set null" }),
  playbook: text("playbook").notNull(), // which action was taken
  hypothesis: text("hypothesis").notNull(), // why we expected this to help
  // Stable fingerprint of (playbook + target + change intent) for exact-match
  // dedup: "have we literally tried this before?".
  fingerprint: text("fingerprint").notNull(),
  status: text("status").notNull(), // 'proposed'|'applied'|'measuring'|'kept'|'reverted'|'failed'
  changeJson: text("changeJson"), // the Artifact(s) applied
  snapshotJson: text("snapshotJson"), // before-state for rollback
  // No scoring. We compare which searches we appear on before vs after.
  baselineAppeared: integer("baselineAppeared"), // # of searches we ranked on before
  resultAppeared: integer("resultAppeared"), // # of searches we ranked on after
  gainedJson: text("gainedJson"), // searches we newly appear on (the win)
  lostJson: text("lostJson"), // searches we dropped off (the regression, if any)
  verdict: text("verdict"), // 'improved'|'no_change'|'regressed'
  notes: text("notes"), // free-form learning to carry forward
  createdAt: integer("createdAt", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  completedAt: integer("completedAt", { mode: "timestamp" }),
});

// A point-in-time measurement of a site's performance on some signal.
// Baseline (experimentId null) or the post-change reading for an experiment.
export const measurement = sqliteTable("measurement", {
  id: text("id").primaryKey(),
  siteId: text("siteId")
    .notNull()
    .references(() => site.id, { onDelete: "cascade" }),
  experimentId: text("experimentId").references(() => experiment.id, {
    onDelete: "cascade",
  }),
  goalId: text("goalId").references(() => goal.id, { onDelete: "set null" }),
  signal: text("signal").notNull(), // 'synthetic_ai' (extensible: 'gsc'|'lighthouse')
  // Factual counts, not a score: on how many of the searches did we appear.
  appeared: integer("appeared").notNull(),
  total: integer("total").notNull(),
  detailJson: text("detailJson"), // full outcomes (who ranks where) + LLM diagnosis
  createdAt: integer("createdAt", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

// An async visibility scan submitted to OpenAI's Batch API. All ~50 grounded
// searches go up as one batch job; when it completes we parse the output and
// finalize a `measurement`. Tracks batch state so the dashboard can poll.
export const scanJob = sqliteTable("scan_job", {
  id: text("id").primaryKey(),
  siteId: text("siteId")
    .notNull()
    .references(() => site.id, { onDelete: "cascade" }),
  status: text("status").notNull(), // 'running' | 'completed' | 'failed'
  batchId: text("batchId").notNull(), // OpenAI batch id
  searchesJson: text("searchesJson").notNull(), // the FULL search set the scan covers
  // The subset actually submitted to this batch (the cache-misses). Null → all of
  // searchesJson was submitted. At finalize we merge batch results with cached ones.
  submittedJson: text("submittedJson"),
  measurementId: text("measurementId"), // set when finalized
  error: text("error"),
  createdAt: integer("createdAt", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  completedAt: integer("completedAt", { mode: "timestamp" }),
});

// Grounded-search result cache. A query's grounded answer is site-independent,
// so we key by (engine, normalized query) and reuse it within a freshness TTL.
// This makes scans resumable — completed calls survive a crash — and cheap when
// a scan runs again soon after (already-run queries come straight from here).
export const searchCache = sqliteTable("search_cache", {
  key: text("key").primaryKey(), // `${engine}::${normalizedQuery}`
  engine: text("engine").notNull(),
  query: text("query").notNull(),
  resultJson: text("resultJson").notNull(), // EngineQueryResult
  createdAt: integer("createdAt", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

// A single proposed change inside an agent run. User reviews/approves these.
export const changeProposal = sqliteTable("change_proposal", {
  id: text("id").primaryKey(),
  runId: text("runId")
    .notNull()
    .references(() => agentRun.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(), // 'theme_asset' | 'product_update' | 'page_create' | 'metafield' | 'robots' | ...
  target: text("target").notNull(), // identifier of the thing being changed
  title: text("title").notNull(),
  description: text("description"),
  beforeJson: text("beforeJson"), // serialized prior state (for diff + rollback)
  afterJson: text("afterJson").notNull(), // serialized proposed state
  status: text("status").notNull().default("pending"), // 'pending' | 'approved' | 'rejected' | 'applied' | 'failed' | 'rolled_back'
  appliedAt: integer("appliedAt", { mode: "timestamp" }),
  errorMessage: text("errorMessage"),
});
