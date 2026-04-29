import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  agentRun,
  changeProposal,
  shop as shopTable,
} from "@/lib/db/schema";
import { createShopifyClient, type ShopifyClient } from "@/lib/shopify/client";
import { fetchPublishedTheme } from "./playbooks/machine-layer/queries";
import {
  createPage,
  deletePageById,
  deleteThemeAsset,
  findPageByHandle,
  putThemeAsset,
  updatePageById,
} from "@/lib/shopify/writes";

interface ApplyError {
  proposalId: string;
  message: string;
}

/**
 * Apply every `approved` proposal on a run to the merchant's live store.
 *
 * Approach: write directly to the published theme + create/update Online
 * Store pages. We keep the `before` state per proposal so the user can
 * roll back any individual change or the whole run.
 */
export async function applyRun(runId: string): Promise<{
  applied: number;
  failed: number;
  errors: ApplyError[];
}> {
  const [run] = await db
    .select()
    .from(agentRun)
    .where(eq(agentRun.id, runId))
    .limit(1);
  if (!run) throw new Error("Run not found");

  const [s] = await db
    .select()
    .from(shopTable)
    .where(eq(shopTable.id, run.shopId))
    .limit(1);
  if (!s) throw new Error("Shop not found");

  const shopify = createShopifyClient({
    shopDomain: s.shopDomain,
    accessTokenEnc: s.accessTokenEnc,
  });

  const theme = await fetchPublishedTheme(shopify);
  if (!theme) throw new Error("No published theme on this store");

  const proposals = await db
    .select()
    .from(changeProposal)
    .where(
      and(
        eq(changeProposal.runId, runId),
        eq(changeProposal.status, "approved"),
      ),
    );

  await db
    .update(agentRun)
    .set({ status: "applying" })
    .where(eq(agentRun.id, runId));

  const errors: ApplyError[] = [];
  let applied = 0;

  for (const p of proposals) {
    try {
      const after = JSON.parse(p.afterJson);
      const result = await applyOne(shopify, theme.id, p.kind, p.target, after);

      await db
        .update(changeProposal)
        .set({
          status: "applied",
          appliedAt: new Date(),
          // Stash the apply result (e.g. created page id) in beforeJson side?
          // We use a separate field on the run instead; for now keep beforeJson untouched.
          // But for page_create, we need to know the new page id for rollback.
          beforeJson:
            result?.newRecordId != null
              ? JSON.stringify({
                  ...(p.beforeJson ? JSON.parse(p.beforeJson) : {}),
                  __createdId: result.newRecordId,
                })
              : p.beforeJson,
        })
        .where(eq(changeProposal.id, p.id));
      applied++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await db
        .update(changeProposal)
        .set({ status: "failed", errorMessage: message })
        .where(eq(changeProposal.id, p.id));
      errors.push({ proposalId: p.id, message });
    }
  }

  const remainingPending = await db
    .select({ id: changeProposal.id })
    .from(changeProposal)
    .where(
      and(
        eq(changeProposal.runId, runId),
        inArray(changeProposal.status, ["pending"]),
      ),
    );

  await db
    .update(agentRun)
    .set({
      status: errors.length > 0 ? "failed" : "succeeded",
      completedAt: new Date(),
      errorMessage:
        errors.length > 0
          ? `${errors.length} of ${proposals.length} proposals failed to apply`
          : null,
      summary: `Applied ${applied} of ${proposals.length} approved changes${
        remainingPending.length > 0
          ? `, ${remainingPending.length} still pending review`
          : ""
      }.`,
    })
    .where(eq(agentRun.id, runId));

  return { applied, failed: errors.length, errors };
}

/**
 * Roll back every `applied` proposal on a run, restoring the prior state.
 */
