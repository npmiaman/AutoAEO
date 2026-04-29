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
// AutoAEO domain tables
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
