import "server-only";
import { createHash } from "node:crypto";
import { createClient, type Client as LibsqlClient } from "@libsql/client";
import { and, desc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/lib/db";
import { experiment } from "@/lib/db/schema";
import { EMBEDDING_DIMENSIONS } from "@/lib/agent/embeddings";
import { embedTexts } from "@/lib/agent/embed";

// ─────────────────────────────────────────────────────────────────────
// Experiment memory — the agent's episodic learning store.
//
// Two layers, both consulted before the loop acts so it never repeats work:
//   1. Exact dedup    — a deterministic `fingerprint` of (playbook + target +
//                        change intent). "Have we literally tried this?"
//   2. Semantic recall — hypotheses/notes embedded into a libsql vector index.
//                        "Have we tried something *like* this, and how did it go?"
//
// Structured rows live in the drizzle `experiment` table; the vector index is a
// parallel libsql table (same DB) keyed by experiment id, mirroring the pattern
// in agent/vector-store.ts.
// ─────────────────────────────────────────────────────────────────────

let _client: LibsqlClient | null = null;
function client(): LibsqlClient {
  if (_client) return _client;
  _client = createClient({
    url: process.env.DATABASE_URL ?? "file:./local.db",
    authToken: process.env.DATABASE_AUTH_TOKEN,
  });
  return _client;
}

let _initialized = false;
async function ensureMemoryTable(): Promise<void> {
  if (_initialized) return;
  const c = client();
  await c.execute(`
    CREATE TABLE IF NOT EXISTS experiment_memory (
      experiment_id TEXT PRIMARY KEY,
      site_id TEXT NOT NULL,
      playbook TEXT NOT NULL,
      verdict TEXT,
      text TEXT NOT NULL,
      embedding F32_BLOB(${EMBEDDING_DIMENSIONS}) NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);
  await c.execute(`
    CREATE INDEX IF NOT EXISTS experiment_memory_ann_idx
    ON experiment_memory(libsql_vector_idx(embedding))
  `);
  _initialized = true;
}

// ─── Fingerprinting (exact dedup) ────────────────────────────────────

/**
 * Deterministic fingerprint for an attempt. The same (playbook, target,
 * normalized intent) always yields the same string, so `hasTriedExact` can
 * short-circuit before doing any expensive LLM/measurement work.
 */
export function fingerprintAttempt(args: {
  playbook: string;
  target: string;
  intent?: string;
}): string {
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
  const basis = `${norm(args.playbook)}::${norm(args.target)}::${norm(
    args.intent ?? "",
  )}`;
  return createHash("sha256").update(basis).digest("hex").slice(0, 32);
}

/**
 * Has this exact attempt been made before on this site? Returns the prior
 * experiment's verdict if so (so the caller can decide: skip a dead end, or
 * re-run something that previously improved and might improve again).
 */
export async function hasTriedExact(
  siteId: string,
  fingerprint: string,
): Promise<{ tried: boolean; verdict: string | null; status: string | null }> {
  const [row] = await db
    .select({ verdict: experiment.verdict, status: experiment.status })
    .from(experiment)
    .where(
      and(
        eq(experiment.siteId, siteId),
        eq(experiment.fingerprint, fingerprint),
      ),
    )
    .orderBy(desc(experiment.createdAt))
    .limit(1);
  return {
    tried: !!row,
    verdict: row?.verdict ?? null,
    status: row?.status ?? null,
  };
}

// ─── Recording ───────────────────────────────────────────────────────

export interface RecordExperimentInput {
  siteId: string;
  goalId?: string | null;
  playbook: string;
  hypothesis: string;
  fingerprint: string;
  status:
    | "proposed"
    | "applied"
    | "measuring"
    | "kept"
    | "reverted"
    | "failed";
  change?: unknown;
  snapshot?: unknown;
}

/** Create an experiment row at the start of an attempt. Returns its id. */
export async function recordExperiment(
  input: RecordExperimentInput,
): Promise<string> {
  const id = nanoid();
  await db.insert(experiment).values({
    id,
    siteId: input.siteId,
    goalId: input.goalId ?? null,
    playbook: input.playbook,
    hypothesis: input.hypothesis,
    fingerprint: input.fingerprint,
    status: input.status,
    changeJson: input.change === undefined ? null : JSON.stringify(input.change),
    snapshotJson:
      input.snapshot === undefined ? null : JSON.stringify(input.snapshot),
  });
  return id;
}

export interface CompleteExperimentInput {
  // No scoring — we compare which searches we appear on before vs after.
  baselineAppeared?: number | null; // # searches ranked on before the change
  resultAppeared?: number | null; // # searches ranked on after the change
  gained?: string[] | null; // searches we newly appear on (the win)
  lost?: string[] | null; // searches we dropped off (the regression, if any)
  verdict?: "improved" | "no_change" | "regressed" | null;
  status: "kept" | "reverted" | "failed";
  notes?: string | null;
}

/**
 * Finalize an experiment with its outcome, and write it to the semantic index
 * so future runs can recall the learning.
 */
export async function completeExperiment(
  experimentId: string,
  outcome: CompleteExperimentInput,
): Promise<void> {
  await db
    .update(experiment)
    .set({
      status: outcome.status,
      baselineAppeared: outcome.baselineAppeared ?? null,
      resultAppeared: outcome.resultAppeared ?? null,
      gainedJson: outcome.gained ? JSON.stringify(outcome.gained) : null,
      lostJson: outcome.lost ? JSON.stringify(outcome.lost) : null,
      verdict: outcome.verdict ?? null,
      notes: outcome.notes ?? null,
      completedAt: new Date(),
    })
    .where(eq(experiment.id, experimentId));

  const [row] = await db
    .select()
    .from(experiment)
    .where(eq(experiment.id, experimentId))
    .limit(1);
  if (!row) return;

  const text = [
    `[${row.playbook}] ${row.hypothesis}`,
    outcome.verdict ? `Verdict: ${outcome.verdict}.` : "",
    outcome.notes ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  // Semantic index is best-effort: if no embedding provider is configured,
  // the SQL experiment row above is still the source of truth (recentLearnings
  // reads it); only cross-attempt semantic recall is unavailable.
  const vecs = await embedTexts([text]);
  if (!vecs?.[0]) return;
  await ensureMemoryTable();
  const c = client();
  await c.execute({
    sql: `
      INSERT INTO experiment_memory
        (experiment_id, site_id, playbook, verdict, text, embedding)
      VALUES (?, ?, ?, ?, ?, vector32(?))
      ON CONFLICT(experiment_id) DO UPDATE SET
        verdict = excluded.verdict,
        text = excluded.text,
        embedding = excluded.embedding
    `,
    args: [
      experimentId,
      row.siteId,
      row.playbook,
      outcome.verdict ?? null,
      text,
      JSON.stringify(vecs[0]),
    ],
  });
}

// ─── Semantic recall ─────────────────────────────────────────────────

export interface PriorAttempt {
  experimentId: string;
  playbook: string;
  verdict: string | null;
  text: string;
  distance: number;
}

/**
 * Recall past attempts semantically similar to a proposed one. The loop feeds
 * these into the planner prompt ("here's what you've already learned") and can
 * refuse to re-run anything close to a prior `regressed` result.
 */
export async function findSimilarAttempts(
  siteId: string,
  proposalText: string,
  k = 5,
): Promise<PriorAttempt[]> {
  const vecs = await embedTexts([proposalText]);
  if (!vecs?.[0]) return []; // no embedding provider — semantic recall disabled
  await ensureMemoryTable();
  const c = client();
  const queryVec = vecs[0];
  const result = await c.execute({
    sql: `
      SELECT experiment_id, playbook, verdict, text,
             vector_distance_cos(embedding, vector32(?)) AS distance
      FROM experiment_memory
      WHERE site_id = ?
      ORDER BY distance ASC
      LIMIT ?
    `,
    args: [JSON.stringify(queryVec), siteId, k],
  });
  return result.rows.map((r) => ({
    experimentId: String(r.experiment_id),
    playbook: String(r.playbook),
    verdict: r.verdict === null ? null : String(r.verdict),
    text: String(r.text),
    distance: Number(r.distance),
  }));
}

/** The most recent free-form learnings for a site, for prompt context. */
export async function recentLearnings(
  siteId: string,
  limit = 10,
): Promise<Array<{ playbook: string; verdict: string | null; notes: string }>> {
  const rows = await db
    .select({
      playbook: experiment.playbook,
      verdict: experiment.verdict,
      notes: experiment.notes,
    })
    .from(experiment)
    .where(eq(experiment.siteId, siteId))
    .orderBy(desc(experiment.completedAt))
    .limit(limit);
  return rows
    .filter((r) => r.notes)
    .map((r) => ({
      playbook: r.playbook,
      verdict: r.verdict,
      notes: r.notes as string,
    }));
}