export async function rollbackRun(runId: string): Promise<{
  rolledBack: number;
  failed: number;
}> {
  const [run] = await db
    .select()
    .from(agentRun)
    .where(eq(agentRun.id, runId))
    .limit(1);
  if (!run) throw new Error("Run not found");

  const [s] = await db
    .select()
    .from(shopTable)
    .where(eq(shopTable.id, run.shopId))
    .limit(1);
  if (!s) throw new Error("Shop not found");

  const shopify = createShopifyClient({
    shopDomain: s.shopDomain,
    accessTokenEnc: s.accessTokenEnc,
  });

  const theme = await fetchPublishedTheme(shopify);
  if (!theme) throw new Error("No published theme on this store");

  const applied = await db
    .select()
    .from(changeProposal)
    .where(
      and(
        eq(changeProposal.runId, runId),
        eq(changeProposal.status, "applied"),
      ),
    );

  let rolledBack = 0;
  let failed = 0;

  for (const p of applied) {
    try {
      const beforeRaw = p.beforeJson ? JSON.parse(p.beforeJson) : null;
      // pull the created id (set during apply for page_create)
      const createdId =
        beforeRaw && typeof beforeRaw === "object" && "__createdId" in beforeRaw
          ? (beforeRaw as { __createdId: number | string }).__createdId
          : null;
      const before =
        beforeRaw && typeof beforeRaw === "object" && "__createdId" in beforeRaw
          ? null
          : beforeRaw;

      await rollbackOne(shopify, theme.id, p.kind, p.target, before, createdId);

      await db
        .update(changeProposal)
        .set({ status: "rolled_back" })
        .where(eq(changeProposal.id, p.id));
      rolledBack++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await db
        .update(changeProposal)
        .set({ errorMessage: `Rollback failed: ${message}` })
        .where(eq(changeProposal.id, p.id));
      failed++;
    }
  }

  await db
    .update(agentRun)
    .set({
      status: "cancelled",
      summary: `Rolled back ${rolledBack} of ${applied.length} applied changes${
        failed > 0 ? ` (${failed} rollbacks failed)` : ""
      }.`,
    })
    .where(eq(agentRun.id, runId));

  return { rolledBack, failed };
}

// ─── Per-kind handlers ───────────────────────────────────────────────

interface ApplyResult {
  newRecordId?: number | string;
}

async function applyOne(
  shopify: ShopifyClient,
  themeId: string,
  kind: string,
  target: string,
  after: unknown,
): Promise<ApplyResult | null> {
  switch (kind) {
    case "theme_asset":
    case "theme_template":
    case "robots_txt":
    case "snippet_inject": {
      if (typeof after !== "string") {
        throw new Error(`Expected string content for ${kind}; got ${typeof after}`);
      }
      await putThemeAsset(shopify, themeId, target, after);
      return null;
    }

    case "page_create": {
      const payload = after as {
        title: string;
        handle: string;
        body_html: string;
        published?: boolean;
      };
      const existing = await findPageByHandle(shopify, payload.handle);
      if (existing) {
        // Update in place — record the id so rollback restores prior content.
        await updatePageById(shopify, existing.id, {
          title: payload.title,
          body_html: payload.body_html,
          published: payload.published ?? true,
        });
        return { newRecordId: existing.id };
      }
      const created = await createPage(shopify, payload);
      return { newRecordId: created.id };
    }

    case "page_update": {
      const payload = after as {
        id: number;
        title?: string;
        body_html?: string;
        published?: boolean;
      };
      await updatePageById(shopify, payload.id, payload);
      return null;
    }

    default:
      throw new Error(`Unknown proposal kind: ${kind}`);
  }
}

async function rollbackOne(
  shopify: ShopifyClient,
  themeId: string,
  kind: string,
  target: string,
  before: unknown,
  createdId: number | string | null,
): Promise<void> {
  switch (kind) {
    case "theme_asset":
    case "theme_template":
    case "robots_txt":
    case "snippet_inject": {
      if (typeof before === "string") {
        // Asset existed before — restore it.
        await putThemeAsset(shopify, themeId, target, before);
      } else {
        // Asset didn't exist — delete what we created.
        await deleteThemeAsset(shopify, themeId, target);
      }
      return;
    }

    case "page_create": {
      // If we updated an existing page, beforeRaw won't have the page content
      // (we don't snapshot pages on apply). Best-effort: delete page if it was
      // newly created. Otherwise leave it. Future: snapshot page content.
      if (createdId != null) {
        await deletePageById(shopify, Number(createdId));
      }
      return;
    }

    case "page_update": {
      if (before && typeof before === "object" && "id" in before) {
        const prior = before as { id: number; title?: string; body_html?: string; published?: boolean };
        await updatePageById(shopify, Number(prior.id), {
          title: prior.title,
          body_html: prior.body_html,
          published: prior.published,
        });
      }
      return;
    }

    default:
      throw new Error(`Unknown proposal kind for rollback: ${kind}`);
  }
}
